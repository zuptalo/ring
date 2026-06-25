# Feature Specification: Adaptive call quality — per-receiver, network- and screen-aware, with peer-reported health

**Feature Branch**: `feat/0007-adaptive-call-quality`

**Created**: 2026-06-24

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User request: "Investigate, understand, and improve the logic around video/audio quality management based on the number of participants, the size of the screen, and each device's bandwidth — so we don't send more or less quality than we should when joining calls. Consider baking a signaling channel where each party reports its connection speed/bandwidth to the others every few seconds so senders can adjust per-receiver quality. Video call quality seems to have dropped significantly since we automated the quality adjustments — maybe a miscalculation or a bug. Verify with up to 4 Playwright instances whose network is throttled on the fly that adjustments are timely, calls stay smooth, and quality is as good as possible for each screen size and connection. Manual low/medium must still be possible, and a device's manual choice must also lower the INCOMING streams others send to it; a sender always shows its own original quality in its own self-preview regardless of what it sends out. Improve the data behind the ⓘ info button so we can see how each client is performing these decisions."

## Overview

Group calls run as a full peer-to-peer mesh (one connection per pair). Spec 0004 added an automated
per-leg outgoing-quality controller (AIMD: start LOW, climb on sustained health, back off on
congestion), with a manual quality pin and a participant-count ceiling. Since that automation (and
the later "reliable video on older iPhones" change), **perceived video quality has dropped** — the
suspicion is a miscalculation or bug, not just tuning.

This feature is two things at once:

1. **Investigate and fix the suspected regression** in the current automated quality logic — find
   why calls look worse than before automation and correct it.
2. **Improve the model** so each receiver gets the best quality its **screen/tile size**,
   **device** and **network** can sustain — neither starved nor wastefully over-sent — including a
   small, sealed **peer-reported connection-health signal** so a sender can tailor what it sends to
   each receiver based on that receiver's real downlink, not just the sender's own send-side guess.

It must keep working on iOS/Safari and must not regress the zero-knowledge boundary: any new
signaling is sealed per-pair and adds no server-visible metadata.

### Current behavior (starting point for the investigation)

- Every leg **starts at LOW** and climbs one tier only after several consecutive healthy samples,
  one step at a time — so reaching a good tier takes many seconds.
- Without a bandwidth estimate (often the case on Safari/WebKit), the climb is **capped at "high"**
  (never HD).
- On iOS the encoder is tiered by **bitrate only** (resolution scaling dropped for older-device
  stability), so a low tier can send **full-resolution video at a very low bitrate** — i.e. blocky
  — rather than a clean downscaled image. *(Leading regression suspect.)*
- Adaptation uses the **sender's** own getStats (and receiver-reported packet loss); there is **no
  explicit per-receiver downlink/bandwidth report** from the other side.
- Quality is **not** influenced by the rendered tile/screen size.
- The manual pin (auto/medium/low) clamps **outgoing** only; it does **not** reduce what others
  send **to** the picker.

These are the behaviors the investigation must confirm/correct; the desired behavior is below.

## Clarifications

### Session 2026-06-24

- Q: Cadence of the peer connection-health report? → A: **~2s periodic, plus an immediate report on
  a significant change** (sharp downlink change or a manual-pin change).
- Q: Is a receiver's manual low/medium a hard cap or a hint? → A: **Hard cap** — senders MUST NOT
  exceed the receiver's requested tier for the stream sent to it.
- Q: What should AUTO reach by default on a capable device + healthy network? → A: **HD on 1:1 /
  2-person; "high" for 3–4-person groups** (per-leg, and never above what the rendered tile size
  warrants).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Quality is as good as the conditions allow (regression fixed) (Priority: P1)

On a healthy network, a video call looks clearly good — not stuck at a low/blocky tier — and it
reaches that good quality quickly after joining, for both 1:1 and group calls.

**Why this priority**: This is the reported problem. Whatever miscalculation/bug dropped quality
must be found and fixed; without it the rest is moot.

**Independent Test**: Join 1:1 and group video calls on an unthrottled (good) connection; measure
the time to reach a clearly-good tier and the steady-state encoded resolution/bitrate; confirm it
is materially better than today and reaches a good tier within a few seconds.

**Acceptance Scenarios**:

1. **Given** a healthy network, **When** two people are on a 1:1 video call, **Then** each sees the
   other at a high/HD-class quality within a few seconds of connecting (not stuck at a low tier).
2. **Given** a healthy network, **When** 3–4 people are on a group video call, **Then** each leg
   reaches the best quality the per-leg conditions allow (within the participant-count ceiling),
   with no leg stuck low without cause.
3. **Given** iOS/Safari devices, **When** they send video, **Then** the image is clean for its tier
   (a low tier is a clean smaller image, not full-resolution blockiness) — the iOS encoder path
   does not produce a worse image than other platforms at the same tier.

---

### User Story 2 - Senders adapt to each receiver's real connection (Priority: P1)

Each device periodically tells the others how its connection is doing (downlink capacity / health),
so a sender can pick the right quality **for each receiver** — sending less to a peer on a weak link
and more to a peer on a strong one, in the same call.

**Why this priority**: Per-receiver adaptation driven by the receiver's actual downlink is the core
model improvement; send-side estimation alone misjudges the remote side.

**Independent Test**: In a group call, throttle one receiver's downlink; confirm only the streams
**to that receiver** step down (others unaffected), driven by that receiver's reported health, and
recover when the throttle lifts.

**Acceptance Scenarios**:

1. **Given** a multi-party call, **When** one receiver's downlink degrades, **Then** every sender
   lowers only the stream it sends to that receiver, within a few seconds, while streams to
   healthy receivers stay high.
2. **Given** the degraded receiver's downlink recovers, **When** its reported health improves,
   **Then** senders raise the stream to it again, smoothly (no flapping).
3. **Given** the health reports stop arriving (peer silent), **When** a sender has no fresh report,
   **Then** it falls back safely to its own send-side adaptation (no worse than today).

---

### User Story 3 - Manual quality reduces what others send to you (Priority: P2)

A user can still pin their quality to low or medium. That choice not only limits what they send,
but also makes the **incoming** streams from everyone else come in at the lower quality — saving
the picker's data/CPU — while everyone's own self-preview still shows their full local quality.

**Why this priority**: The user explicitly wants manual low/medium to reduce incoming streams, not
just outgoing; it's a clear data/comfort control that depends on US2's feedback channel.

**Independent Test**: Pin device A to "low"; confirm the bitrate/resolution others send **to A**
drops, A's outgoing also respects its pin, and each sender's **own** self-preview is unchanged
(full local quality).

**Acceptance Scenarios**:

1. **Given** A pins quality to low (or medium), **When** the pin is applied, **Then** every other
   participant sends A a stream capped at that tier, and A's outgoing is also capped at that tier.
2. **Given** any participant is sending a reduced stream to A, **When** they look at their own
   self-preview, **Then** it still shows their full local capture quality (the cap affects only
   what is transmitted, never the local preview).
3. **Given** A returns the pin to auto, **When** that is signaled, **Then** incoming streams to A
   climb back toward the automatic, condition-based quality.

---

### User Story 4 - Quality matches the screen/tile it's shown in (Priority: P2)

Quality targets the size the video is actually displayed at: a small tile in a 4-up grid (or a
small screen) doesn't receive full HD it can't show, while a fullscreen 1:1 can.

**Why this priority**: Sending more than the display can render wastes bandwidth/CPU and can
ironically force a needless downgrade elsewhere; matching the rendered size is "right-sized"
quality.

**Independent Test**: Compare the negotiated/target quality for the same peer shown in a small grid
tile vs. fullscreen; confirm the target scales with the rendered size (and updates if the layout
changes, e.g. on fullscreen/pin).

**Acceptance Scenarios**:

1. **Given** a participant is shown in a small grid tile, **When** quality is chosen, **Then** the
   target resolution is appropriate for that tile (not full HD).
2. **Given** the same participant is brought to fullscreen, **When** the layout changes, **Then**
   the target quality increases toward what the larger view warrants (conditions permitting).

---

### User Story 5 - See the decisions in the ⓘ panel (Priority: P3)

The on-call info (ⓘ) panel shows, per receiver/leg, the current tier, the measured/ reported
bandwidth and health, and why the controller chose it — so behavior is observable when diagnosing
quality.

**Why this priority**: Observability supports the investigation and future tuning; valuable but not
itself the fix.

**Independent Test**: Open the ⓘ panel during a throttled call; confirm it shows per-leg tier,
measured send + reported downlink, limitation reason (bandwidth/cpu/loss), and that the values track
the throttling.

**Acceptance Scenarios**:

1. **Given** a call with adaptation active, **When** the ⓘ panel is open, **Then** it shows each
   leg's current tier, the signals behind it (measured bitrate, reported downlink, loss/RTT,
   limitation reason), and the manual pin if set.
2. **Given** the network is throttled, **When** the panel is watched, **Then** the displayed
   signals and tier visibly change as adaptation responds.

### Edge Cases

- **Throttle mid-call**: dropping a device's bandwidth must cause a downgrade within a few seconds
  with no frozen/black video; raising it must climb back without oscillation/flapping.
- **Asymmetric links**: a device with a fine uplink but poor downlink should still receive less
  (driven by its reported downlink), independent of what it sends.
- **Stale/missing reports**: if peer health reports stop, senders fall back to send-side adaptation
  and never hang waiting for a report.
- **iOS/Safari**: the per-tier image must be clean (no full-res-at-low-bitrate blockiness); the fix
  must keep working on older iOS that motivated the bitrate-only encoder path.
- **Manual pin vs. conditions**: a manual cap always wins downward; auto never exceeds the
  participant-count ceiling or what conditions sustain.
- **Layout churn**: rapidly toggling fullscreen/grid must not thrash the encoder (rate-limit
  target changes).
- **CPU-bound device**: a device whose CPU (not bandwidth) is the limit must also back off (a mesh
  runs N encoders); this must not be mistaken for a network problem.
- **Audio protection**: under severe congestion, audio is preserved (video drops first), never the
  reverse.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST identify and fix the cause(s) of the post-automation quality
  regression so that, on a healthy network, call video reaches a clearly-good quality quickly and
  is not left stuck at a low/blocky tier (verified against the measured baseline).
- **FR-002**: On iOS/Safari, the image produced for a given tier MUST be visually consistent with
  other platforms (a low tier = a clean smaller image, not full-resolution at a starved bitrate),
  while preserving the encoder stability the older-iPhone path required.
- **FR-003**: Outgoing video quality MUST adapt **per receiver / per mesh leg**, using BOTH the
  sender's own send-side stats AND the receiver's reported connection health, so different peers in
  one call can receive different qualities matched to their own links.
- **FR-004**: Devices MUST share a small connection-health report (downlink capacity/health and the
  receiver's current quality preference) with their call peers **~every 2 seconds, plus immediately
  on a significant change** (a sharp downlink change or a manual-pin change); senders MUST use the
  freshest report to choose per-receiver quality and MUST fall back to send-side adaptation when no
  fresh report is available.
- **FR-005**: Quality targets MUST account for the rendered tile/screen size (and participant
  count): a small tile targets a lower resolution than a fullscreen view, updating when the layout
  changes (rate-limited to avoid thrash).
- **FR-006**: Adaptation MUST converge quickly to the best sustainable quality and remain stable
  (no oscillation/flapping), backing off promptly on real congestion (bandwidth, sustained loss,
  or CPU limitation) and preserving audio over video under severe congestion. On a capable device
  and healthy network, AUTO MUST reach **HD on a 1:1 / 2-person call and "high" on a 3–4-person
  group** by default (per-leg), never exceeding what the rendered tile size warrants (FR-005).
- **FR-007**: A manual quality pin (auto / medium / low) MUST remain available and MUST act as a
  **hard** upper bound in BOTH directions: it caps what the user sends AND every other participant
  MUST NOT exceed the chosen tier for the stream they send TO that user (a receiver-requested cap
  carried by the health/preference report — senders honor it, they do not merely treat it as a
  hint).
- **FR-008**: A participant's own self-preview MUST always show its full local capture quality,
  regardless of what it is transmitting to any peer.
- **FR-009**: The ⓘ on-call info panel MUST expose, per leg/receiver, the current tier and the
  signals behind it (measured send bitrate, reported downlink, loss/RTT, limitation reason, manual
  pin) so the decisions are observable. These diagnostics (and any connect/quality instrumentation)
  MUST be client-local — derived from locally-available stats and the already-received reports — and
  MUST NEVER be transmitted off-device.
- **FR-010**: Behavior MUST be verifiable in automated tests that run up to 4 participants and
  throttle individual devices' network on the fly, asserting timely, correct, per-receiver
  adjustments and smoothness.

### Zero-Knowledge Impact

- **FR-011**: The peer connection-health/preference report MUST be sealed per-pair over the existing
  call signalling (Double Ratchet for contacts, the call-scoped key agreement for non-contact
  co-members) and relayed by the server as opaque ciphertext — no new server message type, no new
  server-visible metadata, no new stored state. It MUST carry only coarse, call-relevant signals
  (e.g. an approximate downlink class / health and a quality-preference tier) — never precise
  network identifiers, IP, or location — minimizing what even a peer learns to what the call needs.
- **FR-012**: The report MUST be authenticated by its seal so a forged or injected report cannot take
  effect — a server or man-in-the-middle MUST NOT be able to push a fake cap to degrade a call — and
  stale/replayed reports MUST be ignored (newest `seq` wins, with the staleness fallback of FR-004).
- **FR-013**: All per-receiver cap and screen-size-target decisions MUST be computed client-side and
  MUST NOT cause the server to learn who can see/hear whom beyond what room membership already
  exposes (no new social-graph or who-sees-whom signal reaches the server).

### Key Entities

- **Quality tier**: a discrete outgoing video level (off → low → medium → high → HD) with a target
  resolution scale, framerate, and bitrate.
- **Per-leg controller**: the adaptive state for one sender→receiver stream (one per mesh leg, plus
  the 1:1 connection), choosing a tier from local stats + the receiver's reported health, bounded
  by the manual pin, participant-count ceiling, and tile-size target.
- **Connection-health report**: the small, sealed, periodic message a device sends its peers —
  coarse downlink/health + the sender's quality preference (its manual pin / requested incoming
  cap).
- **Tile/display target**: the resolution a given remote video is actually rendered at, used to
  right-size its requested quality.
- **Quality diagnostics**: the per-leg signals surfaced in the ⓘ panel (tier, measured send,
  reported downlink, loss/RTT, limitation reason, manual pin).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a healthy (unthrottled) network, a 1:1 video call reaches a high/HD-class tier
  within ~5 seconds of connecting, and a 3–4-person group call reaches the best tier its per-leg
  conditions allow — measurably better than the pre-change baseline, verified in the harness.
- **SC-002**: When one participant's downlink is throttled mid-call (in the 4-instance harness),
  the streams sent **to that participant** step down within ~3–5 seconds while streams to healthy
  participants stay high; when the throttle lifts, they climb back within ~10 seconds — with no
  frozen/black video throughout (calls stay smooth).
- **SC-003**: A device's manual "low"/"medium" pin reduces the bitrate of streams others send **to
  it** to the chosen tier (measured inbound), caps its outgoing to the same tier, and leaves every
  sender's own self-preview at full local quality — 100% of the time.
- **SC-004**: For the same peer, the target quality in a small grid tile is lower than when shown
  fullscreen, and adjusts (rate-limited) when the layout changes.
- **SC-005**: Adaptation does not oscillate: under steady conditions the tier holds (no
  flapping between tiers within a short window).
- **SC-006**: The ⓘ panel shows per-leg tier + measured send + reported downlink + limitation
  reason, and these visibly track throttling changes.
- **SC-007**: The server learns nothing new: no new frame type, metadata, or stored state — the
  health report is sealed and indistinguishable from other sealed call signalling (verified by the
  zero-knowledge review/checklist).
- **SC-008**: No regression to call connect, hold/swap (0005), caps/busy (0004), or the first-call
  connect speed (2008); existing call e2e and unit suites stay green.

## Assumptions

- Builds on spec 0004 (mesh, per-leg controller, caps, manual pin) and the calling stack in
  `src/services/call/` (`quality.ts`, `mesh.ts`) and `useCall.ts`. The work is expected to refactor
  and correct that controller, not replace the mesh.
- The suspected regression is concentrated in the automated controller — leading suspects to
  confirm in `/speckit-plan` research: (a) the iOS bitrate-only encoder path sending full-resolution
  at low bitrate; (b) start-low + slow one-step climb taking too long; (c) the "no bandwidth
  estimate → cap at high" rule on Safari; (d) an over-aggressive participant-count step-down or a
  miscalculation in the climb/back-off thresholds.
- The peer connection-health report rides the existing sealed per-pair signalling (the same way
  hold/resume rode the call-ice frame in 0005), so no new server endpoint or wire type is needed.
- Verification uses the Playwright real-WebRTC harness with up to 4 isolated participants and
  Chromium network throttling (CDP) applied/changed on the fly; iOS-specific image quality is
  confirmed on-device (headless WebKit can't run fake-media WebRTC), per the quickstart.
- This spec touches Principle I (sealed signalling) → the zero-knowledge `/speckit-checklist` is
  required before implementation.
- Audio is already robust; the focus is video quality, with audio explicitly protected under
  congestion.
