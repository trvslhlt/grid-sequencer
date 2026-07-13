# grid-sequencer

A multi-row/multi-column step-sequencer grid, built on
[bruit-kit](../bruit-kit). See [PLAN.md](./PLAN.md) for the full design
and build-order history — this file is just "how do I run it."

Everything runs in Docker — no Node or other dependencies need to be
installed on your host machine.

## Prerequisites

This project consumes `bruit-kit` as a sibling directory via a `file:`
dependency (`"bruit-kit": "file:../bruit-kit"` in `package.json`), so it
expects the folder layout:

```
ai_coding_experiments/
├── bruit-kit/
└── grid-sequencer/   <- you are here
```

`bruit-kit` is not published to npm — this project's dev container
bind-mounts it (read-only) and imports its **built** `dist/`, not `src/`.
`make up` (below) always rebuilds it first via bruit-kit's own Makefile,
so you don't need a separate manual step.

## Develop

Start the dev container (Vite, hot reload) in the background:

```
make up
```

Then open **http://localhost:5175**. (Not 5173: bruit-kit's own dev
container already reserves that port on the host, and another sibling
project uses 5174 for the same reason.) The page shows a "Click to enable
audio" button first (browser autoplay policy), then the grid.

Source files are bind-mounted into the container, so edits on your host
are picked up immediately (Vite hot reload) — no rebuild needed for normal
code changes. You only need `make up` again if you change `package.json`
or the `Dockerfile`.

Useful commands (see the `Makefile` for the full list):

```
make logs      # tail dev server logs
make restart   # restart the dev container
make shell     # drop into a shell inside the container
make down      # stop and remove the container
```

## Code quality

```
make lint        # biome check
make format       # biome check --write
make typecheck     # tsc --noEmit
```

All three run inside the already-running dev container (`make up` first).

## Verify

`tests/verify.mjs` is a manual (not CI) Playwright script that drives a
real headless browser through the golden path: toggling a cell, selecting
each panel kind (cell/row/column/master), exercising a cell-level override
field end to end (starts unchecked/disabled showing the resolved value,
checking it enables the control immediately, the value survives switching
selection away and back) and a row/column-level section (Defaults/
Envelope, including the section button's disabled-but-shown-active state
following the global precedence setting live), dragging an Envelope
section's breakpoint-curve editor and confirming the shape persists across
reselection, the explicitDuration trigger mode's steps-based duration
field, the effect toggles including Compressor (toggling one on and
dragging its value with no render in between — a stale-closure regression
that silently reverted the toggle, since fixed), the cell-level Effects
and Envelope sections and their always-interactive-but-dimmed controls,
enabling Delay specifically (silenced everything including the dry
signal, since fixed), adding one row of each of the 5 source types
(GranularSynth exercises its async worklet init), the precedence toggle,
tempo (BPM/subdivision), resizing the step count, and play/stop —
asserting zero console errors throughout. Run it after touching grid/UI
code (requires `make up` first):

```
make verify
```

A screenshot lands in `tests/screenshots/` (gitignored).

## Build the deployable image

`Dockerfile` has a `runtime` stage producing the actual deployable
artifact, separate from the dev container above: it compiles bruit-kit
from source, then the app, then serves the static build with nginx. Its
build context is the *parent* directory (not this one) so that sibling
compile step has real files to work with, rather than just a resolvable
path — see the Dockerfile's top comment.

```
make build-image
make run-image
```

Then open http://localhost:8080.

## Using the app

- The grid loads with two starter rows ("Kick", a sample row; "Synth", an
  oscillator row) so it's audible immediately. Hit **Play**.
- **Click a cell** to toggle it on/off. **Click a row label** to mute it.
  **Click a column header** to skip that step for every row.
- **Right-click a cell, row label, or column header** (or the **Master…**
  button) to select it — its config appears in the panel to the right of
  the grid, titled with what's selected ("Row: Kick", "Column 3", "Cell:
  Kick × col 5", "Master"), and the selected thing gets a blue outline in
  the grid so it's never ambiguous what the panel is editing. The panel
  stays up as you work; selecting something else just swaps its contents,
  no popup to reopen.
- **Cell-level overridable fields** (note/gain/gate/time-shift) are a
  checkbox plus its value control **together, always** — the value
  control is just disabled while the checkbox is unchecked, showing the
  value it'd currently resolve to from its parent (row/column default, or
  the built-in fallback) as a preview. Checking the box locks that value
  in as this cell's own override. There's no magic "which value means
  unset" to remember, and nothing conditionally appears or disappears as
  a side effect of touching something else.
- **Row/column-level overrides are grouped into sections** — "Defaults"
  (note/gain/time-shift, plus gate on columns) and "Envelope" (see
  below), each with a single **Override** button in its own header
  instead of a checkbox per field: the whole group is always visible and
  editable, just dimmed while its button is off, so you can dial in a
  row's or column's values ahead of time and switch them on with one
  click.
- **Effects** (row, cell, and master — see below): six persistent-chain
  types, each with **all** of its own params exposed, not just one
  headline knob:
  - **Filter** — type (lowpass/highpass/bandpass/lowshelf/highshelf/
    peaking/notch/allpass), cutoff, resonance (Q), wet.
  - **Distortion** — amount, output gain, wet.
  - **Delay** — time, feedback, wet.
  - **Compressor** — threshold, ratio, attack, release, wet.
  - **Tremolo** — rate, depth, LFO shape (sine/square), wet.
  - **Ring Mod** — carrier frequency, carrier shape (sine/square/
    sawtooth), wet.

  Each effect type is one checkbox (is it in the chain at all) followed
  by all its own params as plain, always-interactive fields — configure
  them before switching the effect on, same "dial in ahead of time"
  pattern as Defaults/Envelope, not a per-param disabled-until-checked
  control the way this used to work. `wet` (dry/wet mix) used to be fixed
  at instantiation time (1 for every type except delay, which defaults to
  0.35 — see the next bullet) and is now user-adjustable like everything
  else.
- **Row/column precedence** dropdown (top bar): when both a row and a
  column set a default for the same field, this picks which one wins for
  cells that don't override it themselves. Whichever side already wins
  has its Defaults/Envelope **Override** button shown **on and disabled**
  there, not off — it already contributes its values unconditionally
  (there's no useful "off" state for a side that always wins anyway), so
  only the losing side's button is actually clickable and meaningful.
- **Envelope** (every row, column, and cell): a multi-point breakpoint
  curve, not a fixed ADSR — drag points to reshape it, double-click empty
  space to add a point, double-click a point to remove it (the first/last
  points are permanent anchors at the start/end of the note). Same cascade
  as any other field (cell > row-or-column-by-precedence > built-in), but
  picked as one whole curve rather than merged field-by-field, since
  there's no sensible meaning to "this point from the cell, that point
  from the row." Defaults to a quick rise to full value, a long hold, and
  a quick drop right at the very end — just enough to avoid clicks at
  voice start/end, not a musical shape, and a starting point to reshape.
  Applying it per-cell works for every source type, not just sample rows:
  a persistent per-row gain node (`envelopeGain`, downstream of the
  source) carries the curve, scheduled immediately before each `noteOn`
  via bruit-kit's `scheduleAutomation` — which is also how it stays
  correct for GranularSynth despite that source's own per-grain envelope
  living inside an `AudioWorkletProcessor` this app can't reach. See
  `gridModel.ts`'s `fireTick` and the Known limitations section below for
  what "persistent per row, not per voice" means for overlapping notes.
- **Tempo** (top bar): BPM + a subdivision dropdown (1/4, 1/8, 1/16, and
  their triplet variants) drive step length — the toolkit itself works
  purely in seconds, so `60 / bpm / subdivisionsPerBeat` is entirely an
  app-level conversion (`computeStepSeconds` in `src/main.ts`).
- **Steps** (top bar): the number of columns, adjustable at any time —
  growing keeps existing columns' data and pads with fresh ones; shrinking
  drops the trailing columns.
- **Master** panel: master gain, an optional master effects chain (the
  same 6 effect types as a row's, see above), and the limiter's ceiling/
  release — the limiter itself is always on (a brickwall safety net
  before the audio device, see `audioContext.ts`), this just exposes its
  two params.
- **Add row**: pick a source type (sample player, oscillator, FM, noise,
  or granular synth) and a name, then **Add row**. Granular-synth rows
  take a moment to initialize (loads an `AudioWorklet`). Source type is
  fixed at creation; everything else (trigger mode, defaults, reverb send,
  effect chain, sample loading, per-source-type params like waveform or
  grain density) lives in that row's panel. A row's "Duration (steps)"
  field (shown when its trigger mode is "Explicit duration") is a count of
  grid steps, not seconds, so it scales with tempo instead of needing
  hand re-tuning after a BPM change.
- **Sample playback range** (sample rows only, once a sample is loaded): a
  waveform view under "Load sample…" with two drag handles trims which
  portion of the buffer actually plays — e.g. picking one hit out of a
  multi-hit recording, or dropping dead air at the start/end. Applies to
  both the initial playback position and (in looping trigger modes) the
  loop points, so a trimmed, looping range only cycles within the
  selected window rather than looping the whole buffer.
- **Per-cell effect chain override** (sample rows only): a cell panel's
  own "Effects" section, same **Override**-button-plus-always-interactive
  pattern as everything else — dial in a cell's chain ahead of time,
  switch it on with one click instead of building it from scratch under
  time pressure. Flipping the button on switches that cell to its own
  chain (with whatever you'd already set up) instead of inheriting the
  row's.

## Project layout

```
src/
  main.ts              entry point: audio unlock, GridModel, transport, wiring
  audioContext.ts       audio-unlock + shared limiter (safety net before destination)
  sampleGen.ts           synthesizes a placeholder sample buffer (no binary asset needed)
  grid/
    config.ts             cascade config types + resolveCellConfig (cell > row/column > built-in)
    sourceFactory.ts       uniform wrapper over bruit-kit's 5 sources/ classes
    triggerModes.ts        maps trigger-mode choice -> SamplePlayer params + TrackStep.gate
    effectsChain.ts        builds + ref-count-caches persistent effect chains
    gridModel.ts            the sequencer engine: shared clock, per-row/column/cell state, firing logic
  ui/
    gridView.ts             grid + config panel, selection state, click/right-click wiring
    fields.ts                 form-field renderer shared by every panel kind (no popup)
public/worklets/
  granular-processor.js  copied from bruit-kit/dist/sources/ -- GranularSynth loads
                          this at runtime via a fetched URL, not a bundler import
                          (see bruit-kit's README)
tests/
  verify.mjs              manual Playwright golden-path check (make verify)
Dockerfile                dev / bruit-kit-dist / build / runtime stages
docker-compose.yml         dev container + the verify service's container
Makefile                    up/down/lint/format/typecheck/build-image/verify/...
```

Note: `Dockerfile`'s `build`/`runtime` stages need bruit-kit's real files
(not just a resolvable path), so their build context is the *parent*
directory, not this one — `../ai_coding_experiments/.dockerignore` (one
level up, shared with sibling projects) exists for that reason; the `dev`
stage doesn't need it, since docker-compose bind-mounts the live sibling
in at runtime instead.

## Known limitations

Two things are scoped down from what the config cascade otherwise
supports, because of how the underlying `bruit-kit` source classes work
(a row is one shared, polyphonic instance — not a fresh voice you can
arbitrarily reroute per note):

- **Trigger mode is row-level only.** Gate, note, and time-shift are all
  per-cell-overridable, but `oneShot`/`loop` are flags on the row's
  shared source instance affecting every voice, so a single cell can't
  independently switch "one-shot" vs "gated" playback.
- **Per-cell effect chain overrides only work on sample-player rows.**
  A sample buffer can spawn a genuinely fresh one-shot node per hit and
  route it into a distinct chain; the other four source types manage
  their ADSR voices internally and don't expose an equivalent "spawn a
  node" primitive.
- **The envelope curve is a shared per-row node, not per-voice** (except
  for a sample row's per-cell effects override, which spawns a genuinely
  fresh node per hit and isn't affected by this). Two overlapping notes
  fired from the same row interrupt each other's curve — the second
  note's schedule cancels and replaces whatever was still ramping from the
  first, the same way a monophonic synth's envelope would. This mirrors a
  real constraint of `bruit-kit`'s source classes: a row is one shared,
  polyphonic instance, not a fresh voice reroutable per note (see the
  first limitation above).
