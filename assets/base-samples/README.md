# Base sample library

Real, hand-picked audio files you want in every fresh backend, unaffected
by dev/test resets (`rm -rf backend/samples && docker compose restart
backend` wipes the runtime library — see the main README's Architecture
section) — unlike `backend/samples/`, this directory is git-tracked, so
these files persist the same way any other source file does.

## Convention

Drop audio files into the category subfolder they belong in:

```
assets/base-samples/
  percussion/kick.wav
  bass/sub-growl.wav
  lead/pluck.wav
  pad/warm-strings.wav
  fx/riser.wav
  other/vocal-chop.wav
```

- **Folder name** becomes the sample's category (matches the app's own
  `SAMPLE_CATEGORIES`: percussion, bass, lead, pad, fx, other).
- **Filename** (minus extension) becomes the sample's display name, so
  name it the way you want it to show up in the Sample Library panel.
- **WAV is the safest format** — this app's own uploads/recordings are
  always mono 16-bit PCM WAV, so that's guaranteed to decode and play
  correctly. `.mp3`/`.m4a`/`.ogg`/`.webm` are also accepted by the
  backend, but aren't otherwise exercised anywhere else in this app.

## Seeding

```
make seed-base-samples
```

Uploads every file here to the running backend (`make up` first). Safe
to run repeatedly — it skips any file whose name+category combination is
already present in the target backend, so re-running after a
`rm -rf backend/samples` reset (or just to top up a fresh environment)
won't pile up duplicates the way `make seed-samples`'s procedural set
does.
