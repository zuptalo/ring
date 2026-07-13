# Quickstart: spec 1046 — Quick Calls + totals move

## Run it

```sh
make start          # dev stack: Vite :5173 → ringd :8080
```

Have 2–3 contacts and a group chat on your account.

## Try it (Calls tab)

- Tap the **+** tile in the Quick Calls row → pick a contact → choose Voice or
  Video → the tile appears. Pick a group: with ≤4 total people both methods
  are offered, 5–8 audio only, >8 not addable (reason shown).
- **Tap a tile** → the call rings immediately with the tile's method (glyph on
  the avatar corner). While already in a call you get the busy toast.
- **Long-press (or right-click) a tile** → Switch to video/audio (blocked with
  the limit reason when the group is too big), Remove.
- Grow a group past 4 with a video tile → the tile dims; tapping explains and
  offers switching to audio.

## Totals move

Settings → Storage and data → Network usage now shows **Audio calls** and
**Video calls** (minutes + data) with the other counters (all honour Reset
statistics). The Calls tab no longer has a Totals block.

## Verify

```sh
npm run build
npx vitest run src/utils/quick-calls.test.ts
npm run test:e2e -- quick-calls     # needs `make db-up`
```
