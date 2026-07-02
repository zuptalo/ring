# Phase 0 Research: Finish Add-to-Call

**Spec**: [spec.md](./spec.md) | **Date**: 2026-07-02

This completes spec 1028's deferred items on top of the merged promotion/merge code.
Research is a precise audit of the seams each item hooks into (the branch already
has #684 + #685), plus one happy discovery: the per-participant clarification makes
US1 mostly free.

## R1. Kind reconciliation (US1) — mostly ALREADY provided

**Finding**: Ring's group video is already per-participant with the exact cap the spec
wants. `toggleVideoMode` (`useCall.ts:2727`): for a group call it refuses when
`roster.length > VIDEO_MAX` (toast "Video is limited to 4 people"), else turns on
**only the caller's own** camera (`getUserMedia` → `groupSession.addVideoTrack` →
`meta.kind='video'`). The "Turn on video" button shows whenever `!isVideoMode`
(`CallActivePage.vue`). A promoted/merged call is an **audio group** (`convertActiveToRoom`
passes the active call's kind), so:
- Combined ≤ 4 → the "Turn on video" affordance is present and works (each person opts
  in; no auto-camera) — exactly the clarified behaviour.
- Combined > 4 → `toggleVideoMode` already refuses.

**Decision**: US1 is chiefly **verification + tests**, not new mechanism. The only code
touch: make sure the merged **video caller** (who joins an audio room) is presented the
same per-participant camera control and that the affordance/cap is correct after a
promotion (audio group, roster-driven). No auto-camera, no 1:1 `requestVideoUpgrade` for
the group (that stays 1:1-only). A tiny pure helper `videoCapableAfterMerge(kind,
combinedHeadcount)` encodes the ≤4 rule for a unit test.

**Alternative rejected**: a room-wide consent prompt or auto-enabling the merger's
camera — the clarification chose per-participant, no auto-camera.

## R2. Join cue (US2) — hook the roster update

**Finding**: `callMeta.value.roster = frame.members` is set in the `call-roster`
handler (`useCall.ts:3094`), server-authoritative. A transient network blip does NOT
change room membership (the leg reconnects; the server roster is unchanged), so a
roster-membership ADD is a genuine join, not a reconnect.

**Decision**: On each roster update, diff the new members against an "already announced
this call" set; for each genuinely-new member that is not self, show a transient
"{name} joined the call" via the existing `appToast`/cue infra (name resolved from
contacts / the stream-owner map; "Someone" for a non-contact). Reset the announced set
per call. Pure helper `newJoiners(prevAnnounced, nextRoster, selfId)` → the names to
announce, unit-tested (self excluded, re-adds not re-announced within a call, dedup).

**Alternative rejected**: firing off `onRemoteStreams` — streams can flap on a
reconnect; the server roster is the stable "who's in the room" signal.

## R3. Group-invite merge (US6/US3 here) — stop the auto-busy, add the fold

**Finding**: `handleGroupInvite` (`useCall.ts:1456-1461`) currently **auto-busies**
(`sendGroupBusy`) any group invite that arrives while `callState !== 'idle'`. So today a
group invite while you're in a call is silently declined — there is no "Add to call"
opportunity. The single waiting slot (`incomingSecond`) already supports
`kind:'group'` with `roomId`, and `acceptAndHold` already has a group-second path.

**Decision**:
1. In `handleGroupInvite`, when in a call AND a waiting slot is free
   (`canRaiseSecondIncoming()`), raise the invite into `incomingSecond` as
   `kind:'group'` (roomId + the invite's member set) instead of auto-busy; keep the
   auto-busy fallback when no slot is free (spec 2009 single-slot rule).
2. `mergeGroupInvite()`: `canAdd` over the **combined distinct** headcount (current
   roster+invited ∪ the invite's members) → if blocked, toast the reason and leave both
   calls unchanged; else `ensureActiveIsRoom()` → `inviteToRoom(inviteMembers − present)`
   (dedup handled by `planInvite`) → `sendGroupLeave(inviteRoomId)` so we're not in two
   rooms → clear the slot.
3. UI: the second-incoming prompt shows **Add to call** for a `kind:'group'` invite too
   (it already shows it for `kind:'direct'`).

**Alternative rejected**: a brand-new "combine rooms" server operation — the fold is
just ringing the invite's members into our existing room + leaving theirs; no server
change.

## R4. US4 — merge coexists with hold; add-in-flight guard

**Finding**: `mergeIncoming`/`addPeople` act only on the ACTIVE call and never read/write
`heldSlot`, so the held call is untouched by construction. The residual risk is a swap
firing WHILE a promotion/add is mid-flight (the active call is being converted).

**Decision**: a module-level `addInFlight` promise/flag set around
`ensureActiveIsRoom`+`inviteToRoom`; `swapCalls`/`parkActiveAsHeld` await it (or no-op
with a toast if a conversion is in progress) so an add completes before a park — no
half-open leg (FR-010). Plus an explicit e2e: active + held, merge into active, assert
held intact + swappable.

## R5. US5 — churn robustness

**Finding**: `applyRoster` is set-based and serialized through `rosterChain`; `planInvite`
dedups against `roster ∪ invited`; invitee reload reuses spec-2012 recovery unchanged.
Promotion-timeout: `enterGroupCall` already arms `armGroupIdleTimeout` (GROUP_NOBODY_MS,
60s) that ends a room where nobody else joins — so a promoted peer never following, with
no one else joining, already resolves cleanly.

**Decision**: mostly **tests** that assert convergence: concurrent join+leave, two
callers adding the same person (dedup to one leg), invitee reload mid-ring, and the
promotion-timeout path (peer never follows → clean end via the idle timeout, no orphaned
ringing tile). Fix only what the tests expose; no new mechanism planned.

## R6. No server changes (verify)

**Decision**: target zero `server/` diff (all four items are client-only). A task runs
`go build/vet/test` and asserts an empty `git diff --stat origin/develop -- server/`.

## R7. Testing under the CI constraint

- **Unit**: `videoCapableAfterMerge` (≤4 rule), `newJoiners` (cue diff), and the
  combined-headcount cap for group-invite merge (extend `capacity`/`invite-plan` tests).
- **e2e (audio + 2-person proxies)**: join cue fires for a new joiner and NOT for a
  reconnect; group-invite merge fits vs blocked + dedup; merge-leaves-held-intact; churn
  convergence; video-capable affordance present ≤4 / absent >4 after a merge.
- **drive/real device**: the actual video result of a merge (a merged call where people
  turn on cameras) and 3-person video churn — never headless.

All spec decisions resolved (the one clarification is folded into R1); no NEEDS
CLARIFICATION remain.
