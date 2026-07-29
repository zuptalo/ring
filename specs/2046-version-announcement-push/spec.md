# Feature Specification: Push tickles fit constrained push endpoints

**Feature Branch**: `fix/2046-version-announcement-push`

**Created**: 2026-07-19

**Status**: shipped

**Input**: Prod logs show `push: non-success status=413 body="…Payload Too Large… Converted
buffer is too long by 1441 bytes" endpoint=updates.push.services.mozilla.com` — a Firefox
subscription rejecting our push as too large. Our tickles are tiny and content-free
(`{"t":"version"}`, `{"t":"msg"}`, …, largest `{"t":"post-activity","post":"<id>"}`), but the
Web Push library (`webpush-go`) pads every encrypted record UP TO its default `RecordSize`
of 4096 bytes, so a ~15-byte tickle goes out as a ~4 KB body. Some Mozilla autopush
subscriptions are flagged "constrained" with a smaller max, so they 413. Affected devices
never receive that push (e.g. the daily "what's new" announcement). Correctly not pruned
(413 is an our-request fault, not a dead subscription), so it just silently fails each time.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every push service accepts our tickles (Priority: P1)

A user on Firefox (or any push service with a small payload limit) receives Ring's pushes —
messages, calls, and version announcements — instead of the service rejecting them as too
large.

**Why this priority**: An entire push-service tier silently drops all our notifications; the
version-announcement daily push never lands for those users.

**Independent Test**: The encrypted POST body for a tickle is small (well under 4 KB and
under a constrained ~2.6 KB limit), asserted by capturing the request in the push unit test.

**Acceptance Scenarios**:

1. **Given** any tickle payload, **When** it is sent, **Then** the encrypted request body is
   sized to just fit the payload (hundreds of bytes), not padded to ~4 KB.
2. **Given** the largest tickle (`post-activity` with a post id), **When** it is sent, **Then**
   the record size still exceeds the payload (no encryption underflow) and the body stays
   small.
3. **Given** a constrained Mozilla endpoint, **When** a version announcement is sent, **Then**
   it is accepted (no 413).

### Edge Cases

- A future, larger payload: the record size is computed from the payload length plus fixed
  framing overhead, so it always exceeds the payload and never errors.
- Other services (Apple/FCM) that accepted the 4 KB body also accept the smaller one (a
  smaller compliant body is universally accepted).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Web Push send MUST set `RecordSize` so the encrypted record is sized to fit
  the (content-free) payload plus framing overhead, rather than the library's 4096-byte
  default padding.
- **FR-002**: The chosen record size MUST always exceed the payload length by the required
  aes128gcm framing (header + delimiter + auth tag) so encryption never underflows/errors,
  for every current and reasonably-sized future tickle.
- **FR-003**: The resulting body MUST be small enough for constrained push endpoints
  (comfortably under the observed ~2.6 KB Mozilla limit and the 4 KB Web Push floor).
- **FR-004 (zero-knowledge)**: Reducing padding MUST NOT increase metadata exposure. The
  tickle TYPE is already visible to the push service via the cleartext `Topic` header (used
  for collapsing), so record-length no longer obfuscates anything; payloads remain
  content-free.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A tickle's encrypted POST body is < 512 bytes (was ~4096), asserted in the push
  unit test via the captured request Content-Length.
- **SC-002**: Prod: `updates.push.services.mozilla.com` stops returning 413 for our sends;
  the Firefox subscription receives version announcements.
- **SC-003**: No regression for Apple/FCM sends (existing header/TTL/topic tests stay green).

## Zero-Knowledge Impact

No change to what crosses the wire in content terms — payloads stay the fixed content-free
markers, encrypted end-to-end to the subscription's keys. Padding to 4096 bytes previously
obscured the payload LENGTH, but the tickle type is already disclosed to the push service by
the cleartext `Topic` header we send for collapsing, so length obfuscation added nothing;
removing it leaks nothing new. No new fields, endpoints, logs, or storage.

## Assumptions

- The observed constrained limit (~2.6 KB for that Mozilla endpoint) is representative; a
  payload-relative record size (~150–250 bytes) clears it and any spec-compliant service.
- `webpush-go` v1.4.0 `Options.RecordSize` controls the record/padding size (default 4096).
