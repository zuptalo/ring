# Quickstart: spec 1045 — rearrange pinned chats + peek

## Run it

```sh
make start          # dev stack: Vite :5173 → ringd :8080
```

Open http://localhost:5173, register/log in (dev invite codes `RINGDEV1`..`9`),
have a few chats, pin 2–4 of them (swipe right → Pin, or row long-hold → peek →
Pin).

## Try the gestures (Chats tab, "All" chip)

- **Rearrange**: press a pinned avatar ~½ s until it lifts, drag to another
  slot, release. Order sticks — send yourself messages in another pin and watch
  it *not* move.
- **Unpin by drag**: lift a pinned avatar, drag it down over the list, release.
- **Pin by drag**: press a list row ~½ s — it shrinks into a round avatar —
  drag it into the grid, drop at any slot. With 9 pins already, a ⊘ badge
  appears on the floating avatar and dropping does nothing.
- **Peek**: press and HOLD (~1 s, don't move): a preview of the latest
  messages opens. Tap the card → opens the chat; tap outside → closes; menu
  below: Pin/Unpin, Mark as Unread/Read, Delete, More….

## Verify

```sh
npm run build                    # vue-tsc typecheck + vite build
npx vitest run src/utils/chat-pins.test.ts src/utils/drag-math.test.ts
npm run test:e2e -- pinned-reorder   # needs `make db-up`
```

Multi-user reproduction with screenshots: `node drive/scenarios/…` (see
`drive/README.md`).
