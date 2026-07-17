# Feature Specification: Only one caller may wait in call-waiting; further callers get busy

**Feature Branch**: `fix/2009-single-call-waiting-slot`

**Created**: 2026-06-24

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User report: "If device 2 is in a call with device 1, and device 3 is waiting (call-waiting) to talk to device 1, then a 4th device calling device 1 STEALS the queue from device 3. We should never allow more than one device to be in call-waiting; the next caller should get 'busy in another call' right away."

## Overview

Call waiting (spec 0005) lets a busy user be offered an incoming call as a "second call" they can
Accept & hold. The two-call cap is enforced once a call is actually **held** (`heldSlot` set). But
between a second call **ringing** (the Accept & hold prompt is shown) and it being **accepted**,
the cap is not enforced: a third caller's offer is allowed to replace the pending prompt, so a
later caller silently **steals** the waiting slot from the one already there.

This hotfix closes that window: at most **one** caller may occupy the call-waiting slot at a time.
While a second call is already ringing-and-waiting, any further incoming call is answered **busy**
immediately — exactly as a call that arrives when the two-call cap is already full.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A second waiting caller can't be displaced (Priority: P1)

While A is in a call with B and C is already waiting in A's call-waiting prompt, D calls A. D is
told A is busy right away, and C keeps its place — A's prompt still shows C, not D.

**Why this priority**: It's the reported correctness bug; a caller losing their place to a later
caller is confusing for both C (silently dropped from the queue) and A (the prompt identity
changes underfoot).

**Independent Test**: With A↔B connected and C ringing A (Accept & hold prompt shown), have D call
A; confirm D receives busy/unavailable, A's pending second-incoming is still C, and accepting it
connects A↔C.

**Acceptance Scenarios**:

1. **Given** A is in a call and C is waiting in A's call-waiting prompt, **When** D calls A,
   **Then** D receives a busy result and A's prompt is unchanged (still C).
2. **Given** D was told busy, **When** A accepts the waiting call, **Then** A connects to C (the
   original waiting caller), not D.
3. **Given** C cancels or times out (the prompt clears), **When** a later caller E calls A,
   **Then** E may now occupy the freed waiting slot (the cap is one at a time, not one ever).

### Edge Cases

- **Simultaneous third + fourth**: if two further callers arrive while C waits, both get busy;
  neither displaces C.
- **C accepted just as D arrives**: once A accepts C (now held), D still gets busy (the existing
  two-call cap already covers this — this fix only adds the not-yet-accepted window).
- **Glare unaffected**: a caller the user is already dialing (outgoing glare) keeps its existing
  resolution; this fix only changes the "someone else is already waiting" case.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow at most one incoming call to occupy the call-waiting slot at a
  time — counting both an already-held second call AND a second call that is still ringing/waiting
  (not yet accepted).
- **FR-002**: When a second call is already ringing/waiting (the Accept & hold prompt is shown) or
  a call is already held, any further incoming call MUST be answered busy immediately, with no
  prompt shown for it and no change to the existing waiting call.
- **FR-003**: The original waiting caller MUST retain its place until it is accepted, declined,
  cancelled by the caller, or times out; only then may a later caller occupy the freed slot.
- **FR-004**: This MUST hold for any combination of 1:1 and group incoming calls that would
  otherwise raise the second-incoming prompt.

### Zero-Knowledge Impact

- **FR-005**: This is a client-side guard change only. The busy reply uses the existing
  `call-busy` signalling; no new server message, metadata, or state. The zero-knowledge boundary
  is unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a waiting caller already present, a further caller is told busy 100% of the
  time, and the waiting caller's place is never displaced.
- **SC-002**: After the waiting caller is accepted, the connected party is always the original
  waiting caller.
- **SC-003**: Once the waiting slot is freed (cancel/decline/timeout/accept-resolved), a later
  caller can occupy it — the limit is one-at-a-time, not one-ever.
- **SC-004**: The existing call and call-waiting e2e suites remain green (no regression to the
  Accept & hold / busy behavior).

## Assumptions

- Builds on spec 0005 (call waiting). The fix is to the shared gate that decides whether to raise
  the Accept & hold prompt versus reply busy.
- "Waiting" means a second incoming call is being shown/queued but not yet accepted; "held" means
  it was accepted and the first call was parked. The cap of one covers both states together.
- A bug fix (`2001+`): begins with a failing regression test reproducing the slot theft.
