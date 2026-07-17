# Quickstart / Manual Smoke: spec 1014

Validates multi-size thumbnails + the album-view overhaul on the live dev stack (`make start`) and/or
the `drive/` harness. Two accounts (A, B).

## US1 — thumbnails everywhere, before download
1. On B, turn auto-download OFF (Settings → media). On A, send an image to B.
2. On B: the chat bubble **and** the all-media grid show a preview **without** downloading the full
   image. (DevTools: no full-image blob fetch.)
3. Send 100+ images to a chat; scroll it — smooth, no full-resolution decode per bubble (bubbles use
   the bubble tier).
4. Open the all-media grid, leave, reopen → thumbnails appear instantly (persisted, no regenerate).
5. Open the viewer → the bottom strip uses the smallest tier; the main image is the full image.
6. Send a video → grid/strip show right-sized thumbnails derived from its poster (no re-encode).

## US2 — robustness
1. Open the viewer on an item, then (from another device or the menu) delete/clear that item, or all
   media in the chat → the viewer shows a placeholder or closes gracefully (never a broken image / crash).
2. View a not-yet-downloaded or cleared item → a clear placeholder (not a broken image).
3. Swipe a 200-image album end-to-end → memory stays bounded (off-screen full images released).
4. Pinch-zoom an item, then swipe fast → the next item opens at fit (no zoom bleed); active item correct.

## US3 — navigation
1. Open a 40-image album → a position indicator ("3 / 42") is visible.
2. Use ←/→ to move, Esc/back to close (desktop). Focus is trapped while open and returns to the opener.
3. As you move, the bottom strip keeps the active thumb centered.
4. Open the viewer from the grid, scroll deep, close → you return to the same grid scroll position.

## US4 — cleanup
1. Storage management: per-type and per-chat totals include thumbnail bytes, shown distinctly from
   originals.
2. Delete a chat's images → their thumbnails are gone too (no orphans; storage drops by both).
3. "Free space, keep previews" → the full-resolution originals are removed **permanently** (a confirm
   dialog says so); the bubble/grid/strip previews still render, and the viewer shows the kept
   (upscaled) preview — there is no re-download.
4. From a chat's all-media screen, cleanup defaults to **this chat**; an app-wide option is available.

## US5 — a11y / RTL / theme
1. Screen reader: images and viewer controls announce meaningful labels; the viewer is operable by
   keyboard alone.
2. Switch to an RTL locale → album swipe direction and strip order are correct (no inversion).
3. Light mode → the viewer follows the app theme (light surface + dark chrome/text), not a forced
   black; dark mode → dark surface + light chrome. Contrast is adequate in both.

## Backfill
- After upgrading on a device with existing media, confirm older images/videos gain tiers in the
  background (grid/bubble previews appear for history) without blocking the UI.

## Gates (Definition of Done — Constitution VII)
- `npm run build` · `npx vitest run` · `cd server && go build ./... && go vet ./... && go test ./...`
  (unchanged) · `make db-up && npm run test:e2e` (incl. the new media/thumbnail + viewer specs). All green.
