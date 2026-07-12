# Grid Sequencer — Design Plan

A multi-row/multi-column step-sequencer grid, built on `bruit-kit`.
This doc captures the design as worked out collaboratively (design +
challenges + package gaps), the decisions made along the way, and the
resulting build order. It assumes `bruit-kit` lives at
`../bruit-kit` (sibling directory) and is consumed via a `file:`
dependency per that package's own README.

## Core model

- **Global tempo** drives a shared step grid. Tempo/subdivision → seconds
  conversion (`60 / bpm / subdivisionsPerBeat`) is app-level — the toolkit
  primitives below work purely in seconds throughout, no BPM concept.
- **Grid**: rows × columns.
  - **Row** = one source instance (any `sources/` class — `SamplePlayer`,
    `OscillatorSynth`, `FmSynth`, `NoiseGenerator`, `GranularSynth`), plus a
    row-master cell (on/off + row-level config defaults). Rows are
    addable/removable at runtime.
  - **Column** = one step index, shared across all rows, plus a
    column-master cell (on/off + column-level config defaults).
  - **Cell** = one row/column intersection: on/off (always per-cell, never
    inherited) plus optional per-cell config overrides.
- **Config cascade**: cell override > (row default or column default,
  whichever has **precedence** — configurable per project, **default:
  row**) > the other > built-in default. On/off is the one exception:
  always per-cell, never defaulted from row/column.
- **Note assignment**: both row and column can set a default note (for
  synth rows); a cell can override either. Intentionally asymmetric with
  sample rows, which only really have on/off (see playback modes below).

## Sample playback: direct vs. pitched

No library gap — both modes already exist in `SamplePlayer`, it's purely
which note number the app passes to `noteOn`:
- **Direct** (unpitched, one fixed sound): always call
  `noteOn(rootNote, ...)` — `playbackRate` stays 1.0.
- **Pitched** (synth-like, plays the assigned note): call
  `noteOn(cellNote, ...)` — `semitoneRatio(note, rootNote)` handles the
  rest.

## Trigger modes

| Mode | Implementation |
|---|---|
| Single, play to end of sample | `SamplePlayer` `oneShot: true` — exact match, no new code |
| Single, play to end of step | `oneShot: false` + `gate: 1.0` + a short release — achievable today as a configuration recipe |
| Explicit duration, single or looped | `gate` values `> 1` hold past the step's own nominal length — mechanically works today; the `gate` field's doc/type is being loosened from "0–1" to "≥0" to make this a supported contract rather than an accident |

## Timing: per-step early/late shift

Nothing in the existing `StepSequencer` lets a step fire off-grid — it
always advances `nextStepTime` by exactly the step's own duration. Adding
`SequencerStep.timeShiftSeconds` (optional, default 0): applied only to
the `noteOn`/`noteOff` call times for that one step, **not** to the
grid-advance math, so a shift is a local nudge, not a permanent phase
drift of every step after it. "Note/beat units" (vs. raw seconds) is an
app-level conversion using the known tempo, same reasoning as the
BPM→seconds conversion above.

**Known constraint, accepted as-is:** the scheduler only queues a step
~200ms before it's due (`LOOKAHEAD_SECONDS` in the clock implementation).
Shifting a note earlier than that remaining margin at the moment it'd
normally be queued means it can't actually fire that early — fine for
humanization-scale nudges, a real ceiling for large early-shifts.

## Transport: one shared clock, not N independent sequencers

This was the key architectural decision. Row-add-at-next-cycle and
mute-without-stopping only work cleanly if rows never own their own
clock:

- **`createStepClock`** (new `bruit-kit/midi` export): owns the
  lookahead-scheduling loop (`nextStepTime`/`stepIndex`) and, on every
  step boundary, notifies every subscribed handler of
  `(stepIndex, atTime, stepSeconds)`. No `NoteTarget` of its own — it's a
  pure clock.
- **`createStepTrack`** (new export): subscribes one row (a `NoteTarget` +
  a live `getSteps()` callback) to a shared clock.
- **Row added mid-performance**: joins at the *next* `stepIndex === 0`,
  not an arbitrary phase — this needs no special clock support at all.
  The row's own `getSteps()` closure just returns all-rest steps until it
  observes `stepIndex === 0` once (e.g. by also subscribing to the same
  clock), then starts returning real data. Purely app-level state, no new
  clock API required.
- **Mute**: `getSteps()` returns steps with empty `notes` arrays while
  muted. The track's clock subscription is untouched — nothing to resync
  when unmuted.
- **Why sync works for free**: multiple `.start()` calls (or clock
  subscriptions) issued in the same synchronous turn all read the same
  `AudioContext.currentTime` (it doesn't advance mid-turn), so independent
  clock instances *would* start in sync too — but only a single shared
  clock keeps that guarantee under row add/mute/remove without needing to
  recompute alignment by hand.

## Effects

- **Per-row/per-cell inserts (filter, delay, distortion, compressor,
  tremolo, ring mod): persistent, not transient.** Built once per distinct
  *effective* config (cell override, or shared with whichever row/column
  default it resolves to — not literally one chain per grid cell) and
  never torn down until that row/cell is deleted. A fresh source node
  (unavoidably one-shot, a Web Audio constraint, not a toolkit one) just
  `connect()`s into the chain's already-existing input each time the cell
  fires; the chain's own state (delay feedback, filter history) keeps
  evolving continuously between hits, same as a real insert effect on a
  mixer channel. Retriggering before a previous hit decays isn't a
  conflict — Web Audio sums multiple sources connected to the same
  destination automatically.
  - This avoids the transient-chain teardown problem entirely (no
    tail-decay tracking needed) — persistent chains just live until the
    cell they belong to is deleted, an explicit, infrequent event, not
    something driven by audio-tail timing.
  - New `chainEffects()` helper (`bruit-kit/audio`) wires an
    ordered list of `{input, output}` effects into one combined pair, so
    building each cell's chain from its cascaded config isn't hand-wired
    node-by-node every time.
- **Reverb: shared send bus, with per-row send level** (not a per-row/
  per-cell insert). `ConvolverNode` (inside `ReverbEffect`) is the one
  genuinely expensive node type in the toolkit — real-time convolution is
  O(n log n)+ per block, everything else here is cheap O(1)-per-sample
  work. One shared `ReverbEffect` instance, set fully wet
  (`setParams({ wet: 1 })`, since dry signal already reaches the mix via
  each row's own direct connection — mixing more dry through the reverb's
  own crossfade would double it up). Each row's persistent chain gets a
  small **send** tap (new `createSend()` helper, `bruit-kit/audio`
  — a `GainNode` with a `setLevel()`) feeding into that shared reverb,
  independent of its dry output continuing to the main mix — giving
  per-row control over *how much* reverb without duplicating the
  convolver.
- **Cost estimate**: with reverb off the per-cell/per-row insert path,
  node count for even a large grid (say 8 rows × 16 columns) is bounded by
  *distinct effective configs*, not grid size — realistically low tens of
  chains, each a handful of cheap nodes. Trivial for a browser; hundreds
  of simple `AudioNode`s is well within normal real-time-audio-in-browser
  budgets.

## Remaining open question

Row-vs-column precedence and note defaults are settled (row wins by
default, configurable; both row and column can default a note, cell
overrides either). Not yet nailed down: exact UI for the grid itself
(right-click config menu, master-cell visuals) — deliberately out of
scope for `bruit-kit`, since `ui/stepSequencerEditor.ts`
intentionally stops at single-row/click-to-toggle and extending it to
multi-row + context menus + cascading config resolution is a materially
bigger, app-specific component. Build fresh in this project; only pull it
back into the toolkit if a second consumer wants the same thing.

## Build order

1. Toolkit additions (this doc's companion work, in `bruit-kit`):
   `createStepClock`, `createStepTrack`, `SequencerStep.timeShiftSeconds`,
   `gate` contract loosened, `chainEffects()`, `createSend()`.
2. Shared clock + a single row listener against one `SamplePlayer` —
   proves the architecture before the grid UI exists at all.
3. Multiple rows on the shared clock: mute-via-empty-steps, add-row-at-
   next-cycle.
4. Trigger modes (already achievable) + `gate`/duration semantics.
5. Per-step time-shift.
6. Persistent per-row/per-cell effect chains + shared reverb send bus.
7. Grid UI: click-to-toggle cells, right-click config menu, row/column
   master cells, cascading config resolution (row-precedence default,
   configurable).
8. Per-cell effect overrides, if steps 1–7 leave you wanting more
   (per-row is the default scope; per-cell is a stretch goal, not because
   it's expensive — it isn't, once effects are persistent — but because
   it's more UI and config-model complexity than per-row).
