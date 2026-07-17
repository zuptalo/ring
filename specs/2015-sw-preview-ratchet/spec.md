# Feature Specification: Background notifications decrypt queued messages reliably

**Feature Branch**: `fix/2015-sw-preview-ratchet`

**Created**: 2026-06-25

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: Confirmed on-device (via the spec-2014 diagnostic, reason = `decrypt-failed`): after the
app has been idle a while, background push notifications show the generic "New message" instead of the
content because the service worker's READ-ONLY message preview can't decrypt the queued message. Root
cause: 1:1 call signalling (offer/ICE and spec-0007's frequent `qos` health reports) rides the SAME
pairwise Double Ratchet as chat, but is sent LIVE over the WebSocket and never queued in the relay.
While the app is open those live signals advance AND persist the ratchet, moving the persisted state
PAST a chat message still sitting in the relay queue. The SW's read-only preview then decrypts that
queued message from an over-advanced ratchet base → wrong key → "ciphertext cannot be decrypted" →
generic. Fix: let the preview persist the receiving-ratchet advance + skipped message keys (so the
session moves forward and stays able to decrypt), while keeping prekey/X3DH and the send-preamble
strictly the page's job. No content ever leaves the device.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Background notifications show the message even after a gap (Priority: P1)

When a message arrives while the app is backgrounded/closed — even after the app has been idle a long
time and there's been call activity in between — the notification shows the real (decrypted) message
content (for a chat set to show content), not a generic placeholder, just as it does right after the
app was last open.

**Why this priority**: Notifications silently degrading to "New message" makes them untrustworthy;
the user can't tell "preview off" from "the app failed to decrypt this".

**Independent Test**: Establish a 1:1 session; advance + persist the ratchet via live signalling (a
call's signals / `qos`) so the persisted state is ahead of a queued chat message; then have the
service worker preview that queued message → it decrypts and shows the content (no `decrypt-failed`
fallback). Regression: a normal fresh message still previews.

**Acceptance Scenarios**:

1. **Given** a 1:1 chat (content shown) and a persisted ratchet that live signalling has advanced past
   a queued chat message, **When** the service worker previews that queued message in the background,
   **Then** it decrypts and the notification shows the content (not generic).
2. **Given** a backlog of several queued messages, **When** the SW previews them, **Then** each
   decrypts (in order) and the per-conversation notification shows the latest content.
3. **Given** the page later opens for real (authoritative receive), **When** it processes those same
   messages, **Then** it still decrypts them correctly and the session is not corrupted (no lost or
   undecryptable messages).

---

### User Story 2 - The authoritative receive and X3DH stay intact (Priority: P1)

The change must not corrupt the end-to-end-encrypted session: the page's authoritative message
receive continues to work, one-time prekeys are still consumed only by the page, and the initiator's
send-preamble is still cleared only by the page. The preview only ever moves the receiving ratchet
forward and caches skipped keys — both idempotent with the page's later open.

**Why this priority**: A wrong move here could drop messages or break the session — worse than the
original bug.

**Independent Test**: After the SW preview persists an advanced ratchet, the page's authoritative
open of the same and subsequent messages still succeeds; a first-contact prekey message is still
established/consumed by the page, not the preview.

**Acceptance Scenarios**:

1. **Given** the SW preview advanced + persisted the receiving ratchet, **When** the page later opens
   the same messages, **Then** they decrypt (via the cached skipped keys) and later messages continue
   to decrypt.
2. **Given** a first-contact prekey (X3DH) message, **When** the SW previews it, **Then** it does NOT
   consume the one-time prekey or persist a new responder session (the page remains authoritative for
   X3DH); the preview still shows the content in-memory.
3. **Given** an initiator awaiting confirmation, **When** the SW previews an inbound message, **Then**
   the send-preamble is NOT cleared by the preview (only the page clears it).

### Edge Cases

- Out-of-order / re-delivered frames: decrypt via the persisted skipped-key cache (Double Ratchet's
  normal mechanism), bounded by the existing max-skip.
- A large backlog (more than the relay returns at once): previewing from the persisted base skips and
  caches forward as needed, within the existing max-skip bound.
- Concurrent SW push handlers: the preview's session writes are serialized (per-chat) so two pushes
  can't interleave a load→advance→save.
- The page and SW are different execution contexts: their session writes converge via last-write-wins
  + the skipped-key cache (the same idempotency the protocol already relies on for out-of-order).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The service-worker message preview MUST be able to decrypt a queued message whose
  position is behind a persisted ratchet that live signalling (call/`qos`) advanced past — by
  persisting the receiving-ratchet advance and the skipped message keys it generates.
- **FR-002**: Previewing a backlog MUST decrypt the queued messages in order (advancing one session),
  not fail on messages after the first.
- **FR-003**: The preview MUST NOT consume one-time prekeys or persist a newly-established responder
  (X3DH) session — first-contact prekey handling remains the page's job (decrypt in-memory only).
- **FR-004**: The preview MUST NOT clear the initiator send-preamble (only the page's authoritative
  receive clears it).
- **FR-005**: After the preview persists an advanced ratchet, the page's authoritative receive of the
  same or later messages MUST still decrypt correctly (no corruption, no lost messages) — relying on
  the skipped-key cache for idempotency.
- **FR-006**: The preview's per-chat session writes MUST be serialized so concurrent background push
  handlers can't interleave a load→advance→save on the same session.
- **FR-007**: Zero-knowledge unchanged: no plaintext leaves the device; the SW still only fetches the
  sealed ciphertext the relay already stores; no server change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the persisted ratchet advanced past a queued message (via simulated live
  signalling), the SW preview decrypts it and the notification shows content — the `decrypt-failed`
  fallback no longer occurs for this case.
- **SC-002**: A queued backlog previews fully (each message decrypts in order).
- **SC-003**: The authoritative page receive still decrypts the same + subsequent messages after a
  preview advanced the session; first-contact prekey + preamble remain page-only.
- **SC-004**: No regression to the crypto unit suite or the notification/SW-decrypt e2e.

## Assumptions

- The Double Ratchet's skipped-key cache makes a forward-advanced session idempotent for the page's
  later open (the protocol's intended out-of-order path), so persisting the preview's advance is safe.
- The dominant trigger is live call/`qos` signalling advancing the shared ratchet (confirmed
  mechanism); making the preview persist-forward fixes it regardless of which signal advanced it.
- The fix is client-only; no server or schema change; the zero-knowledge boundary is unchanged.
