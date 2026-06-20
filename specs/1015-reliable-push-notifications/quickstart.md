# Quickstart: Verifying Reliable Push & Redesigned In-App Notifications

How to build, test, and manually verify each user story. Run the CI gates before
claiming any slice done (see CLAUDE.md):

```sh
npm run build                 # client typecheck (vue-tsc) + vite build
cd server && go build ./... && go vet ./... && go test ./...   # server
npm run test:e2e              # Playwright (needs `make db-up`)
```

## Local stacks

- **Hermetic e2e**: `npm run test:e2e` — isolated ringd on :8081, Vite on :5174,
  throwaway `ring_e2e` DB. Best for friend-request push + toggle assertions.
- **Live driving**: `make start`, then the `drive/` harness (multi-user, real
  UI, screenshots in `.tmp/drive/`) to *see* the banner redesign and per-chat
  behavior. iOS/Android web-push reliability needs real installed PWAs (see below).

## US1 — Reliable delivery + complete decryption

1. Pair two users (`drive/` or e2e). Background the recipient; send a message.
2. Expect a notification with the **real sender + decrypted text** within a few
   seconds; no duplicate generic + rich pair (SC-002, SC-009).
3. Fault-inject: lock the keystore (PIN gate) before the push → expect a
   content-free "New message"; unlock → content appears (FR-004).
4. Regression test: assert the relay **ack** is sent only after the message is
   persisted **and** notify-dispatch ran (FR-005 ordering).

## US2 — Friend-request push

1. Account B's app fully closed. From A, send a connection request.
2. Expect B to receive a push notification ("New friend request") → taps to the
   requests view (SC-004).
3. B accepts (then, separate run, rejects) with A closed → A gets
   "accepted"/"declined" push.
4. Server unit test: `requestConnection`/`acceptConnection`/`rejectConnection`
   each invoke the fake `Notifier.NotifyConn` for the right user (TDD, red first).

## US3 — Redesigned in-app banner

1. App open on a chat (composer visible) and on a call screen; trigger an incoming
   message from another chat.
2. Expect a **translucent green** banner **below the header**, never overlapping
   header/back, composer, or call controls (SC-005); legible in light + dark.
3. Dismiss via the close affordance and via swipe-up; confirm it does not reappear
   for the same event and tapping still opens the chat.

## US4 — Global + per-chat in-app toggles

1. Settings → Notifications → turn **In-app notifications** off. Trigger a message
   while app open → no banner anywhere; badge still updates; system push intact.
2. Turn it back on; in one chat's settings disable in-app → that chat shows no
   banner; other chats still banner (SC-006).

## US5 — Per-chat privacy controls

1. In a chat's settings set **Show content = Badge only** → incoming message bumps
   the badge with no banner/system text (SC-007).
2. Set **Generic** → placeholder notification; **Full** → decrypted preview.
3. Set **Web push = off** → with the app closed, no system notification and no
   call ring for that chat (FR-022a); badge reconciles on open.

## Visual verification — `showcase/` (`npm run showcase`)

The banner redesign (US3) is reviewed visually with the project's existing
capture harness, not pixel snapshots:

```sh
make db-up
npx playwright install chromium     # (webkit optional, for true iOS Safari)
npm run showcase                    # → showcase/output/<device>/<theme>/
```

- Inspect the new banner capture states on iphone / ipad / android / desktop in
  **both light and dark**: green translucency + contrast (FR-013), and that it
  sits **below the header** and clears the composer / call controls (FR-014).
- The deterministic non-overlap guard (banner rect vs header/composer/call-control
  rects = 0 intersection, SC-005) lives in the `e2e/` in-app spec, so it runs in
  CI alongside the logical assertions; the showcase shots are the human-review
  complement.

## Zero-knowledge spot-check (SC-008)

- Inspect push payloads: only `{"t":"msg"|"call"|"conn"}` — no names/content.
- Confirm per-chat prefs and the global in-app toggle never appear in own-data
  sync requests (they live only in IndexedDB).
