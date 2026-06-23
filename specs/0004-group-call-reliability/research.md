# Research: Group call reliability, adaptive quality, caps, cues & busy

Phase 0 decisions for spec 0004. Each resolves an unknown or fixes a technical
approach grounded in the existing code (`src/services/call/mesh.ts`,
`src/composables/useCall.ts`, `server/internal/ws/hub.go`, `server/internal/call/`).

## 1. Re-invite-after-leaving (US1)

**Decision**: A declining/dismissing (or unanswered) group invitee must tell the server to
stop its re-ring reminder loop; `call-leave` must cancel the leaver's own reminder.

> **Root cause corrected during implementation (TDD).** The originally-hypothesised cause —
> "the 60s `callBuf` isn't cleared on join, so a reconnect replays the invite" — was
> **disproven by a reproduction test**: `takeBufferedCalls` deletes the buffer on the *first*
> reconnect, and a member must be connected before they can join, so the buffer is always
> empty before a join could occur. Clearing it on join is a no-op. The real cause is the
> **server reminder loop** (`startGroupMemberRing`): it re-sends the invite every
> `groupRingInterval` for `groupRingCount` rounds and is cancelled ONLY by joining, the room
> emptying, or a caller-side remove. A group invitee who **declines/dismisses** never told
> the server to stop — and `rejectCall()` was silent for group calls (`useCall.ts`: it only
> sent `call-reject` when `!isGroup`). So a dismissed group ring kept coming back every
> reminder round: the "called back in automatically" report.

- **Server** (`hub.go`): the `call-leave` handler now calls `stopGroupMemberRing(roomID,
  c.userID)` (it previously only handled roster/`stopRoomRings`). This stops reminders both
  when a joined member leaves AND when an invitee declines (they send the same `call-leave`).
- **Client** (`useCall.ts` + `signalling.ts`): `rejectCall()` now sends `call-leave {roomId}`
  for a group invite (via new `sendGroupLeave`), and the unanswered-invite timeout does the
  same. A *joined* call already sends `call-leave` through the mesh teardown, so the server
  fix also covers a normal leave.
- **Recall safety (FR-004)**: no client suppression guard is added. After declining/leaving,
  `teardown` clears `callMeta`, and `handleGroupInvite` only ignores an invite for a room we
  are *currently* in — so a deliberate caller recall (a fresh `call-group-invite`) still rings.
- **Testability**: `groupRingInterval`/`groupRingCount` changed from `const` to `var` so a
  test can shrink the cadence (`SetGroupRingCadenceForTest`) and assert, in <1s, that a
  declining invitee stops being re-rung (regression) while a silent one keeps being reminded
  (positive control). Production defaults (7s / 4) are unchanged.
- **Alternatives rejected**: clearing `callBuf` on join/leave (fixes nothing — buffer already
  empty by then); a client-side recently-left room-suppression guard (would also drop a
  legitimate recall — FR-004); shortening `callBufferTTL` (unrelated; weakens background
  ringing).

## 2. Busy for all incoming, incl. group (US2)

**Decision**: Add a group-scoped busy reply and a caller-side resolution of the invitee
tile; reuse the existing `call-busy` frame, extended to optionally carry `roomId`.

- A device that receives an incoming 1:1 offer or `call-group-invite` while
  `callState !== 'idle'` replies busy. For 1:1 this already happens (`useCall.ts:1087`).
  For a group invite, send `call-busy` with `{ to: from, roomId }` (no `callId`).
- **Server** relays the group `call-busy` and, when it carries `roomId` + `to`, stops that
  member's group-ring reminders (mirrors the existing `call-cancel`+roomId branch at
  `hub.go:1219`).
- **Caller side**: `handleCallFrame` `call-busy` with a `roomId` matching the active group
  call → mark that member "busy/unavailable" (`markNotJoining(from, true)` plus a busy
  reason on the tile) and stop ringing them, leaving other invitees untouched (FR-007).
- **Multi-device**: each busy device replies busy; an idle device rings instead. The caller
  treats "busy" as non-overriding — a later join/ack for the same member supersedes the
  busy tile, so a user busy on one device but free on another still connects. Busy is only
  the terminal tile when no device joins.
- **Rationale**: minimal new wire surface (one optional field on an existing frame); the
  server already has the roomId-scoped ring-cancel machinery to hang this on.
- **Alternatives rejected**: a brand-new `call-busy-group` frame (unnecessary; `call-busy`
  already exists and is relayed); server-side busy detection (server doesn't and must not
  know a user's call state beyond room membership — and 1:1 calls aren't in the registry).

## 3. Participant caps (US3)

**Decision**: `VIDEO_MAX = 4`, `AUDIO_MAX = 8`. Enforce client-side (pre-emptive UX) and
server-side (authoritative, at room admission). Block audio→video upgrade client-side when
the live roster > 4.

- **Server** (`call.Registry`): add `JoinIfRoom(roomID, userID, max) (roster []string, ok bool)`
  that admits only if `len(room) < max` (or the user is already present — re-join/recovery
  is idempotent and never refused). The `call-join` handler derives `max` from the frame's
  `kind` (`video → 4`, else `8`) and, on refusal, sends a new `call-full` frame to the
  joiner and does **not** broadcast a roster change.
- **Client**: the participant picker / ad-hoc start caps selection by the chosen kind; an
  incoming join that the server refuses (`call-full`) tears the local attempt down with a
  "call is full" message + the call-full cue. The audio→video upgrade path
  (`useCall.ts` add-video / `mesh.addVideoTrack`) is gated on `roster.length <= 4`.
- **Kind/cap consistency**: a room's server-side cap follows the `kind` on `call-join`.
  Because the upgrade is blocked whenever roster > 4, an audio room (cap 8) can never become
  a video call above the video cap, so the audio cap and the upgrade rule never contradict.
  The server never needs to learn about a mid-call upgrade (it sees no media kind — ZK).
- **Rationale**: client checks give good UX; the server check is the authoritative backstop
  required by the clarification (robust to stale/buggy clients and join races).
- **Alternatives rejected**: client-only (a race or old client can exceed the cap);
  server-only (worse UX, no pre-emptive "full").

## 4. Adaptive per-receiver outgoing quality (US4)

**Decision**: A per-connection bitrate controller that samples `getStats()` on a timer and
adjusts the video sender's `RTCRtpSender` encoding params (the same `maxBitrate` /
`scaleResolutionDownBy` / `maxFramerate` knobs `mesh.applyVideoQuality` already uses),
starting LOW and using an AIMD-style climb/back-off. One controller **per mesh leg** (and
one for the 1:1 PC), so quality is independent per receiver. Audio is never down-tiered.

- **Signals (best-effort, feature-detected per browser)**:
  - `outbound-rtp.qualityLimitationReason` — `"bandwidth"` ⇒ back off (Chromium; absent on
    Safari → ignored).
  - candidate-pair `availableOutgoingBitrate` — headroom to climb / pressure to drop
    (Chromium; often absent on Safari).
  - `remote-inbound-rtp.fractionLost` + `roundTripTime` — the **receiver's** view of our
    stream: the cross-browser signal (present on Safari too) that captures *the remote
    party's bad downlink* (FR-020).
  - `outbound-rtp.framesEncoded` / `framesSent` stagnation as a coarse fallback.
- **Tier ladder** (video): `off → low → medium → high → hd`. Start at `low`. Climb one step
  after K consecutive healthy samples (low loss, no bandwidth limitation, available bitrate
  comfortably above the next tier's target). Drop immediately (skip steps if severe) on
  `bandwidth` limitation, sustained `fractionLost` above threshold, or `availableOutgoingBitrate`
  below the current target. At `off`, video is suspended (track disabled / not sent) while
  audio continues. `hd` is reached only when headroom clearly supports it — never the start
  or default; the default practical ceiling is `high`/`hd`-gated-by-bandwidth.
- **Pin/data-saver clamp**: the manual `videoQuality` pin and `storage.lessDataCalls` cap the
  controller's max tier; the controller may still go *below* the pin to keep the call alive.
- **Cadence**: sample every ~2 s (reuses the existing diag timer cadence); climb is
  conservative (additive, every few samples), back-off is fast (multiplicative).
- **Testability**: factor the decision as a **pure function** `nextTier(current, snapshot, clamp)`
  unit-tested with synthetic stat snapshots (no WebRTC needed); the sampling/apply wrapper is
  thin and covered by e2e under Playwright network throttling.
- **Rationale**: setParameters on the sender is the only cross-browser, SFU-free knob, works
  per-leg in the mesh, and needs no signalling (no ZK impact). AIMD is the well-understood
  congestion-response shape.
- **Alternatives rejected**: simulcast / SVC (needs an SFU; the mesh has none and reintroducing
  one revives the Safari/VP8 decode problem); relying solely on the browser's built-in
  bandwidth estimator (it under-reacts on the mesh's relay-only TURN path and gives no
  per-receiver control); reducing Opus bitrate (violates the "protect audio" clarification).

**Safari caveat (resolved, not blocking)**: where `qualityLimitationReason` /
`availableOutgoingBitrate` are missing, the controller runs on `remote-inbound-rtp`
loss/RTT alone — still enough to climb cautiously and back off. Documented in the controller.

## 5. Audio cues (US5)

**Decision**: Extend `src/services/sound.ts` with new synthesized one-shot recipes and add a
small per-cue rate-limiter; trigger from the `useCall` state machine and toggle paths.

- New `ToneName`s: `connecting`, `connected`, `reconnecting`, `callended`, `mute`, `unmute`,
  `cameraon`, `cameraoff`, `callfull`, `incallmsg`. Each is a short oscillator recipe in the
  existing style (no audio files — keeps it royalty-free and weightless).
- Triggers: `setState()` transitions (connecting/connected/reconnecting/ended), the
  mute/camera toggle actions, the cap-refusal path (callfull), and the message-receive path
  when `callState !== 'idle'` (incallmsg, distinct from the normal notification tone).
- **Rate-limit**: a `cue(name)` helper that suppresses a repeat of the same cue within a short
  window (≈400 ms) so rapid mute/unmute or reconnect flapping can't storm.
- **Settings**: cues obey the existing notification/tone settings; reuse the current "in-call
  sounds" / tone preference rather than adding a new schema node unless one is needed.
- **Rationale**: reuses the proven Web Audio tone system; no new assets, no new permissions.
- **Alternatives rejected**: shipping audio files (licensing + weight + theme-neutrality);
  a separate cue subsystem (the existing `playTone`/`startLoopTone` already fits).

## 6. SFU teardown & docs (US6)

**Decision**: Delete the dead SFU stack and the migration diagnostics; rewrite
`server/docs/CALLING.md`. Keep a slimmed on-screen stats panel as an intentional feature
(maintainer-confirmable), but remove the verbose `call-diag` logging.

- **Server**: remove `server/internal/sfu/`, the SFU construction/wiring in
  `cmd/ringd/main.go`, and the hub's `sfu-answer`/`sfu-ice`/`sfu-renegotiate` handlers plus
  `SetSFU`/`SendCallSignal`/`CallSFU` interface and the `call-key`/`call-streamid`/
  `call-key-request` relay cases (mesh never sends them). Remove the `sfu`/keyframe ticker.
- **Client**: remove `services/call/sfu.ts` (`GroupSession`), `e2ee.ts`, `e2ee-worker.ts`,
  `e2ee-format.ts`, and the now-dead `sfu-*` / `call-key*` / `call-streamid` cases in
  `useCall.ts` and the frame types in `transport.ts`. Strip the `DIAG(call-video)` blocks
  from `mesh.ts` and the SFU decrypt-tally code from `diag.ts`.
- **Docs**: `CALLING.md` rewritten to describe the mesh: native DTLS-SRTP per leg, all
  browsers incl. iOS/Safari, no insertable-streams/VP8/Chromium-only group requirement, no
  SFU. The TURN-over-TLS-on-443 deployment recipe is unchanged and stays.
- **Rationale**: less code, no misleading boot log/docs, and removing the SFU strengthens the
  ZK posture (no media-touching server component at all).
- **Alternatives rejected**: leaving the SFU dormant (confusing, maintenance burden, false
  docs); deleting the ⓘ panel outright (it's genuinely useful on bad networks — keep it as a
  real, non-temporary feature reading mesh stats).

## 7. Call history both-sided (US2 / FR-031)

**Decision**: Record a call-history entry on both caller and callee for refused/declined/
busy/unanswered incoming calls, reusing the existing `'calls'` IndexedDB store.

- The `'calls'` object store already exists (`idb.ts`); call records are schemaless within it,
  so new outcome values (`busy`, `unavailable`, `missed`, `declined`) need **no `DB_VERSION`
  bump** and no migration (Principle V satisfied without a schema change).
- Caller logs "unavailable/declined"; callee logs "missed" on the device that saw the ring.
- **Rationale**: minimal, reuses existing storage; no offline-migration risk.
- **Alternatives rejected**: a new store (unneeded; would force a version bump).

## 8. Valid relay credentials for late joiners (FR-034)

**Decision**: Stop reusing the once-cached `this.turn` in `mesh.ts`; re-fetch via
`getTurnConfig()` when building a leg (and on ICE restart) so a leg created late in a long
call uses non-expired credentials.

- **Problem**: `MeshSession` fetches TURN creds once in `start()` and caches them in
  `this.turn`; `buildLeg` reuses that value forever (`this.turn ?? (this.turn = await
  getTurnConfig())`). TURN creds are time-windowed (HMAC REST). A leg built after the TTL
  uses dead creds → relay-only ICE never gathers → that peer never connects (the original
  investigation's Finding B). `recover()`/`restartIce()` also don't refresh.
- **Fix**: call `getTurnConfig()` in `buildLeg`/`recover` (it already refreshes ~30s before
  expiry and caches at the module level), rather than holding a per-session snapshot. The
  1:1 path already refreshes per call setup; this brings the mesh in line.
- **Rationale**: minimal, reuses the existing refresh-aware `getTurnConfig`; no new state.
- **Alternatives rejected**: a per-session refresh timer (more moving parts than just asking
  `getTurnConfig` at leg-build time, which is the only moment creds are needed).

## Cross-cutting: Zero-Knowledge

Nothing here adds plaintext on the wire. Server-side cap enforcement uses only the call
`kind` already present on `call-join` and the room roster the server already tracks; the
group busy / call-full frames carry only `roomId` + `from`/`to` (already-visible metadata).
Adaptation and cues are entirely client-local (no signalling). Removing the SFU removes the
only server component that ever touched media routing. **No new metadata is exposed.**
