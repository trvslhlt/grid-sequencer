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

Start the dev containers — the Vite frontend and a small Express backend
that stores patches/samples (see "Patch persistence" below) — in the
background:

```
make up
```

Then open **http://localhost:5175**. (Not 5173: bruit-kit's own dev
container already reserves that port on the host, and another sibling
project uses 5174 for the same reason. The backend listens on 3002 for the
same reason — see `docker-compose.yml`.) The page shows a "Click to enable
audio" button first (browser autoplay policy), then the grid.

Source files are bind-mounted into the container, so edits on your host
are picked up immediately (Vite hot reload) — no rebuild needed for normal
code changes. You only need `make up` again if you change `package.json`
or the `Dockerfile`.

Useful commands (see the `Makefile` for the full list):

```
make logs      # tail frontend dev server logs
make restart   # restart the frontend dev container
make shell     # drop into a shell inside the frontend container
make down      # stop and remove both containers

make backend-logs      # tail backend logs
make backend-shell     # drop into a shell inside the backend container
```

## Code quality

```
make lint        # biome check (frontend)
make format       # biome check --write (frontend)
make typecheck     # tsc --noEmit (frontend)
make backend-typecheck  # tsc --noEmit (backend)
```

All run inside the already-running dev containers (`make up` first).

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
reselection, a sample row's "Reverse playback" checkbox (non-destructive,
keeps working after reassigning a different sample mid-toggle, persists
through a patch save/reload) and the Manage Library page's separate,
permanent, destructive "Reverse" button on a sample itself, the
explicitDuration trigger mode's steps-based duration
field, the modular effects chain (no effects by default at any level —
row/cell/master alike; adding each of bruit-kit's effect types and
confirming that instance's own full param list appears; adding a duplicate type and
removing just one instance; dragging a param's value with no render call
missed in between — a stale-closure regression that used to silently
drop the change, since fixed), saving a configured chain to the Effect
Library and applying it to a different row -- directly onto an empty
target, or through the replace/add/cancel confirm flow onto a non-empty
one (see "Effect Library" below), the cell-level Effects and Envelope sections and their
always-interactive-but-dimmed controls, a full multi-effect chain
including Delay (Delay used to silence everything including the dry
signal, since fixed), the Master panel's two titled effect-chain
sections (Effects, the insert chain; Send Bus, an arbitrary chain fed by
each row's own Send level — adding a Reverb to it and confirming its
decay/wet are live-adjustable and persist through save/reload, same as
the rest of the master-level settings), adding one row of each of the 5 source types
(GranularSynth exercises its async worklet init), the precedence toggle,
tempo (BPM/subdivision), resizing the step count, patch persistence
(saving under a name with the real overwrite-confirm flow, reloading the
page for a genuinely fresh context, confirming "demo" loads by default
and the saved patch round-trips through the actual backend), recording
audio out (starting/stopping a real capture and confirming the resulting
download is a genuine, non-empty WAV file), and play/stop — asserting
zero console errors throughout (aside from one deliberately-triggered,
explicitly-filtered 409 from the overwrite check
above — see the script's own comment there). Run it after touching grid/
UI code (requires `make up` first):

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

Then open http://localhost:8080. This builds the frontend only — the
frontend needs `backend`'s `/api` reachable to actually save/load patches
(see `vite.config.ts`'s dev-only proxy; there's no equivalent wired up for
this static image yet). `backend/`'s own image builds and runs
independently:

```
make build-image-backend
make run-image-backend
```

## Using the app

- The grid loads a "demo" patch by default — a 5-row groove ("Kick", a
  sample row; "Hats", noise; "Bass", FM; "Synth", oscillator; "Pad",
  granular) exercising all 5 source types, so it's audible immediately.
  Hit **Play**. See "Patch persistence" below for what "demo" means and
  how to save your own.
- **Record** (top bar): captures exactly what's actually heard — every
  row's effects and the master bus, downstream of everything — to a real
  WAV file. Hit **Record**, play (or it'll just capture silence), hit it
  again (now labeled **Stop**) to end the take; the browser downloads
  `grid-sequencer-<timestamp>.wav` immediately, re-encoded from whatever
  format `MediaRecorder` actually produced so it's universally playable
  without needing a specific browser/codec. Purely client-side — nothing
  is uploaded or saved to the backend.
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
- **Effects** (row, cell, and master — see below): a modular, ordered
  chain — **no effects by default** at any level. Add any of bruit-kit's
  effect types as needed via the section's own "Add effect…" picker +
  **Add** button; nothing stops adding the same type twice (e.g. two
  delays in series, each independently configurable). Each already-added
  instance renders as its own "**\<Type> — Remove**" button (doubling as
  that instance's heading) followed by **every** param its underlying
  bruit-kit class actually supports, not a hand-picked subset:
  - **Filter** — type (lowpass/highpass/bandpass/lowshelf/highshelf/
    peaking/notch/allpass), cutoff, resonance (Q), gain (dB — only
    audible for lowshelf/highshelf/peaking; previously missing from
    bruit-kit entirely, which left those three types silently inert),
    wet.
  - **Distortion** — amount, output gain, wet.
  - **Delay** — time, feedback, wet.
  - **Compressor** — threshold, knee, ratio, attack, release, wet.
  - **Tremolo** — rate, depth, LFO shape (sine/square/sawtooth/triangle
    — every non-custom `OscillatorType`), wet.
  - **Ring Mod** — carrier frequency, carrier shape (sine/square/
    sawtooth/triangle), wet.
  - **Chorus** — rate, depth, wet. Two phase-inverted delay voices swept
    by one LFO.
  - **Flanger** — rate, depth, feedback, wet. A much shorter modulated
    delay than Chorus, plus a feedback loop, for the classic "jet swoosh."
  - **Phaser** — rate, depth, feedback, wet. A 4-stage cascaded allpass
    filter sweep, not a single swept filter like Filter above.
  - **Auto-Wah** — base frequency, resonance (Q), sensitivity, attack
    speed, wet. An envelope follower (not an LFO) sweeps a bandpass
    filter with how loud the input actually is.
  - **Bitcrusher** — bit depth, output gain, wet. Quantizes amplitude
    into `2^bits` discrete steps (bit-depth reduction only — no
    sample-rate reduction/aliasing, which needs an `AudioWorkletProcessor`
    bruit-kit doesn't provide for this effect yet).
  - **Reverb** — decay, pre-delay, damping, wet. A synthesized decaying-
    noise impulse response via a `ConvolverNode` — usable as an insert
    here on any row/cell/master chain, or on the Master panel's own
    **Send Bus** (see below), same as everywhere else.

  Once a chain has at least one effect, **Save chain as preset…** saves
  the whole ordered list to the **Effect Library** (see below) for reuse
  elsewhere. Reordering isn't supported yet — effects append to the end
  of the chain; removing and re-adding is the current way to reorder.

  Each source type's own params follow the same rule — see
  `src/grid/sourceFactory.ts`'s `PARAM_FIELDS_BY_SOURCE_TYPE`, which
  mirrors each bruit-kit `sources/` class's full param set (FM synth's
  carrier/modulator waveform, every one of GranularSynth's ~10 grain
  params) rather than a curated few. The one deliberate exception: each
  source's own ADSR (attack/decay/sustain/release) is never exposed as a
  param, since this app already layers a separate, more expressive
  breakpoint-curve **Envelope** on top of every source (see below) —
  exposing both would let them fight each other.

  Every param field is a plain, always-interactive control — configure
  an instance's params any time, same "dial in ahead of time" philosophy
  as Defaults/Envelope. `wet` (dry/wet mix) used to be fixed at
  instantiation time (1 for every type except delay, which defaults to
  0.35 — see the next bullet) and is now user-adjustable like everything
  else.
- **Row/column precedence** dropdown (top bar): a row or column only
  contributes a Defaults/Envelope field when its own **Override** button
  is switched on; this dropdown is purely the tie-breaker for when *both*
  a row and a column have their Override on for the same field. If only
  one side is overriding, that side wins outright regardless of this
  setting — precedence never lets one side win unconditionally just for
  holding it, since that would make the *other* side's Override button
  pointless. Both buttons are always clickable; neither is ever disabled.
- **Key / Scale** dropdowns (top bar): a global constraint above the
  cell/row/column note cascade, not part of it — whatever note a cell
  resolves to (default 60/middle C unless a row, column, or cell sets its
  own) gets silently snapped to the nearest pitch in the chosen key/scale
  right before it sounds, nearest-neighbor with ties toward the lower
  note. Every note field in the panel (row/column "Default note", a
  cell's own note override) still shows the raw, un-snapped value it was
  set to — the snap is audible-only, there's no note-name picker or
  live "what this will actually sound as" readout. Defaults to
  **Chromatic** (every semitone legal, i.e. off), so nothing changes
  until a key/scale is explicitly picked. A `samplePlayer` row's
  "direct" playback mode (its own "Playback" dropdown) is unaffected
  regardless of scale — it always plays its own default note unpitched
  already, ignoring the note cascade entirely, so there's nothing for a
  scale to constrain there.
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
- **Master** panel: master gain, the limiter's ceiling/release (the
  limiter itself is always on — a brickwall safety net before the audio
  device, see `audioContext.ts` — this just exposes its two params), and
  two titled effect-chain sections:
  - **Effects** — the master bus's own insert chain: applies to the
    whole mix, downstream of every row, same modular add/remove chain as
    a row's (no default chain here either).
  - **Send Bus** — a *separate*, arbitrary chain fed by a parallel tap:
    every row has its own **Send** field (0–1) controlling how much of
    that row's output reaches this chain, same "send some amount to a
    shared bus" shape a mixing console's aux sends use. This used to be
    a single hardcoded reverb bus with dedicated decay/pre-delay/damping
    sliders; now the chain itself is empty by default and holds whatever
    effects you add to it, including **Reverb** — now just another entry
    in the same effect-type list as Filter/Delay/Chorus/etc., with its
    own decay/pre-delay/damping/wet — but just as easily a Delay, a
    Chorus, several effects stacked, or nothing at all. The demo patch
    seeds this chain with a Reverb so it still sounds the way this app's
    demo always has.
- **Add row**: pick a source type (sample player, oscillator, FM, noise,
  or granular synth) and a name, then **Add row**. Granular-synth rows
  take a moment to initialize (loads an `AudioWorklet`). Source type is
  fixed at creation; everything else (trigger mode, defaults, send level,
  effect chain, per-source-type params like waveform or grain density)
  lives in that row's panel. A row's "Duration (steps)" field (shown when
  its trigger mode is "Explicit duration") is a count of grid steps, not
  seconds, so it scales with tempo instead of needing hand re-tuning after
  a BPM change.
- **Sample & Instrument Library panels** (right column, top/bottom): the
  only way samples and instrument sounds get onto a row now — right-click
  a row to select it, then click an item in either tree to apply it.
  Both panels are select-only and read the *whole* library (grouped
  collapsibly: samples by category, instrument presets by source type,
  collapsed until you expand a group) — adding, renaming, re-categorizing,
  or deleting library items happens on the separate **Manage Library**
  page (top bar), not here. An instrument preset only applies (and shows
  enabled rather than greyed out) when the selected row's source type
  matches the preset's — a preset is source type + that source's own
  params + envelope shape, saved via a row panel's own **Save as
  instrument preset…** button. `make seed-samples` populates the sample
  library with 18 procedurally synthesized sounds spanning every category
  (kick, snare, hats, clap, tom, sub/pluck/growl bass, three lead flavors,
  two pads, and three fx sweeps) — see `scripts/seed-sample-library.mjs`,
  a standalone Node script (no browser, no npm deps) that synthesizes raw
  PCM by hand and uploads it the same way the management page's own
  "+ Add sample" would.
- **Effect Library panel** (right column, third stacked panel): the same
  select-only, collapsible-tree shape as the Sample/Instrument panels
  above, but for whole saved effect chains (see the Effects bullet's
  "Save chain as preset…"). Unlike an instrument preset, an effect chain
  preset has no compatibility gating — it applies to a row, a sample
  cell (auto-enabling that cell's own effects override), or Master alike,
  since nothing about an effect chain ties it to a source type. With
  nothing selected, clicking a saved chain hints to pick a target first.
  Otherwise, what happens depends on whether the target already has
  effects: an **empty** target gets the chain applied directly, no
  prompt. A **non-empty** target asks first — confirm to proceed at all
  (Cancel leaves it untouched), then a second confirm chooses **replace**
  (OK — wipes the existing chain) or **add** (Cancel — appends onto what's
  already there). Two separate confirms rather than one, since a single
  yes/no dialog can't represent three distinct outcomes without one of
  them silently doubling up as "cancel."
- **Manage Library page** (top bar, in-app toggle — not a separate URL):
  full CRUD for all three libraries. Samples: rename, re-categorize
  (moves it between the tree's groups), delete, or add a brand-new local
  file (the *only* place that happens now — see the panel above).
  Instrument presets: rename, delete, or expand **Edit** to change its
  saved params/envelope directly, using the same field controls a row's
  own panel uses. Effect chain presets: rename, delete, or expand
  **Edit** to reach the same add/remove/param controls as a row's own
  Effects section, against a draft copy — **Save changes** commits it
  back to the library. Deleting a sample a saved patch still references
  doesn't break loading that patch — the row just ends up without a
  sample instead (see Known limitations). Samples also get a
  **Reverse** button here — permanent and destructive, rewriting the
  stored audio file's own PCM data in place (`backend/src/
  sampleStore.ts`'s `reverseSampleAudio`, done server-side with no
  client round-trip since every sample this app stores is the same
  16-bit PCM WAV shape `wavEncoder.ts` produces) — distinct from, and
  unrelated to, a row's own non-destructive **Reverse playback**
  checkbox below. A row that already has this sample loaded keeps
  playing whatever it already decoded; only a fresh assignment from the
  library picks up the reversed audio (see Known limitations).
- **Reverse playback** (sample rows only, row panel, next to
  "Playback"): a non-destructive playback-direction flip, toggleable any
  time — before or after a sample's assigned, mid-session, whatever.
  Flips whichever buffer is actually loaded (or the next one assigned,
  if toggled first); survives swapping to a different library sample and
  round-trips through patch save/load, same as `playbackMode`. Since
  `AudioBufferSourceNode.playbackRate` can't go negative and bruit-kit's
  `SamplePlayer` has no reverse concept of its own, this works by
  reversing the actual decoded buffer client-side (`GridModel.
  setRowReversed`) — reversing twice is exactly the identity, so
  toggling back off is just as cheap as toggling on.
- **Sample playback range** (sample rows only, once a sample is loaded): a
  waveform view with two drag handles trims which portion of the buffer
  actually plays — e.g. picking one hit out of a multi-hit recording, or
  dropping dead air at the start/end. Applies to both the initial
  playback position and (in looping trigger modes) the loop points, so a
  trimmed, looping range only cycles within the selected window rather
  than looping the whole buffer.
- **Per-cell effect chain override** (sample rows only): a cell panel's
  own "Effects" section, same modular chain as a row's (no default
  effects, add/remove any number of instances) plus the same
  **Override**-button-plus-always-interactive pattern as everything
  else — dial in a cell's chain ahead of time, switch it on with one
  click instead of building it from scratch under time pressure.
  Flipping the button on switches that cell to its own chain (with
  whatever you'd already set up) instead of inheriting the row's.
- **Patch persistence** (bottom controls, under "Add row"): the whole grid
  — every row/cell/column, master bus, tempo, and any loaded samples —
  saves to and loads from a real backend (see "Architecture" below), not
  just browser storage, so it survives a fresh browser entirely. Type a
  name and hit **Save**; saving under a name that already exists asks to
  confirm the overwrite first. The grid always loads a **"demo"** patch by
  default (seeded automatically the first time this app ever runs against
  a fresh backend) — that name is reserved and can never be overwritten,
  so there's always a known-good starting point to come back to. Pick any
  saved patch from the dropdown and hit **Load** to replace the current
  grid with it (also confirmed first, since it's destructive to whatever
  you haven't saved).

## Architecture

Two containers: `app` (the Vite frontend, everything described above) and
`backend` (a small Express + TypeScript service storing patches, uploaded
samples, instrument presets, and effect chain presets as plain files —
see `backend/src/patchStore.ts`, `sampleStore.ts`,
`instrumentPresetStore.ts`, `effectChainPresetStore.ts` — no database).
The frontend talks to it purely through `/api/patches`, `/api/samples`,
`/api/instrument-presets`, and `/api/effect-chain-presets`, proxied by
Vite in dev (`vite.config.ts`) so the browser only ever sees one origin.
Modeled
closely on the sibling project `docker_collab`'s own
creations-plus-samples backend, with two additions that project's own
saving doesn't have: name uniqueness (with an overwrite-confirmation
round trip instead of silently duplicating) and a permanently-protected
patch name (see `backend/src/routes/patches.ts`).

Local file uploads happen only from the Manage Library page now (see
"Manage Library page" above) — a real WAV (encoded client-side —
`src/wavEncoder.ts`'s `encodeWav`, ported from `docker_collab`'s own
frontend, since `AudioBuffer` has no native way to export one), uploaded
the moment it's added, alongside its category (free-form on the backend;
`src/patchApi.ts`'s `SAMPLE_CATEGORIES` is just a curated preset list for
the picker UI). All three library panels (`src/ui/libraryTree.ts`'s
`renderLibraryTree`, reused as-is by the management page with a fuller
per-item `renderItem`) read the *entire* library (`GET /api/samples` /
`GET /api/instrument-presets` / `GET /api/effect-chain-presets`), not
scoped to the row or patch that created any given item — main.ts's
`renderLibraryPanels` re-renders all three from cache any time a cache or
the selection changes (`GridViewHandle.getSelectedRow`/
`getSelectedEffectsTarget`, `GridViewOptions.onSelectionChange`, since
gridView.ts otherwise has no reason to know these panels exist at all).
`getSelectedEffectsTarget` is the broader of the two selection queries —
it spans row, sample cell, and Master, since (unlike sample/instrument
presets, row-only and source-type-gated) an effect chain preset applies
uniformly everywhere. `src/patch.ts` converts between `GridModel`'s live
state and the plain-JSON patch shape the backend stores
(`serializePatch`/`applyPatch`); a small `Map<rowId, sampleId>` in
`main.ts` tracks which backend sample each row's currently-loaded buffer
came from, since that's persistence bookkeeping `RowConfig` itself has no
reason to know about. Instrument and effect-chain presets are both pure
library conveniences, decoupled from patches entirely — applying one just
sets a row's `sourceParams`/envelope or appends to an effects array
directly, the same fields/shape a saved patch already captures, so
there's no preset-id back-reference anywhere in the patch schema.

Recording (see "Record" above) reuses the same `encodeWav` but is
otherwise unrelated to the backend entirely — bruit-kit's own `Recorder`
class taps `limiter.output` via a permanently-connected
`MediaStreamAudioDestinationNode`, and the captured clip goes straight to
a client-side download, the same "no backend route involved" shape
`docker_collab`'s own app-output-recording feature uses.

## Project layout

```
src/
  main.ts              entry point: audio unlock, GridModel, transport, wiring
  audioContext.ts       audio-unlock + shared limiter (safety net before destination)
  sampleGen.ts           synthesizes a placeholder sample buffer (no binary asset needed)
  wavEncoder.ts           AudioBuffer -> WAV Blob (shared by sample upload and recording)
  patch.ts               GridModel live state <-> plain-JSON patch (serializePatch/applyPatch)
  patchApi.ts             fetch wrappers for /api/patches + /api/samples +
                            /api/instrument-presets + /api/effect-chain-presets
  grid/
    config.ts             cascade config types + resolveCellConfig (cell > row/column > built-in)
    scale.ts               global key/scale quantizeToScale, applied above the cascade in fireTick
    sourceFactory.ts       uniform wrapper over bruit-kit's 5 sources/ classes;
                            PARAM_FIELDS_BY_SOURCE_TYPE (per-type param metadata,
                            usable without a live AudioContext -- the preset editor)
    triggerModes.ts        maps trigger-mode choice -> SamplePlayer params + TrackStep.gate
    effectsChain.ts        builds + ref-count-caches persistent effect chains
    gridModel.ts            the sequencer engine: shared clock, per-row/column/cell state, firing logic
  ui/
    gridView.ts             grid + selection config panel, click/right-click wiring;
                              effectsFields (modular add/remove effect chain, shared by
                              row/cell/master) and getSelectedEffectsTarget
    fields.ts                 form-field renderer shared by every panel kind (no popup)
    libraryTree.ts             collapsible-by-group list, shared by the main-page
                                Sample/Instrument/Effect panels and the management page
public/worklets/
  granular-processor.js  copied from bruit-kit/dist/sources/ -- GranularSynth loads
                          this at runtime via a fetched URL, not a bundler import
                          (see bruit-kit's README)
backend/                 Express + TypeScript storage for patches/samples/presets (see "Architecture" above)
  src/
    server.ts              wires the four routers, ensures patches/samples/instrumentPresets/
                              effectChainPresets exist
    patchStore.ts            one JSON file per patch, keyed by id
    sampleStore.ts           sidecar JSON + binary file per uploaded sample;
                               reverseSampleAudio reverses a WAV's own PCM
                               data in place, server-side, no decode needed
    instrumentPresetStore.ts one JSON file per preset, keyed by id
    effectChainPresetStore.ts one JSON file per saved effect chain, keyed by id
    routes/
      patches.ts              list/get/save, name uniqueness, "demo" protection
      samples.ts               list/upload (multer)/stream-by-id/rename-recategorize/
                                 permanently-reverse/delete
      instrumentPresets.ts     list/get/create/update/delete
      effectChainPresets.ts    list/get/create/update/delete
  patches/, samples/, instrumentPresets/, effectChainPresets/   gitignored, created at runtime
tests/
  verify.mjs              manual Playwright golden-path check (make verify)
scripts/
  seed-sample-library.mjs synthesizes + uploads a varied sample library (make seed-samples)
Dockerfile                dev / bruit-kit-dist / build / runtime stages (frontend)
backend/Dockerfile         dev / build / runtime stages (backend, independent context)
docker-compose.yml         app + backend dev containers + the verify service's container
Makefile                    up/down/lint/format/typecheck/build-image/verify/backend-*/...
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
- **No patch delete, and samples are never deduplicated at upload time.**
  Samples and instrument presets can both be deleted now (Manage Library
  page), but a patch can't — `backend/patches` is a plain directory you
  can always clean up by hand. Every local file added to the sample
  library uploads a fresh copy even if the exact same audio was already
  there under a different name; nothing merges or flags duplicates.
- **Deleting a sample a saved patch still references doesn't crash
  loading that patch, but it does leave the row silent.** `applyPatch`
  catches the failed fetch and logs a console warning instead of throwing
  (see `src/patch.ts`'s `addPatchRow`) — there's no reference-counting or
  "this sample is in use by N patches" warning before you delete it.
- **Key/Scale quantization is audible-only, never shown in the UI.** A
  row/column "Default note" field or a cell's own note override always
  displays the raw value it's set to, even when a non-Chromatic scale is
  active and what actually sounds is a different (nearest in-scale)
  pitch — there's no inline "this will sound as X" readout or note-name
  picker, by design (see `src/grid/scale.ts`'s `quantizeToScale`, applied
  in `GridModel.fireTick` right before `noteOn`, not anywhere in the
  resolved-config the panel itself reads).
- **Permanently reversing a library sample doesn't retroactively touch
  rows that already have it loaded.** A row keeps playing whatever
  `AudioBuffer` it already decoded in memory; only a fresh assignment
  from the Sample Library panel (or a patch load) fetches the
  now-reversed file and picks up the change. There's no "N rows use this
  sample, reload them?" prompt before or after reversing.
