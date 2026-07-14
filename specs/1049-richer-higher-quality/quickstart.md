# Quickstart: verifying the richer alert tones (spec 1049)

## Automated (structure)

```sh
npx vitest run src/services/sound.test.ts      # structural contract (tone-structure.md)
npx vitest run                                  # no regressions (notify tests mock playTone)
npm run build                                   # typecheck + confirms zero audio assets in dist/
```

Asset check: `find dist -name '*.mp3' -o -name '*.wav' -o -name '*.ogg' -o -name '*.m4a'`
must return nothing (FR-002/SC-004).

## Manual listening pass (SC-005 — the real gate)

1. `make start`, open http://localhost:5173 (or the installed PWA after `npm run build`
   for a phone check — HMR does not reach the installed app).
2. Settings → Notifications → **Sound** (message tone page): tap each of the 8 rows.
   - Each audible tone should sound layered and warm with a natural decay — no bare beep.
   - Each keeps its character (Note = single note, Chime = two bells, Ping = bright tick,
     Pop = low thump, Pulse = two taps, Glow = rising pair, Beacon = three-note rise).
   - None clips or lingers past ~a second; None stays silent.
3. Repeat a couple of taps rapidly on one row — the overlap must stay clean (compressor).
4. Same list appears under the group Sound page and the Reactions Sound page — spot-check
   one tone on each (they share the engine).
5. Real notification: have a second account message you (drive scenario or a second
   browser profile) with the app open on another tab — the banner plays the new tone.

## What NOT to expect to change

Call sounds (dialing, ringing, busy, mute…), game sounds, and Battleship/Armada effects
are byte-identical — if any of those sound different, that is a bug (FR-007).
