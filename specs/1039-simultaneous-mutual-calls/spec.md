# Feature Specification: Simultaneous mutual calls connect instead of ringing each other

**Feature Branch**: `feat/1039-simultaneous-mutual-calls`

**Created**: 2026-07-11

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "If 2 contacts try to either audio or video call each other at the same time, they should get connected — they should not end up in call waiting for each other."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Calling each other at the same moment just connects (Priority: P1)

Two contacts decide to talk and both tap the call button on each other at (nearly) the same time — both audio, or both video. Instead of each phone showing "Calling…" forever (or one phone confusingly starting to ring after its owner just placed a call), the two attempts are recognized as one mutual intent and the call simply connects: both people land in a live call with each other, no extra tap needed.

**Why this priority**: This is the requested behavior and fixes the worst current outcome — today near-simultaneous mutual calls can leave BOTH people stuck on "Calling…" until the no-answer timeout, so the call never happens at all. Both people have already expressed exactly the same intent; making either of them answer (or wait) is pure friction.

**Independent Test**: On two devices signed in as mutual contacts, tap "call" on each other within ~0–2 seconds (same kind). Verify both devices enter one connected call without either user tapping Accept, for both audio and video, across several timing offsets (0ms, ~300ms, ~1s, ~2s apart).

**Acceptance Scenarios**:

1. **Given** two contacts both idle, **When** both place an audio call to each other within the setup window of one another (any overlap of the two unanswered attempts), **Then** both devices end up connected in a single audio call together, without either user accepting manually.
2. **Given** two contacts both idle, **When** both place a video call to each other at the same time, **Then** both devices end up connected in a single video call together, without either user accepting manually.
3. **Given** the mutual attempt above, **When** the call connects, **Then** neither device is left showing "Calling…", an incoming-call screen, a busy screen, or a call-waiting prompt for the other's attempt.
4. **Given** the mutual attempt above, **When** either person hangs up during or right after the resolution, **Then** both devices return cleanly to idle (no ghost call, no stuck screen, and a follow-up call between the two works normally).

---

### User Story 2 - Mismatched kinds never switch on a camera uninvited (Priority: P2)

One person places an audio call while, at the same time, the other places a video call to them. The two attempts still resolve deterministically to a single call — but the person who only asked for an audio call must never find their camera live without having agreed to video. In that mismatched case the surviving call is presented as a normal incoming call (showing its kind), and the recipient decides.

**Why this priority**: Consent to the camera is a hard privacy principle (Constitution Principle IX: capture only ever follows an explicit user action). Auto-connecting is only safe when it grants exactly what each person already asked for.

**Independent Test**: Device A places an audio call while device B simultaneously places a video call to A. Verify a single surviving call is presented, no camera turns on on the audio-caller's device without an explicit accept, and no stuck/timeout state occurs.

**Acceptance Scenarios**:

1. **Given** A places an audio call and B places a video call to A at the same time, **Then** exactly one of the two attempts survives (deterministically), the other side sees it as a normal incoming call ring with its kind clearly shown, and no camera is captured on any device that didn't explicitly start or accept a video call.
2. **Given** the mismatched mutual attempt, **When** the ringing side declines the surviving call, **Then** both sides end in idle with clear outcomes (declined / call ended), not a timeout.

---

### User Story 3 - A different caller during call setup doesn't wreck the call being placed (Priority: P3)

While someone is placing a call to contact A (the brief setup moment before it audibly starts "calling"), an unrelated contact C happens to call them. The incoming call from C must not corrupt or replace the call being placed — C gets the same treatment as any caller reaching a busy person (busy, or the call-waiting prompt when available), and the outgoing call to A proceeds normally.

**Why this priority**: The same blind spot that loses mutual calls (an offer arriving during the setup window) also lets ANY incoming call corrupt an outgoing call being placed. Rarer than the mutual case, but the same defect class and the same fix surface.

**Independent Test**: Start an outgoing call from B to A, and within the same instant have C call B. Verify B's outgoing call to A rings and can connect normally, and C receives the existing busy/call-waiting treatment.

**Acceptance Scenarios**:

1. **Given** B is placing a call to A, **When** C's incoming call arrives during B's setup window, **Then** B's outgoing call to A continues unharmed (it can be answered and connect), and C is handled exactly as if B were already in a call (busy, or call-waiting prompt per the existing rules).

---

### Edge Cases

- The two attempts overlap at every possible timing: both offers cross mid-flight, one arrives before the other side's attempt has even finished setting up (camera permission prompt, slow capture), or one arrives while the other is already audibly "calling". All overlaps resolve the same way — one connected call.
- The yielding side's own (now abandoned) attempt reaches the surviving side late (relay retention / reconnect redelivery): it must be ignored, not raised as a new incoming call, including after the mutual call has already connected or ended.
- One person cancels (hangs up) their attempt in the same instant the resolution happens: both sides must settle to idle or to a normal single-direction ring — never a stuck hybrid.
- The mutual attempt happens while one side's app was just opened via the incoming-call push: resolution still applies (the intent is mutual regardless of how the offer arrived).
- A mutual attempt between people who are ALREADY in other calls follows the existing busy/call-waiting rules; this feature only governs two attempts aimed at each other while neither call is connected yet.
- Per-chat mute: a muted chat suppresses that contact's incoming ring today — but a mutual attempt is not an unsolicited ring (the muted person themselves just called that contact), so resolution/auto-connect still applies.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When two contacts each have an unanswered outgoing call to the other in progress at the same time (any overlap between the two attempts, from the moment a call is placed until it is answered or ended), the system MUST resolve them to a single call — never two parallel rings, a busy result, or mutual "Calling…" hangs.
- **FR-002**: Resolution MUST be deterministic and symmetric: both devices, acting independently on the same information, MUST pick the same surviving attempt (and the same yielding attempt) regardless of message timing.
- **FR-003**: When both attempts are the same kind (both audio, or both video), the yielding side MUST join the surviving call automatically — no incoming ring, no Accept tap — and the surviving side MUST see its outgoing call get answered normally.
- **FR-004**: Automatic joining MUST NOT capture any media the yielding person did not already consent to by placing their own call. When the kinds differ, the system MUST NOT auto-connect; the surviving attempt is presented to the yielding side as a normal incoming call showing its kind, and the existing accept/decline flow applies.
- **FR-005**: Resolution MUST cover the entire lifetime of an outgoing attempt — explicitly including the setup window between the user tapping "call" and the attempt audibly ringing (permission prompts, camera warm-up, connection preparation). An offer from the same contact arriving anywhere in that window MUST trigger resolution, not a second incoming call, and MUST NOT corrupt the outgoing attempt's state.
- **FR-006**: An incoming call from a DIFFERENT person arriving during the setup window MUST leave the outgoing attempt intact and MUST receive the existing treatment for calling a busy person (busy, or the call-waiting prompt when a slot is free).
- **FR-007**: After resolution, each person's call history MUST show exactly one entry for the mutual attempt — a normal answered call (outgoing on the surviving side, incoming on the yielding side). The yielding side's abandoned attempt MUST NOT surface as a separate missed, declined, or unanswered call on either side.
- **FR-008**: Audible/visual cues MUST follow the resolution: the yielding side's "calling" tone transitions into the connected call without ever playing an incoming ringtone for the mutual case; connected-call cues then behave as for any answered call.
- **FR-009**: All existing behaviors for non-mutual situations MUST be preserved: sequential calls, busy handling, call waiting (hold/swap/drop), group calls, and declining/cancelling — none of these change except as required by FR-001–FR-008.

### Key Entities

- **Outgoing attempt**: a call one person has placed that has not yet been answered or ended; carries the callee, the kind (audio/video), and its progress (setting up / ringing).
- **Mutual pair**: two outgoing attempts, one on each side, each aimed at the other person, overlapping in time; resolves to one surviving attempt and one yielding attempt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In repeated trials of two devices calling each other within 0–2 seconds of one another (same kind, both audio and both video), 100% of trials end with both devices in one connected call, with no manual accept.
- **SC-002**: The mutual case connects within the normal answer-to-connected time for a single call (no added waiting attributable to the resolution beyond ~1 second).
- **SC-003**: Zero occurrences (in those trials) of: both sides stuck on "Calling…", a busy result, a call-waiting prompt for the mutual attempt, or a no-answer timeout.
- **SC-004**: In mismatched-kind trials, zero occurrences of a camera turning on for a user who neither placed nor accepted a video call.
- **SC-005**: After each trial, each device's call history shows exactly one entry for the encounter, marked answered (not missed/declined).

## Zero-Knowledge Impact

- **What crosses the wire**: nothing new. Resolution is decided independently on each
  device from information it already has — its own outgoing attempt and the peer's
  crossing (sealed) call offer. Connecting uses the same sealed answer a manual accept
  would send; abandoning the yielding attempt uses the same sealed cancel/end a manual
  hang-up during "Calling…" would send.
- **What is encrypted**: everything content-bearing, exactly as today — offers, answers,
  cancels, and all call signalling remain sealed over the pair's existing ratchet. No new
  frame types, no new fields readable by the server.
- **Unavoidably visible metadata**: unchanged — the server continues to see only that
  sealed call-signalling envelopes flow between the two users (as for any call today).
  The resolution does not create additional envelopes beyond a normal placed-then-
  answered call plus the one cancel of the abandoned attempt.
- **Why**: the feature is purely a client-side policy change about how two already-
  visible attempts are presented and answered; the server keeps relaying blindly.

## Assumptions

- Scope is 1:1 direct calls between contacts. Group calls resolve join collisions by an existing mechanism and are out of scope.
- The surviving attempt is chosen by the existing deterministic tie-break already used for glare (a fixed ordering of the two user identities); which side "wins" is arbitrary and invisible to users — both experience "the call connected".
- On mismatched kinds we prefer a ring over auto-connecting in a reduced form (e.g. joining a video call as audio-only): a ring is the established, well-understood consent surface, and mismatched mutual attempts are expected to be rare. This can be revisited later without breaking this spec.
- The existing in-call upgrade flow (audio → video with consent) remains the path to add video after any audio connection, including one produced by this resolution.
- No server/protocol change is assumed to be required: both devices can already observe everything they need (their own outgoing attempt and the peer's crossing offer). If planning finds otherwise, the zero-knowledge boundary still applies — the server must not learn anything new about call content or participants beyond what it relays today.
