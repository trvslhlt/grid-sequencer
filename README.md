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
real headless browser through the golden path: toggling a cell, opening
each context-menu kind (cell/row-master/column-master) including the
filter/distortion/delay toggles, adding one row of each of the 5 source
types (GranularSynth exercises its async worklet init), the precedence
toggle, tempo (BPM/subdivision), resizing the step count, the master
panel, and play/stop — asserting zero console errors throughout. Run it
after touching grid/UI code (requires `make up` first):

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
- **Click a cell** to toggle it on/off.
- **Right-click a cell** for its config menu: note, gain, gate, and
  time-shift overrides, plus (sample rows only) a custom effects chain for
  just that cell.
- **Right-click a row label** (left column) for that row's config: source
  type is fixed at creation, but trigger mode, default note, default gain,
  time-shift, reverb send, its effect chain, sample loading, and
  per-source-type params (waveform, grain density, etc.) all live here.
  Left-click a row label to mute/unmute it.
- **Right-click a column header** (top row) for that column's defaults
  (note/gain/gate/time-shift). Left-click a column header to skip that
  step for every row.
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
- **Master…** button (top bar): master gain, an optional master effects
  chain (filter/distortion/delay, same toggles as a row's), and the
  limiter's ceiling/release — the limiter itself is always on (a brickwall
  safety net before the audio device, see `audioContext.ts`), this just
  exposes its two params.
- **Add row**: pick a source type (sample player, oscillator, FM, noise,
  or granular synth) and a name, then **Add row**. Granular-synth rows
  take a moment to initialize (loads an `AudioWorklet`).
- **Effects** (row menu, and per-cell for sample rows): filter, distortion,
  and delay, each an independent enable checkbox + one representative
  param (cutoff / amount / time). An effect is "on" purely by being in the
  chain — there's no separate wet knob to forget to turn up. Toggling a
  checkbox reveals its param slider the next time you reopen the menu, not
  live in the menu you're looking at.

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
    gridView.ts             renders the grid table, wires click/right-click
    contextMenu.ts           generic popup menu used by all three menu kinds
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
