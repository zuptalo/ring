# Quickstart: Ephemeral Activity Indicators

How to exercise and verify the feature locally and in CI. Maps each Success
Criterion (SC) to a check.

## Run locally

```sh
make start          # PostgreSQL + ringd (air) + Vite at http://localhost:5173
```

Register two test accounts (dev seeds invite codes `RINGDEV1`…`RINGDEV9`,
`TESTCODE`) in two browser profiles/windows, connect them as friends, and open
the same 1:1 chat in both.

## Manual smoke (per Success Criterion)

- **SC-001 (typing, 1:1)**: In window A start typing. In window B the chat header
  shows **"typing…"** in place of Online/last-seen within ~1s. Stop in A → it
  clears within ~6s; or send → it clears immediately and the message arrives.
- **SC-002 (recording, 1:1)**: In A tap the mic and record a voice message → B
  shows **"recording audio…"**. Cancel/send → clears. Hold the camera button to
  record a video note → B shows **"recording video…"**. Cancel/send → clears.
- **SC-003 (never persists)**: While B shows an indicator, reload window B → no
  indicator unless A is still composing. Confirm no activity entry in IndexedDB
  (it is in-memory only) and no server row.
- **SC-004 (toggle + reciprocity)**: In A, Settings → Privacy → turn **"Typing &
  recording indicators"** off. Now A composing shows nothing in B, **and** B
  composing shows nothing in A (reciprocity). Two other accounts with it on still
  see each other.
- **SC-005 (auto-expire on disconnect)**: In A start typing, then kill A's network
  / close the tab mid-typing. B's indicator auto-clears within ~6s (no stuck
  indicator).
- **SC-006 (group coalescing)**: In a 3-member group, have two members type at
  once → the indicator shows up to two names then "several people are typing…".
  An offline member produces no indicator.

## Automated checks

- **Server relay** (`server/internal/ws/activity_test.go`, in-memory fake store):
  ```sh
  cd server && go test ./internal/ws/...
  ```
  Asserts fan-out, `from`-stamping, blocked-pair drop, and that an offline
  recipient causes the frame to be dropped with **nothing enqueued or persisted**
  (SC-007).
- **Client unit** (`vitest`): `useTyping` applies/refreshes/expires entries,
  coalesces by sender, and is a no-op when the privacy toggle is off.
- **e2e** (`e2e/activity-indicators.spec.ts`, real multi-account WS):
  ```sh
  make db-up && npm run test:e2e
  ```
  Covers SC-001…006 across two/three accounts via the `window.__ringTest` hook.

## Definition of done (gates)

```sh
npm run build                 # vue-tsc typecheck + vite build
cd server && go build ./... && go vet ./... && go test ./...
npm run test:e2e              # behavior changed → e2e required
```

All green = done (Constitution VII). A `/speckit-checklist` (Principle I/IV) must
also be completed and clean before `/speckit-implement`.
