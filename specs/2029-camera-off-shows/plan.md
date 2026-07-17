# Implementation Plan: Camera Off Shows Your Picture (spec 2029)

**Branch**: `fix/2029-camera-off-shows` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

## Summary

Two halves, client-only, no wire change:

1. **Sender** — `toggleCamera()` (`src/composables/useCall.ts:3100`) stops at `track.enabled = false`, which keeps streaming black frames. Detach the outgoing track instead: 1:1 via `videoSender().replaceTrack(null)`, group via a new mesh fan-out (`MeshSession.setCameraOff`). This reuses the exact mechanism the adaptive tier-'off' pause already uses (`useCall.ts:3195`, `mesh.ts:543`), so it is proven renegotiation-free.
2. **Receiver** — nothing reacts to the resulting remote-track `mute` today: the 1:1 `ontrack` (`useCall.ts:784-787`) installs no listeners, and all three UI conditions (`mainHasVideo`/`pipHasVideo` `CallActivePage.vue:563-568`, `tileHasVideo` `:844-847`) key off track *presence*. Add `mute`/`unmute` listeners feeding reactive state (a 1:1 `remoteVideoMuted` ref; a per-peer muted set for mesh tiles) and fold it into those conditions. This also fixes the pre-existing dark-tile bug when adaptation pauses a leg at tier 'off' (same detach, same blind receiver).

## Constitution Check

I: no wire change, server unaffected — PASS (spec has ZK section). II: spec 2029, hotfix band — PASS. III: failing two-browser e2e first (bug band) — PASS. IV: no crypto surface — PASS (signalling union untouched, asserted by SC-004). VII: gates below. XI: avatar surfaces already exist (`.audio-stage`, `.tile-camoff`) — no new UI.

## Ownership rules (the part that can go wrong)

The "sender has no track" state gains a second owner (user camera-off) beside adaptation (`oneToOneVideoSuspended` `useCall.ts:3150-3204`; `leg.videoSuspended` `mesh.ts:533-554`). Rules, enforced at every attach site:

- **Adaptation may never re-attach while `cameraOff`** — guard the recovery branches (`useCall.ts:3201-3205`, `mesh.ts:548-554`).
- **Adaptation's suspend on an already-detached sender is a no-op** (both branches already check `sender.track` — verified).
- **Camera-on re-attach must not override adaptation**: re-attach only what adaptation hasn't suspended (1:1: skip if `oneToOneVideoSuspended`; mesh: per-leg skip if `leg.videoSuspended`) — adaptation re-attaches on recovery as it does today.
- **`replaceOutgoingVideo`/`mesh.replaceVideoTrack` (camera flip)**: while `cameraOff`, swap the *local* track (so camera-on uses the new camera) but leave senders detached (`useCall.ts:3416`, `mesh.ts:421-432`).
- **Hold/resume**: `set1to1Senders(true)` (`useCall.ts:347`) and `mesh.resume()` (`mesh.ts:935-949`) re-attach video only when `!cameraOff`.
- **Screen share / video upgrade**: both set `cameraOff = false` (`useCall.ts:3490`, `:3551`) — ensure that happens *before* the sender attach so the gate passes (today's semantics: sharing means video on).

Mesh learns `cameraOff` via `setCameraOff(off)` storing a private flag; `buildLeg` consults it so late joiners don't get video while off.

## Receiver-side state

- 1:1: `remoteVideoMuted = ref(true)` (tracks start muted until first RTP — avatar-until-first-frame is correct); listeners installed in `ontrack` per video track; reset on call teardown.
- Mesh: per-peer muted map maintained where remote tracks are wired (`mesh.ts:840-848`); on mute/unmute re-emit the streams snapshot (same mechanism as `addtrack`/`removetrack` at `:847`) so `remoteStreams`/tiles recompute; tiles read the map through the rebuilt tile model.
- UI: `mainHasVideo`/`pipHasVideo` add "remote slot ⇒ not remote-muted"; `tileHasVideo` non-self adds "peer not muted".
- Testhook: `remoteVideoMuted()` (1:1) for the e2e.

## Regression test (red first)

New `e2e/camera-off-avatar.spec.ts`: video call A↔B (audio call + consented upgrade, the existing helper flow from `calls.spec.ts:46`), wait for inbound video frames both ways, then A `toggleCamera()` → assert B's avatar stage becomes visible (UI-level, `.audio-stage`) and `remoteVideoMuted()` reports true; A toggles back on → B's live video returns (avatar stage hides). Fails today (no mute handling → black video keeps "playing").

## Verification

- `npm run test:e2e -- camera-off-avatar` red → green; full `npx vitest run`; `npm run build`.
- Drive check: group call of 3, one turns camera off → other two tiles show the avatar (screenshot).
- SC-002 (zero outgoing bitrate while off) observable via the existing `callStats` kBpsUp in the drive console.
