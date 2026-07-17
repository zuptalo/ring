# Quickstart: 1028 Robust Calls + Add-to-Call — implementation slices

**Plan**: [plan.md](./plan.md) | Ordered so each slice is independently landable and
tests come first inside every slice (Red → Green). Riskiest change (promotion) is
isolated in Slice 3 behind the proven late-join path.

## Slice 0 — Capacity gate (pure, no WebRTC)

1. `src/services/call/capacity.test.ts` first: `capOf`, `headcount` (distinct roster ∪
   invited ∪ self), `remainingSlots`, `canAdd` — incl. invited-counts-against-cap, the
   5th-video / 9th-audio boundaries, and the US6 combined headcount.
2. Implement `src/services/call/capacity.ts`. Wire `callRemainingSlots()` in useCall to it.

## Slice 1 — Add people to an EXISTING group call (US2, no promotion yet)

1. Failing e2e (`e2e/call-add-merge.spec.ts` part 1, AUDIO 3→4): A+B+C in a group
   audio call; A adds D; D rings, accepts, meshes with A, B, AND C (assert from B).
2. `inviteToRoom(ids)` in useCall (dedup + `canAdd` + add to invited + `call-ring`).
3. `Add people` button + contact picker in `CallActivePage.vue`, gated by
   `callRemainingSlots()`.
4. drive: extend `group-call-4.mjs` to add a 4th mid-call.

## Slice 2 — Pre-emptive cap gate (US3)

1. Failing e2e (`e2e/call-add-cap.spec.ts`): fill an audio call to 8 → Add people
   disabled/blocked with reason; a video call to 4 → blocked; just-below allowed.
2. Enforce `canAdd` in the picker (disable over-cap) + the action; server `call-full`
   remains the backstop (assert the local call is undisturbed on any refusal).

## Slice 3 — Promotion 1:1 → mesh (the risky core) + `joinroom`

1. Failing unit: `joinroom` seal/open round-trip; the `call-ice` dispatch routes a
   `joinroom` signal to the room-join handler.
2. Failing e2e (`call-add-merge.spec.ts` part 2, AUDIO): A+B in a 1:1; A promotes →
   both land in a mesh room reusing capture; assert B auto-followed (no ring) and got
   the join cue.
3. Implement `sendJoinRoom` (signalling), the `joinroom` dispatch case, and
   `ensureActiveIsRoom()` (mint room, MeshSession.start(existingStream), send joinroom,
   tear down 1:1 PC on leg connect). Add the promotion timeout / clean half-formed-room
   fallback.

## Slice 4 — Merge an incoming DIRECT caller (US1)

1. Failing e2e (AUDIO 1:1 + 1): A+B in a call; C calls A; A taps **Add to call** →
   `ensureActiveIsRoom()` then send `joinroom` to C; assert A, B, C all meshed, A's
   capture reused (SC-006), and if C declines the call is unaffected (FR-004).
2. `Add to call` action in `IncomingCallOverlay.vue` (direct caller) → `mergeIncoming`.
3. Kind reconciliation (D4): C video-calls an audio A+B ≤4 → consent-gated upgrade
   runs; >4 → C audio-only (unit-test the decision; e2e the ≤4 upgrade path on 2-person
   proxy where feasible).

## Slice 5 — Merge coexists with hold/swap (US4)

1. Failing e2e (extend `call-waiting.spec.ts`): A active with X, holding Y; C calls; A
   merges C into X; assert Y still held + paused; swap to Y works; single-held-slot
   invariant holds.
2. Add-in-flight guard so an add completes/cancels cleanly before a swap parks the call
   (FR-014).

## Slice 6 — Merge an incoming GROUP INVITE (US6)

1. Failing e2e (AUDIO): A+B in a call; C invites A to a group with D; A **Add to call**
   → fold C+D into A+B within cap; assert one combined call, dedup of any shared member;
   and a separate case where the combined headcount exceeds the cap → blocked with reason
   (SC-009).
2. `mergeGroupInvite()`: `canAdd(combined)` → `ensureActiveIsRoom()` →
   `inviteToRoom(inviteRoster − present)` → `call-leave` the invite room. `Add to call`
   on a group invite in `IncomingCallOverlay.vue`.

## Slice 7 — Robustness pass (US5)

1. Failing e2e/drive: concurrent join+leave on an audio mesh; simultaneous add of the
   same person (dedup); invitee reload mid-ring (reuse spec 2012) then accept → no
   duplicate, no stuck ringing tile.
2. Fix anything the churn tests expose in `applyRoster`/`inviteToRoom`/cue.

## Slice 8 — Cleanups + video validation

1. Fix the misleading "SFU" comments in `useCall.ts` (`~L1346`, `~L1526`); grep + remove
   any dead SFU remnants (no behaviour change; suite stays green).
2. drive `promote-1to1-video.mjs`: promote a 1:1 to a 3-way VIDEO call on the live stack
   (real-device/interactive validation — NOT headless CI).
3. Verify **no `server/` diff**: `cd server && go build ./... && go vet ./... && go test
   ./...` green with the server untouched.

## Gates before PR

```sh
npm run build            # vue-tsc + vite
npx vitest run           # unit + coverage floors
npm run test:e2e         # Playwright (needs make db-up) — audio meshes + 2-person proxies
cd server && go build ./... && go vet ./... && go test ./...   # untouched, verified
```

`/speckit-checklist` (crypto/ZK — required for the `joinroom` signal) generated + satisfied;
security review requested on the PR. 3-person **video** mesh validated via drive/real device,
never headless CI.
