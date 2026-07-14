# Quickstart: verifying reaction notifications & reply escalation (spec 1048)

## Unit tests (fast loop)

```sh
npx vitest run src/services/sw-inbox.reactions.test.ts src/services/notify.reactions.test.ts
npx vitest run src/services/sw-inbox.test.ts src/services/notify-policy.test.ts   # no regressions
npm run build                                                                     # typecheck gate
```

## Live-app verification (drive/ harness against `make start`)

```sh
make start           # dev stack (other terminal)
HEADED=1 node drive/scenarios/dm-and-react.mjs   # existing reaction scenario as a base
```

Scenario shape for this feature (see `drive/README.md`; ~15 lines):
1. `createAccount` A + B, `pair(a, b)`; A sends B a message.
2. B reacts ❤️ → **A** (on `/tabs/chats`, chat NOT open) sees an in-app banner
   "B reacted ❤️ to: …" — `shot()` it; assert via the banner DOM (`.notify-banner`, the
   shared overlay — appToast/banners are NOT ion-toast).
3. A opens the chat, B reacts again → no banner (active-chat suppress), tone only.
4. Toggle `notifications.message.reactions` off via `__ringTest`/settings → react again →
   nothing appears; chat list still updates its "reacted" preview line.
5. Group with A+B+C, A muted the group: C replies to A's message (reply affordance, not a
   bare message) → banner despite mute, wording "replied to you" under generic content.
   B (not the replied-to author) gets nothing while muted.

Gotchas (from prior specs): onboarding gate blocks nav until "I'VE SAVED IT"; use the
driver's `waitForMessage`/`poll`; 1:1 chat ids differ per device (`chatWith` each side).

## e2e (hermetic)

```sh
npm run test:e2e -- e2e/reaction-notify.spec.ts e2e/mentions.spec.ts
```

Needs `make db-up`. The SW-closed path is asserted at the unit level (buildNote contract
tables) — e2e covers the live-page path like `mentions.spec.ts` does for spec 1020.

## Closed-app / real-push spot check (manual, iOS PWA)

1. Install the PWA (dev deployment: client changes need `npm run build` to show —
   HMR only reaches `:5173`).
2. Close the app on device A; react from device B → device A shows the OS notification,
   coalesced under the chat; tap lands in the chat.
3. Toggle reactions off on A, react 3+ times from B, then send a plain message —
   the message still arrives as a push notification (subscription not revoked = FR-013/SC-003).
