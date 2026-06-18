# Quickstart: Smooth Chat-History Scroll-Up

How to exercise and verify, mapped to the Success Criteria (SC) and scroll invariants (INV).

## Run locally

```sh
make start          # PostgreSQL + ringd + Vite at http://localhost:5173
```

## Multi-user exercise (US2) — the `drive/` harness

Drives the live app as 5 users, connects them, holds 1:1 + group conversations across
every message kind, builds a lengthy chat, and scrolls up.

```sh
node drive/scenarios/lengthy-chat-scroll.mjs        # headless
HEADED=1 node drive/scenarios/lengthy-chat-scroll.mjs   # watch it
```

- Confirms: 5 users connect via request+accept; text / voice-audio / video-message /
  image-upload / video-upload delivered + rendered for all participants in 1:1 + group
  (SC-005); a lengthy chat opens and scrolls back; screenshots land in `.tmp/drive/`
  (read them to confirm continuous content, no blank flash/snap — SC-007).

## Scroll smoothness (US1) — fast bulk-seed + assertions

A 5,000-message chat is seeded instantly via the dev hook (no real send pipeline):

```js
await window.__ringTest.seedMessages(chatId, 5000, { mediaEvery: 12, fromIds });
```

Then verify (automated in `e2e/chat-media-scroll.spec.ts`):

- **SC-002 / INV-1**: capture a bubble's `boundingClientRect().top`, flick up so an older
  page loads, re-read after it lands → delta ≤ 2px (no jump).
- **SC-003 / INV-2**: the older batch's first `[data-mid]` is in the DOM before
  `scrollTop` reaches 0 (page-before-top; no stall/snap).
- **SC-008 / INV-3**: after scrolling far up and back down, the rendered `.bubble[data-mid]`
  count stays ≈ `ROW_CAP` (bounded DOM) and resolved media ≤ `MAX_MEDIA` (bounded memory).
- **SC-004 / INV-4**: seed an extra inbound message/reaction while scrolled up → `scrollTop`
  unchanged (no yank).
- **SC-006 / INV-6**: tap a reply-quote whose target is older than the window → it mounts
  and centers within 1.0s (no "not available").

## Manual smoke

- Open a long chat, flick up hard repeatedly: continuous, no stall/snap, the line you were
  reading stays put. Send/receive a message while scrolled up: the view doesn't jump.
- Group chat: avatars/day-dividers at the top edge don't flicker as older rows load (INV-7).
- Best on a **real device** for iOS momentum (INV-5) — emulation can't fully prove fling feel.

## Automated checks (definition of done)

```sh
npm run build                 # vue-tsc + vite
npx vitest run                # window/pagination/anchor/group-edge pure helpers
cd server && go build ./... && go vet ./... && go test ./...   # unchanged, must stay green
make db-up && npm run test:e2e   # incl. the 5k-seeded scroll assertions
```

All green = done (Constitution VII). The `/speckit-checklist` zero-knowledge gate was run and
passed (checklists/zero-knowledge.md, 14/14) — confirming Principle I is unaffected.
