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
each panel kind (cell/row/column/master) and exercising an override field
end to end (starts unchecked/disabled showing the resolved value, checking
it enables the control immediately, the value survives switching selection
away and back), the effect toggles (including toggling one on and dragging
its value with no render in between — a stale-closure regression that
silently reverted the toggle, since fixed), the cell-level effects
override button and its always-interactive-but-dimmed controls, adding
one row of each of the 5 source types (GranularSynth exercises its async
worklet init), the precedence toggle, tempo (BPM/subdivision), resizing
the step count, and play/stop — asserting zero console errors throughout.
Run it after touching grid/UI
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
- **Overridable fields** (note/gain/gate/time-shift on cells and columns;
  note/gain/time-shift on rows; filter/distortion/delay everywhere
  effects apply) are a checkbox plus its value control **together,
  always** — the value control is just disabled while the checkbox is
  unchecked, showing the value it'd currently resolve to from its parent
  (row/column default, or the built-in fallback) as a preview. Checking
  the box locks that value in as this level's own override. There's no
  magic "which value means unset" to remember, and nothing conditionally
  appears or disappears as a side effect of touching something else.
- **Row/column precedence** dropdown (top bar): when both a row and a
  column set a default for the same field, this picks which one wins for
  cells that don't override it themselves.
- **Tempo** (top bar): BPM + a subdivision dropdown (1/4, 1/8, 1/16, and
  their triplet variants) drive step length — the toolkit itself works
  purely in seconds, so `60 / bpm / subdivisionsPerBeat` is entirely an
  app-level conversion (`computeStepSeconds` in `src/main.ts`).
- **Steps** (top bar): the number of columns, adjustable at any time —
  growing keeps existing columns' data and pads with fresh ones; shrinking
  drops the trailing columns.
- **Master** panel: master gain, an optional master effects chain
  (filter/distortion/delay, same override fields as a row's), and the
  limiter's ceiling/release — the limiter itself is always on (a
  brickwall safety net before the audio device, see `audioContext.ts`),
  this just exposes its two params.
- **Add row**: pick a source type (sample player, oscillator, FM, noise,
  or granular synth) and a name, then **Add row**. Granular-synth rows
  take a moment to initialize (loads an `AudioWorklet`). Source type is
  fixed at creation; everything else (trigger mode, defaults, reverb send,
  effect chain, sample loading, per-source-type params like waveform or
  grain density) lives in that row's panel.
- **Per-cell effect chain override** (sample rows only): an **Override**
  button next to the panel title, not a field in the list. The
  filter/distortion/delay controls below it are always visible and always
  interactive, even while the override is off, so you can dial in a
  cell's chain ahead of time instead of building it from scratch under
  time pressure — they just grey out to show they aren't currently in
  effect. Flipping the button on switches that cell to its own chain
  (with whatever you'd already set up) instead of inheriting the row's.

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
