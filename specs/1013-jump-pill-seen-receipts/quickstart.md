# Quickstart / Manual Smoke: spec 1013

Validates the expanding pill + visibility-driven Seen receipts on the live dev stack
(`make start`) and/or the `drive/` harness. Two accounts (Sender S, Recipient R).

## Setup
1. `make start` (dev stack: Vite :5173 → ringd :8080).
2. Create two accounts and pair them (or use `drive/` `createAccount`/`pair`).
3. As S, send a backlog to R: several messages across time, then a few more "today".

## US1 — the expanding pill
1. As R, open the chat and scroll up so the control appears.
2. With nothing not-yet-Seen below, the control is a **plain circle** (chevron only).
3. Have S send 3 messages while R stays scrolled up → the control becomes a **pill showing "3"**,
   growing as more arrive.
4. Tap the pill → R returns to the first not-yet-Seen message; as R reads down the count drops and
   the control **shrinks back to a circle**.
5. Check light/dark (toggle theme) and RTL: pill caps stay fully rounded, count inline, no
   composer overlap, smooth grow/shrink.

## US2 — Seen only when actually viewed
1. Reset: S sends 10 messages while R is away. (Privacy toggle ON, default.)
2. As R, open the chat → it lands at the **first not-yet-Seen** message (not the bottom).
3. On S, confirm only the messages currently on R's screen show **Seen**; the ones still below
   (off screen) remain **Delivered** (not Seen).
4. As R, do **not** scroll. On S, confirm the off-screen messages stay not-Seen.
5. As R, scroll an off-screen message ≥50% into view → on S it flips to **Seen** within ~5 s.
6. Toggle **Seen receipts OFF** (Settings → Privacy). Repeat: as R view messages → on S nothing
   advances to Seen (0 receipts).

## US3 — catch-up while reading down
1. With a backlog of not-yet-Seen messages, as R bring a message **partway down** ≥50% into view.
2. On S, confirm that message **and all older** not-yet-Seen messages flip to Seen, while messages
   still **below** (newer, off screen) remain not-Seen.
3. Scroll back up to the older ones → confirm **no duplicate** receipts (S doesn't re-flip / no
   resend storm).

## Persistence (FR-018)
1. As R, view some (not all) messages, then **fully reload the app** (or restart).
2. Reopen the chat → the pill count reflects only the **still-unseen** messages (it did not
   re-inflate to everything), and S receives **no** duplicate Seen receipts on reopen.

## Foreground gate (FR-012)
1. As R, open the chat with unseen messages visible, then **background the app/tab** before
   scrolling.
2. On S, confirm no new Seen while R is backgrounded; foreground R → Seen advances for what's
   now ≥50% visible.

## Regression (spec 1011/1012)
- Scroll-up momentum is unchanged (no blank flash, no yank when a message arrives while scrolled
  up). The open-at-first-unseen seek lands smoothly without fighting momentum.

## Gates (Definition of Done — Constitution VII)
- `npm run build` · `npx vitest run` · `cd server && go build ./... && go vet ./... && go test ./...`
  · `make db-up && npm run test:e2e` (incl. the new `e2e/seen-on-view.spec.ts`). All green.
