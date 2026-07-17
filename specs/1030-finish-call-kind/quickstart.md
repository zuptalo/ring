# Quickstart: 1030 Finish Add-to-Call — implementation slices

**Plan**: [plan.md](./plan.md) | Ordered smallest/safest first; tests precede code in each
slice (Red → Green). Builds on the merged 1028 promotion/merge code.

## Slice 1 — Join cue (US2)

1. `src/services/call/join-cue.test.ts` first: `newJoiners` (excludes self, dedups vs
   announced, multiple new members, empty roster).
2. Implement `src/services/call/join-cue.ts`.
3. Failing e2e `e2e/call-join-cue.spec.ts` (audio): A+B+C in a group call, A adds D →
   every existing participant sees a "{name} joined the call" cue naming D; force a
   reconnect of an existing participant → NO cue.
4. Wire it into the `call-roster` handler in `useCall.ts` (per-call `announced` set,
   `appToast`, name via contacts/stream-owner map, "Someone" for a non-contact).

## Slice 2 — Kind reconciliation (US1)

1. `src/services/call/merge-kind.test.ts`: `videoCapableAfterMerge` (video call → true;
   audio ≤4 → true; audio >4 → false).
2. Implement `src/services/call/merge-kind.ts`.
3. Failing e2e `e2e/call-merge-kind.spec.ts` (audio): after promoting/merging to a ≤4
   audio group, the "Turn on video" affordance is available and turning it on works for
   one participant (no auto-camera on others); after a >4 audio group, turning on video is
   refused. (Video RESULT — cameras actually flowing among 3 — is a drive/real-device
   check, not headless.)
4. Ensure `meta.kind`/roster are correct post-merge so `toggleVideoMode` gates right; add
   the affordance verification. (Likely no behavioural code change — mostly confirm + test.)

## Slice 3 — Add-in-flight guard + held coexistence (US4)

1. Failing e2e `e2e/call-merge-held.spec.ts` (audio): active call X + held call Y; merge a
   caller into X; assert Y stays held/paused and swaps correctly; single-held rule holds.
2. Add the `addInFlight` guard: set around `ensureActiveIsRoom`+`inviteToRoom`;
   `swapCalls`/`parkActiveAsHeld` await it (or no-op with a toast) so a swap can't race a
   promotion (FR-010). Confirm merge/add never touch `heldSlot`.

## Slice 4 — Group-invite merge (US3)

1. Failing e2e `e2e/call-group-merge.spec.ts` (audio): A+B in a call; C starts a group
   inviting A (+D); A's prompt shows **Add to call**; choosing it folds C(+D) into A's call
   within the cap, a member in both dedups to one participant; a separate over-cap case is
   blocked with a reason and leaves both calls unchanged.
2. `handleGroupInvite`: raise `incomingSecond` (kind group) instead of auto-busy when a
   slot is free.
3. `mergeGroupInvite()` (combined `canAdd` → `ensureActiveIsRoom` → `inviteToRoom(members −
   present)` → `sendGroupLeave` → clear slot); extend the capacity/invite-plan unit tests
   for the combined headcount.
4. UI: **Add to call** for a group second-incoming in `CallActivePage.vue`.

## Slice 5 — Churn (US5)

1. Failing e2e/drive `e2e/call-churn.spec.ts` + `drive/scenarios/call-add-churn.mjs`:
   concurrent join+leave converges; two callers add the same person → one leg (dedup);
   invitee reload mid-ring → clean rejoin; promotion timeout (peer never follows, nobody
   else joins) → clean end via the idle timeout, no orphaned ringing tile.
2. Fix only what the churn tests expose (reuse `rosterChain`/`applyRoster`/`planInvite`/
   spec-2012 recovery/`armGroupIdleTimeout` — no new mechanism).

## Slice 6 — Video validation + gates

1. `drive/scenarios/merge-video.mjs`: merge into a ≤4 call, turn on cameras, confirm video
   flows (real device / live stack — NOT headless CI).
2. Verify **no `server/` diff**: `cd server && go build/vet/test` green + `git diff --stat
   origin/develop -- server/` empty.
3. Full gates: `npm run build`, `npx vitest run`, `npm run test:e2e`; keep ALL existing
   call e2e/unit green.
4. Bump spec `**Status**:` → `in-review`; `make roadmap`.
