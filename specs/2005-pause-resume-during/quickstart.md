# Quickstart: verifying spec 2005

## Build / typecheck / unit tests (CI gates)
```sh
npm run build          # vue-tsc --noEmit (typecheck) THEN vite build — must be clean
npx vitest run         # unit tests — incl. the new rec-clock (recordedMs) cases
```
The server side is untouched (no Go change).

## TDD (Principle III)
1. Add failing cases to `src/utils/rec-clock.test.ts` first:
   - `recordedMs({accumMs:0, segStartMs:1000, paused:false}, 4000)` → `3000`.
   - Paused excludes the gap: `recordedMs({accumMs:3000, segStartMs:9999, paused:true}, 9_999_999)` → `3000`.
   - Resume continues, not restarts: after banking 3000ms then resuming with
     `segStartMs=10_000`, `recordedMs({accumMs:3000, segStartMs:10_000, paused:false}, 12_000)` → `5000`.
2. Run `npx vitest run` and confirm they FAIL (helper not yet present).
3. Implement `recordedMs` in `src/utils/rec-clock.ts`; re-run until green.

## Visual / behavioral verification (drive/ — the recorder UI)
Not unit-testable in the harness (no recordable media device in vitest), so verify against
the live dev stack with Chromium fake media:
```sh
make start                                   # dev stack (Vite :5173 → ringd :8080)
node drive/scenarios/video-note-pause.mjs    # launches with fake camera/mic
```
The scenario must launch Chromium with `--use-fake-device-for-media-stream` and
`--use-fake-ui-for-media-stream` (extend the driver's launch args for this scenario). Drive
a chat, open the video-note recorder (hold the camera button), then confirm + screenshot
(`.tmp/drive/*.png`):
- Tapping the pause control **pauses**: the timer + progress ring freeze; the control shows
  a resume affordance (SC-001, SC-004, US1/US2).
- Tapping again **resumes**: timer + ring continue from where they paused, not restarted
  and not jumped forward by the paused duration (FR-002).
- **Send** from the paused state finalizes and sends one clip whose duration equals the
  recorded time; **Delete** from the paused state discards and releases the camera
  (SC-002/SC-003/SC-005, US3).

## Roadmap
- `make roadmap` after the spec's `**Status**` changes (never hand-edit ROADMAP.md).
