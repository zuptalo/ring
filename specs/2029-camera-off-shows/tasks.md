# Tasks: Camera Off Shows Your Picture (spec 2029)

**Input**: spec.md, plan.md. **Tests**: REQUIRED (bug band — failing regression first, constitution III).

## Phase 1: User Story 1 - Peers see my picture when my camera is off (P1)

- [X] T001 [US1] Failing e2e first: `e2e/camera-off-avatar.spec.ts` — 1:1 video call (upgrade flow from calls.spec.ts), both sides receiving video; A `toggleCamera()` → assert B's avatar stage (`.audio-stage`) visible + new testhook `remoteVideoMuted()` true; A toggles on → live video back. Confirm FAIL today.
- [X] T002 [US1] Receiver 1:1: `mute`/`unmute` listeners on remote video tracks in `ontrack` (`src/composables/useCall.ts:784`), feeding an exported `remoteVideoMuted` ref (init muted; reset on teardown); testhook `remoteVideoMuted()`.
- [X] T003 [US1] Receiver mesh: per-peer muted map where remote tracks are wired (`src/services/call/mesh.ts:840-848`), re-emitting the streams snapshot on mute/unmute (same as addtrack/removetrack) so tiles recompute; expose per-peer muted to the tile model.
- [X] T004 [US1] UI: `mainHasVideo`/`pipHasVideo` (`src/views/detail/CallActivePage.vue:563-568`) treat a muted remote slot as no-video; `tileHasVideo` (`:844-847`) same for non-self tiles.
- [X] T005 [US1] Sender: `toggleCamera()` (`useCall.ts:3100`) detaches/re-attaches — 1:1 `videoSender().replaceTrack(null)` / re-attach from `localStream`; group via new `MeshSession.setCameraOff(off)` fanning out per leg (skip legs suspended by adaptation; `buildLeg` consults the flag for late joiners). T001 goes green.

## Phase 2: User Story 2 - Camera-off survives the call's other moves (P2)

- [X] T006 [US2] Ownership guards: adaptation recovery never re-attaches while `cameraOff` (`useCall.ts:3201-3205`, `mesh.ts:548-554`); camera-on re-attach skips adaptation-suspended senders/legs; `replaceOutgoingVideo` (`useCall.ts:3416`) + `mesh.replaceVideoTrack` (`mesh.ts:421-432`) swap the local track but leave senders detached while off; hold/resume (`useCall.ts:347`, `mesh.ts:935-949`) re-attach video only when `!cameraOff`; screen-share/upgrade set `cameraOff=false` before attaching.
- [X] T007 [US2] Extend the e2e with the flip-while-off case (flip camera during off → B keeps avatar; on → B gets video from the flipped camera) if the fake-device environment permits a second camera; otherwise cover flip-while-off with a vitest unit around the gating helper and note it. NOTE: flip-while-off is not exercisable in the fake-device e2e environment (single fake camera); the gate lives in replaceOutgoingVideo/mesh.replaceVideoTrack (cameraOff early-return) and is deferred to the real-device pass.

## Phase 3: Polish

- [X] T008 Gates: new e2e green, `npx vitest run`, `npm run build`; drive-harness 3-person group call screenshot (one camera off → avatar tiles on the other two) + confirm sender kBpsUp ≈ 0 while off (SC-002).

## Dependencies

T001 first (red). T002 ∥ T003 (different files), then T004, then T005 (green), then T006 → T007 → T008.
