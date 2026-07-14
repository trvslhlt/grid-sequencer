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
reselection, the explicitDuration trigger mode's steps-based duration
field, the effect toggles including Compressor (toggling one on and
dragging its value with no render in between — a stale-closure regression
that silently reverted the toggle, since fixed), the cell-level Effects
and Envelope sections and their always-interactive-but-dimmed controls,
enabling Delay specifically (silenced everything including the dry
signal, since fixed), adding one row of each of the 5 source types
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
- **Sample library** (sample rows only): each upload gets tagged with a
  category (percussion, bass, lead, pad, fx, or other — picked from the
  "Category (for next upload)" select before hitting "Load sample…"), and
  every sample ever uploaded — by any row, in any patch — becomes pickable
  from a row's own "Sample library" dropdown (labeled `category — name`)
  plus a **Load from library** button, so building a new row doesn't
  require re-picking a file from disk if something already in the library
  fits. Loading a local file still works exactly as before; the library is
  additive, not a replacement. `make seed-samples` populates it with 18
  procedurally synthesized sounds spanning every category (kick, snare,
  hats, clap, tom, sub/pluck/growl bass, three lead flavors, two pads, and
  three fx sweeps) — see `scripts/seed-sample-library.mjs`, a standalone
  Node script (no browser, no npm deps) that synthesizes raw PCM by hand
  and uploads it the same way a browser-side "Load sample…" pick would.
- **Per-cell effect chain override** (sample rows only): a cell panel's
  own "Effects" section, same **Override**-button-plus-always-interactive
  pattern as everything else — dial in a cell's chain ahead of time,
  switch it on with one click instead of building it from scratch under
  time pressure. Flipping the button on switches that cell to its own
  chain (with whatever you'd already set up) instead of inheriting the
  row's.
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
`backend` (a small Express + TypeScript service storing patches and
uploaded samples as plain files — see `backend/src/patchStore.ts` and
`sampleStore.ts` — no database). The frontend talks to it purely through
`/api/patches` and `/api/samples`, proxied by Vite in dev
(`vite.config.ts`) so the browser only ever sees one origin. Modeled
closely on the sibling project `docker_collab`'s own
creations-plus-samples backend, with two additions that project's own
saving doesn't have: name uniqueness (with an overwrite-confirmation
round trip instead of silently duplicating) and a permanently-protected
patch name (see `backend/src/routes/patches.ts`).

A locally-picked sample file (via a row's "Load sample…") uploads to the
backend as a real WAV (encoded client-side — `src/wavEncoder.ts`'s
`encodeWav`, ported from `docker_collab`'s own frontend, since
`AudioBuffer` has no native way to export one) the moment it loads, not
just at save time — so it has a durable id to reference in the patch
before you've even decided on a name — and, alongside its category (see
"Sample library" above; free-form on the backend, `src/patchApi.ts`'s
`SAMPLE_CATEGORIES` is just a curated preset list for the picker UI), is
immediately listed for every other needsSample row's library dropdown too
(`GET /api/samples`), not scoped to the row or patch it was uploaded from.
`src/patch.ts` converts between
`GridModel`'s live state and the plain-JSON patch shape the backend
stores (`serializePatch`/`applyPatch`); a small `Map<rowId, sampleId>` in
`main.ts` tracks which backend sample each row's currently-loaded buffer
came from, since that's persistence bookkeeping `RowConfig` itself has no
reason to know about.

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
  patchApi.ts             fetch wrappers for /api/patches + /api/samples
  grid/
    config.ts             cascade config types + resolveCellConfig (cell > row/column > built-in)
    scale.ts               global key/scale quantizeToScale, applied above the cascade in fireTick
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
backend/                 Express + TypeScript patch/sample storage (see "Architecture" above)
  src/
    server.ts              wires the two routers, ensures patches/ + samples/ exist
    patchStore.ts            one JSON file per patch, keyed by id
    sampleStore.ts           sidecar JSON + binary file per uploaded sample
    routes/
      patches.ts              list/get/save, name uniqueness, "demo" protection
      samples.ts               list/upload (multer)/stream-by-id
  patches/, samples/        gitignored, created at runtime
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
- **No patch delete, and uploaded samples are never deduplicated or
  cleaned up.** Every "Load sample…" pick uploads a fresh copy to the
  backend even if the exact same file was already uploaded elsewhere —
  fine at personal-project scale, not something to rely on for a large
  sample library (see the roadmap's "sample library" item for where that'd
  actually get addressed). Deleting a patch isn't wired up anywhere yet
  either; `backend/patches`/`backend/samples` are plain directories you
  can always clean up by hand.
- **Key/Scale quantization is audible-only, never shown in the UI.** A
  row/column "Default note" field or a cell's own note override always
  displays the raw value it's set to, even when a non-Chromatic scale is
  active and what actually sounds is a different (nearest in-scale)
  pitch — there's no inline "this will sound as X" readout or note-name
  picker, by design (see `src/grid/scale.ts`'s `quantizeToScale`, applied
  in `GridModel.fireTick` right before `noteOn`, not anywhere in the
  resolved-config the panel itself reads).
