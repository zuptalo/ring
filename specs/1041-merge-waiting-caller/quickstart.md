# Quickstart: Merge a waiting caller (spec 1041)

## Orientation (what already exists vs what this adds)

- ALREADY SHIPPED: promotion (`ensureActiveIsRoom` → `convertActiveToRoom`),
  the second-incoming "Add to call" (`mergeIncoming`/`mergeSecond`),
  capacity gates, hold/swap, `call-merge*.spec.ts` e2e coverage.
- THIS SPEC ADDS: the consent layer — `joinreq`/`joinreq-accept`/
  `joinreq-reject`/`joinreq-cancel` inner signals, the accepter prompt,
  rejection-final blocks, held-bar merge, request withdrawal — plus the
  avatar-circle fix.

## Where the logic lives

- `src/services/call/join-request.ts` — NEW pure module (request lifecycle +
  rejection-block rules). Start here; vitest-covered.
- `src/services/crypto/message.ts` — the `CallSignal.type` union.
- `src/services/call/signalling.ts` — `sendJoinRequest`/reply/cancel (the
  `sendSealedSignal('call-ice', …)` one-liners, like `sendJoinRoom`).
- `src/composables/useCall.ts` — merge entry points (`mergeIncoming`,
  `mergeSecond`, held-bar action) send requests instead of bare `joinroom`;
  `case 'call-ice'` dispatch gains the four branches; accepter prompt state;
  teardown withdrawal; the dialing-state gate for old senders' `joinroom`.
- `src/views/detail/CallActivePage.vue` — accepter consent prompt (cw-prompt
  idiom), held-bar "bring into this call", merge buttons honoring the block,
  and the one-line `.tile-avatar { height: auto; }` fix.

## Fast verification loop

```sh
npx vitest run src/services/call/join-request.test.ts
npm run build
npx playwright test call-merge-consent call-merge call-merge-held call-waiting --reporter=line
```

## Seeing it on the dev stack

1. `make start`; three browser profiles: A (in a call with C), B (caller).
2. B calls A while A talks to C → A's prompt shows "Invite to this call" →
   B gets "A asks you to join their call" over the dialing screen.
3. B joins → three-way room; B's camera state matches B's own attempt kind.
4. Repeat with B rejecting → A's invite affordance for B is gone for this
   call; swap/hold still work; B keeps ringing and times out to "No answer"
   with the normal missed-call trace on A.
5. Watch a camera-off participant's tile while people join/leave — the
   avatar stays a circle (was: tall ellipse).

## Gotchas

- Never send a bare `joinroom` to a party who hasn't accepted — that is the
  consent hole this spec closes. `joinroom` remains only for the in-call
  promote follow.
- Promote on ACCEPT, not on request (a reject must not strand a solo room).
- The accepter reuses their captured stream (WebKit: no second
  getUserMedia) and their OWN kind decides the camera (clarification A).
- Rejection blocks are per ongoing call and per party, in-memory only.
- No new timers: attempt timeouts and the prompt's 60s auto-drop stay
  authoritative; requests are withdrawn via `joinreq-cancel` on teardown.
- Copy voice: warm, plain, "you"; no em-dashes or semicolons.
