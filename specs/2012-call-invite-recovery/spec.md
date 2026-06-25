# Feature Specification: Call invite recovery & honest ringing

**Feature Branch**: `fix/2012-call-invite-recovery`

**Created**: 2026-06-25

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: A 1:1 call breaks if the callee's app reloads mid-ring (e.g. they open the call from a
notification, see the pending app-update prompt, and tap "Update"): the callee loses the incoming-call
screen and can't answer, while the caller stays stuck on "ringing" for a full minute even though
nobody is ringing. Make this robust: the callee should get the incoming call back after a reload and
still be able to answer; and the caller's "ringing" should be honest — if the callee goes away, end
the call promptly instead of ringing into the void. Also: a held call's resume countdown ("You'll be
on camera…") only makes sense for video — audio calls should skip it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The incoming call survives an app reload (Priority: P1)

The callee is being rung, opens the app/notification, and the app reloads for any reason (a pending
update they accept, a crash, a manual refresh). After the reload the incoming-call screen comes back
and they can still answer the call (as long as the caller is still ringing).

**Why this priority**: Today a reload mid-ring drops the incoming call entirely — the callee simply
can't answer, which looks like the app or the call is broken at the worst moment.

**Independent Test**: Caller A rings callee B (B online). Reload B's app while ringing → B's
incoming-call screen reappears and B can accept → the call connects normally.

**Acceptance Scenarios**:

1. **Given** B is being rung and the call is still active, **When** B's app reloads, **Then** B's
   incoming-call screen reappears and B can accept and connect.
2. **Given** B's app reloads after the call already ended/was cancelled/declined, **When** B
   reconnects, **Then** B does NOT see a stale incoming call (no ghost ring).
3. **Given** B was already showing the incoming call and the invite is re-delivered, **When** both
   arrive, **Then** B rings only once (no duplicate incoming screen).

---

### User Story 2 - "Ringing" is honest; a vanished callee ends the call (Priority: P1)

When the caller is showing "ringing", that reflects a callee who is actually reachable. If the callee
goes away (their app reloads/closes/loses connection and isn't ringing anymore), the caller's call
ends promptly with a clear outcome, instead of ringing into the void for ~a minute.

**Why this priority**: A minute of false "ringing" with no possibility of an answer is confusing and
wastes the caller's time; it also masks the real state (the callee isn't there).

**Independent Test**: A rings B; while ringing, B's connection drops (reload/close) and B does not
re-ring within a short grace → A's call ends promptly (well under the old ~60s), with a clear
"unavailable/ended" outcome.

**Acceptance Scenarios**:

1. **Given** A is ringing B, **When** B's connection drops and B does not resume ringing within a
   short grace window, **Then** A's call ends promptly with a clear outcome (not a full ~60s timeout).
2. **Given** A is ringing B, **When** B reloads and the incoming call is recovered (US1) and B
   continues ringing, **Then** A keeps ringing normally (the recovery and honesty work together — a
   quick reload does not falsely end the call).
3. **Given** B answers, declines, or the caller cancels, **When** that happens, **Then** the existing
   outcomes are unchanged (answer connects; decline/cancel/end tear down as today).

---

### User Story 3 - No "on camera" countdown for audio calls (Priority: P3)

When a held call resumes, the person coming back on gets a brief "You'll be on camera…" countdown
before their camera/mic go live. On an audio call there is no camera, so this countdown is
nonsensical — audio calls resume immediately without it; video calls keep it.

**Why this priority**: Minor polish, but the "on camera" wording on an audio call is confusing/wrong.

**Independent Test**: Put a 1:1 audio call on hold and resume → no "on camera" countdown, resumes
immediately. Put a video call on hold and resume → the countdown still shows.

**Acceptance Scenarios**:

1. **Given** a held audio call, **When** it resumes, **Then** there is no resume countdown and the
   call resumes immediately.
2. **Given** a held video call, **When** it resumes, **Then** the existing resume countdown still
   shows before the camera goes live.

---

### Edge Cases

- Reload after the call already connected (not ringing): the reload is outside this scope (an active
  media session lost on reload is a separate concern); US1 covers the ringing window.
- The recovered invite expiring: if the callee reloads after the invite's short server-side validity
  has lapsed (caller already gave up), the callee does NOT ring — it's stale.
- Caller's own reload while ringing: out of scope here (this spec covers the callee-reload and
  caller-honesty cases the user reported); existing behavior unchanged.
- A flapping callee (drops and re-rings repeatedly): the caller should not end on a single brief drop
  if the callee re-rings within the grace window (US2 scenario 2).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: If a 1:1 callee's app reloads/reconnects while a call is still active (ringing), the
  incoming-call invite MUST be re-delivered so the callee sees the incoming-call screen again and can
  answer.
- **FR-002**: A re-delivered invite MUST NOT produce a duplicate incoming-call screen if the callee is
  already showing it.
- **FR-003**: A callee MUST NOT be rung for a call that has already ended, been answered elsewhere,
  declined, or cancelled (the recoverable invite is cleared when the call resolves).
- **FR-004**: The recoverable invite MUST expire (a short server-side validity window) so a callee
  reconnecting long after the caller gave up is not falsely rung.
- **FR-005**: When the caller is ringing and the callee becomes unreachable (connection dropped and
  not re-ringing within a short grace), the caller's call MUST end promptly with a clear outcome,
  rather than continuing to "ring" until the long no-answer timeout.
- **FR-006**: A brief callee reload that recovers the invite and resumes ringing within the grace MUST
  NOT cause the caller to falsely end the call.
- **FR-007**: Existing call outcomes (answer → connect; decline/cancel/busy/end → teardown) and the
  existing no-answer timeout MUST be preserved.
- **FR-008**: A held **audio** call MUST resume immediately with no "on camera" resume countdown; a
  held **video** call MUST keep the existing resume countdown.
- **FR-009**: The zero-knowledge boundary MUST be preserved: the recoverable invite is the existing
  sealed call-offer ciphertext relayed as today; the server never reads call content, and no message
  plaintext is persisted in the clear.

### Key Entities *(include if feature involves data)*

- **Recoverable call invite**: the existing sealed `call-offer` (and its early ICE), retained by the
  relay for a short validity window so it can be re-delivered to a callee that reconnects while the
  call is still active; cleared when the call resolves.
- **Ringing reachability**: the caller-visible "ringing" state, now tied to the callee remaining
  connected/ringing rather than a single one-shot ring signal.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Reloading the callee's app mid-ring reliably restores the incoming-call screen and the
  callee can answer and connect.
- **SC-002**: A reloaded/declined/ended call does not produce a ghost incoming ring on reconnect, and
  a re-delivered invite never double-rings.
- **SC-003**: When the callee becomes unreachable mid-ring, the caller's call ends within a few
  seconds (well under the prior ~60s), with a clear outcome.
- **SC-004**: A quick callee reload that recovers and re-rings within the grace does not falsely end
  the caller's call.
- **SC-005**: A held audio call resumes with no countdown; a held video call still shows it.
- **SC-006**: No regression to the existing call connect / call-waiting / answer-decline-cancel suites.

## Assumptions

- The fix is primarily server-side relay behavior (retain + re-deliver the sealed call-offer for a
  short window; notify the caller when the callee's socket drops) plus small client guards; the offer
  is already sealed ciphertext, so retaining it briefly does not expose plaintext.
- "Promptly" for the caller-honesty drop is a few seconds' grace (enough to cover a fast reload that
  re-rings), not instantaneous, so a brief reconnect doesn't kill a still-valid call.
- The resume countdown's purpose is to warn before the camera goes live, so it is gated on the call
  being a video call.
