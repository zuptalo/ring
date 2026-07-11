# Feature Specification: Video calls look sharp again and recover from quality dips

**Feature Branch**: `feat/1039-simultaneous-mutual-calls` <!-- shared branch by owner request: one branch build, one develop build -->

**Created**: 2026-07-11

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Video quality in Ring has dropped significantly compared to the initial versions. It used to be crisp and sharp; now it is laggy and low quality. Tested against FaceTime on the same devices and connections — FaceTime is now the clear winner; it used to be the opposite or a tie."

## Background (regression)

Until late June, `auto` video quality meant no cap at all: the browser's own bandwidth
estimator ramped a good connection to whatever it could carry — the "crisp" era. The
adaptive quality work (specs 0004/0007) introduced a tier ladder with hard caps and
congestion back-offs whose signals are partly self-inflicted: the ladder's own bitrate
caps and encoder reconfigurations produce the very "quality limited" readings the
controller treats as congestion, so quality starts low, climbs slowly, gets knocked
back down, and in the worst case parks video at a floor tier it can never leave. This
hotfix keeps the (valuable) adaptivity but makes its signals truthful, its ceiling
worthy of a good link, and its floor recoverable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A good connection looks great, quickly (Priority: P1)

Two people on solid connections start a video call. The picture looks sharp within a
few seconds of connecting and stays at the best quality the link and devices support —
comparable to native calling apps on the same hardware, not visibly a step below.

**Why this priority**: this is the reported regression — the everyday, good-network
call is the one people compare against FaceTime.

**Independent Test**: a 1:1 video call on an unconstrained link reaches the top quality
tier within seconds of connecting (observable in the ⓘ panel / diagnostics) and the
captured/encoded resolution is HD-class on platforms that support requesting it.

**Acceptance Scenarios**:

1. **Given** a 1:1 video call on an unconstrained connection, **When** it connects,
   **Then** outgoing video reaches the top tier within ~6 seconds and stays there.
2. **Given** capable hardware on a platform where a capture size may safely be
   requested, **When** a video call starts, **Then** the camera captures at HD-class
   resolution (not the browser's 640×480 default).

---

### User Story 2 - Quality holds steady instead of pumping (Priority: P1)

During a call on a stable connection, the picture quality must not visibly cycle
(sharp → blocky → sharp) when nothing about the network changed. In particular, the
app must never interpret the consequences of its own bitrate cap or its own quality
switches as network congestion.

**Why this priority**: the oscillation is the "laggy" half of the report — every
down-switch forces an encoder reset and a keyframe, which shows as stutter.

**Independent Test**: controller unit tests — a "bandwidth limited" reading with zero
packet loss and a healthy send estimate must NOT count as congestion; steady healthy
samples must never step the tier down.

**Acceptance Scenarios**:

1. **Given** a call sending at a tier's bitrate cap with no packet loss and a healthy
   send estimate, **When** the encoder reports it is bandwidth-limited (a direct
   consequence of the cap), **Then** the controller holds or climbs — it does not back
   off.
2. **Given** genuine congestion (receiver-reported loss, or the send estimate
   collapsing), **Then** the controller still backs off as today — adaptivity is kept.

---

### User Story 3 - Video that dipped to protect audio comes back (Priority: P2)

On a really bad stretch the app may reduce video all the way down so audio survives.
When conditions recover, video must come back on its own within seconds — never stay
frozen/black for the rest of the call.

**Why this priority**: today the floor tier is a trap: video is strangled to an
effectively-zero bitrate (not actually paused), which itself keeps the "congested"
signal on forever — a call that dips once never shows video again.

**Independent Test**: controller/regression test — from the floor tier, healthy
samples must climb back; and the floor must genuinely pause the outgoing video (no
zero-bitrate zombie encode) so samples CAN read healthy.

**Acceptance Scenarios**:

1. **Given** a call whose outgoing video was floored during severe congestion,
   **When** the network recovers, **Then** the peer sees video again within ~10
   seconds, without anyone touching settings.
2. **Given** the floor is active, **Then** audio continues unaffected, and the video
   pause is what actually happens technically (nothing is encoded), not a 1-bps
   zombie stream.

---

### User Story 4 - A receiver's momentary hiccup doesn't cap the sender (Priority: P3)

A brief blip on the receiving side (a couple of lost packets in a one-second window,
frames dropped while the phone animates its UI) must not push the sender's quality
down for many seconds. Only meaningful, sustained receive-side trouble should lower
what the other side sends.

**Why this priority**: the receiver-reported ceiling is a second, independent path
that today caps quality on statistical noise; fixing only the sender side would leave
calls still capped below their potential.

**Independent Test**: unit tests on the downlink classifier — tiny per-window sample
sizes keep the previous class; the dropped-frame trim requires a high sustained ratio.

**Acceptance Scenarios**:

1. **Given** a receive window with too little traffic to be statistically meaningful,
   **Then** the reported downlink class does not change.
2. **Given** an isolated small loss blip in one short window on an otherwise clean
   link, **Then** the sender is not asked to drop below the top tier.

---

### Edge Cases

- Old-device iOS (iPhone-8 class): capture stays unconstrained (requesting any
  width/height triggers the WebKit orientation-flip that permanently mutes the camera)
  and tiering stays bitrate-only. The capture-resolution improvement applies only where
  it is safe; these devices keep today's behavior.
- Group (mesh) calls: the per-peer-count ceilings and the CPU protection stay — many
  parallel encoders on a phone are a real constraint. Genuine CPU limitation still
  backs off (sustained, as today); only the self-inflicted bandwidth-cap reading is
  re-classified.
- Manual quality pin and "use less data" stay exact upper bounds, unchanged.
- Call hold/resume (call waiting) and the user's own camera-off toggle must not fight
  the floor's pause/resume: adaptation only re-attaches video it paused itself.
- The recovered-from-floor climb still respects the ladder (one step at a time) so a
  flapping network doesn't strobe the video on/off.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A 1:1 video call on an unconstrained connection MUST reach the top
  quality tier within ~6 seconds of connecting (start higher, climb on the design
  cadence), instead of starting at half resolution and needing sustained luck to climb.
- **FR-002**: The top tier's bitrate ceiling MUST be raised to at least 4 Mbps so a
  good link is visibly sharp (group calls keep their existing per-peer-count ceilings).
- **FR-003**: Where a capture size can safely be requested (not the affected WebKit
  devices), video calls MUST request HD-class capture (≈1280×720 ideal) instead of
  accepting the 640×480 browser default — including when flipping cameras mid-call.
- **FR-004**: An encoder "bandwidth limited" reading MUST count as congestion only when
  corroborated by an independent signal (receiver-reported loss, or the send estimate
  collapsing below the current tier's need). CPU limitation keeps today's sustained
  back-off. Genuine-congestion behavior (loss spikes, estimate collapse) is unchanged.
- **FR-005**: The floor tier MUST genuinely pause outgoing video (nothing encoded, so
  stats can read healthy) and MUST automatically resume and climb when samples recover
  — in 1:1 calls and per mesh leg. A call must never end with video permanently frozen
  by the adaptive floor.
- **FR-006**: The receiver's downlink self-assessment MUST ignore windows with too
  little traffic to be meaningful and MUST require a substantially higher, non-noise
  dropped-frame ratio before trimming the requested ceiling.
- **FR-007**: 1:1 adaptation MUST sample on the cadence the controller was designed
  for (~2 s between decisions), independent of the 1 s UI stats poll.
- **FR-008**: All existing quality behaviors not named here are preserved: manual pin,
  data-saver, per-peer mesh ceilings, tile-size ceilings, severe-loss immediate
  back-off, and the sealed `qos` report shape on the wire.
- **FR-009**: As a regression fix, failing tests reproducing the floor trap and the
  self-inflicted back-off MUST exist before the fix (constitution III).

### Key Entities

- **Quality tier ladder**: off / low / medium / high / hd — unchanged shape; changed
  numbers (top-tier bitrate), changed floor semantics (real pause), changed entry point
  (1:1 starts high).
- **Congestion signal**: the per-sample verdict the controller acts on; re-defined so
  self-inflicted encoder readings alone are not congestion.
- **Downlink class / requested ceiling**: the receiver's sealed per-~2s report;
  unchanged wire shape, recalibrated thresholds.

## Zero-Knowledge Impact

- **What crosses the wire**: nothing new. The sealed `qos` report keeps its exact
  shape (coarse tier enums + seq); offers/answers/media are untouched. Capture
  resolution and tier decisions are device-local.
- **What is encrypted**: everything content-bearing, exactly as today (media via
  DTLS-SRTP, signalling sealed over the pair's ratchet).
- **Unavoidably visible metadata**: unchanged — the server relays the same sealed
  envelopes; a higher media bitrate through the blind TURN relay is the only
  externally observable difference, identical in kind to today.
- **Why**: this is a client-local policy/tuning fix inside the existing machinery.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On an unconstrained local link, a 1:1 video call reaches the top tier
  within 6 seconds of connecting (observable via diagnostics) in 100% of e2e runs.
- **SC-002**: Over a 60-second steady call on a clean link, the outgoing tier never
  steps down (no pumping) in e2e/probe runs.
- **SC-003**: From a forced floor, video resumes within 10 seconds of samples reading
  healthy (regression test + probe).
- **SC-004**: On platforms where HD capture is requested, the captured track reports
  ≥1280×720 (probe assertion).
- **SC-005**: Connect-speed and existing adaptive e2e suites stay green (no first-media
  or reliability regression).

## Assumptions

- FaceTime-parity in absolute numbers is not the bar (different codecs/OS access); the
  bar is "a good link looks sharp and stable, quickly" and "quality dips recover".
- Raising the top tier to ~4 Mbps is enough for HD-class WebRTC video at 30 fps; going
  fully uncapped is deliberately avoided so the data-saver/pin semantics and the mesh's
  per-peer budgeting keep meaning.
- iOS capture stays unconstrained: on the affected WebKit builds any size request can
  permanently mute the camera (documented iPhone-8 behavior), and unconstrained WebKit
  opens the sensor in its native format anyway (i.e., iOS is not stuck at VGA today).
- The exact recalibrated thresholds (minimum packets per window, dropped-frame ratio,
  corroboration loss level) are design-time decisions recorded in the plan; the spec
  fixes their intent (noise must not change class; corroboration must be independent).
