# Quickstart: Hovering "Scroll to Latest" Button

How to exercise and verify, mapped to the Success Criteria (SC) and control behaviors (B).

## Run locally

```sh
make start          # PostgreSQL + ringd + Vite at http://localhost:5173
```

## Manual smoke (best on a real device for fade feel)

- Open a long chat and **scroll up** a screen or more → a small down-arrow control fades in at
  the bottom-trailing corner, above the composer (B-2 / SC-002/003).
- **Tap it** with nothing new → the view smoothly returns to the newest message and the control
  fades out (B-5 / SC-006).
- Scroll up again and have the peer send a few messages → the control shows a **count badge**;
  **tap it** → the view jumps to the **first** of those new messages and the badge clears (B-4 /
  B-6 / SC-005/006).
- Open the keyboard / show the reply or edit bar while the control is up → it stays **above the
  composer**, never overlapping the input (B-7 / SC-004).
- Send your own message (or one arrives from another device) while scrolled up → the badge does
  **not** increment (incoming-only, B-6).
- Check **light/dark** and an **RTL** locale → the control sits on the trailing side and is
  themed correctly (B-8 / SC-007).

## Automated checks (definition of done)

```sh
npm run build                 # vue-tsc + vite
npx vitest run                # chat-unread helpers (unreadSince, jumpButtonVisible)
cd server && go build ./... && go vet ./... && go test ./...   # unchanged, must stay green
make db-up && npm run test:e2e   # incl. e2e/scroll-to-latest.spec.ts (appear/hide, tap, badge)
```

The e2e seeds/sends messages via the dev `window.__ringTest` hook (as in spec 1011) to drive a
scrolled-up state, an incoming burst, and the tap-to-first-unread / tap-to-newest paths.

All green = done (Constitution VII). No `/speckit-checklist` is required — this spec touches no
zero-knowledge or crypto surface (Principle I/IV untouched); it is a client-only view affordance.
