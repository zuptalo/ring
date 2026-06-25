# Feature Specification: Notification title tidy & generic-fallback diagnosis

**Feature Branch**: `fix/2014-notif-title-and-auth`

**Created**: 2026-06-25

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: Two notification fixes. (1) The generic/placeholder push notification sets its OWN title to
"Ring", which duplicates the app-name header iOS already shows — so the user sees "Ring" twice
("Ring › Ring › New message"). Tidy it so the title doesn't repeat the OS app name. (2) After the app
has been idle/closed a while (~an hour), background notifications stop showing the decrypted message
and fall back to the generic "New message". The initial hypothesis (expired access token) was
INVESTIGATED AND RULED OUT — Ring's bearer token is a permanent device credential with no TTL and no
refresh, and the relay fetch doesn't 401 for a logged-in device. The real cause is undetermined (most
likely the service worker being evicted after inactivity → a cold start whose decrypt misses the
window, or the device-unlock / read-only ratchet preview failing). So this spec (a) does NOT add token
refresh (it would fix nothing) and (b) surfaces the EXACT generic-fallback reason on the dev deployment
so the real cause can be confirmed on-device, ahead of the targeted content-fix.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The app name isn't shown twice on placeholder notifications (Priority: P1)

When a content-free placeholder notification is shown (locked, no-preview, or before decryption), the
notification reads cleanly — the OS shows the app name once (its forced attribution), and the
notification's own title is the message status, not a second "Ring".

**Why this priority**: "Ring › Ring › New message" looks broken/unpolished; it's the most-seen
placeholder.

**Independent Test**: Trigger a generic placeholder notification → its title is the status ("New
message"), not "Ring"; the OS still attributes it to Ring once. Rich (decrypted) notifications already
use the sender name as title — unchanged.

**Acceptance Scenarios**:

1. **Given** a generic placeholder message notification, **When** it shows, **Then** its title is not
   the literal app name "Ring" (so the app name isn't shown twice with the OS attribution).
2. **Given** a decrypted (rich) message notification, **When** it shows, **Then** its title is still
   the sender/group name (unchanged).

---

### User Story 2 - We can identify why a notification fell back to generic (Priority: P1)

When a background notification falls back to the generic placeholder, the **dev deployment** surfaces
the precise reason (couldn't reach the relay, device locked, decrypt failed, or cold-start timeout) so
the actual cause of the "generic after a while" regression can be confirmed on a real device — instead
of guessing (the token-expiry guess was already disproven). Production notifications are unchanged (no
debug text leaks to end users).

**Why this priority**: The root cause is undetermined and time-correlated; we must confirm it on-device
before shipping a content-fix, having already ruled out the token hypothesis.

**Independent Test**: On the dev host, force a fallback (e.g., locked device) → the generic
notification's body includes the reason tag; on a production host, the body shows no reason tag.

**Acceptance Scenarios**:

1. **Given** the app runs on the dev deployment, **When** a notification falls back to generic,
   **Then** the generic notification conveys the reason (relay-unreachable / locked / decrypt-failed /
   timeout) for diagnosis.
2. **Given** the app runs on the production host, **When** a notification falls back to generic,
   **Then** no internal reason text is shown to the user.

### Edge Cases

- The reason diagnostic is gated to the dev host (`ring-dev` / localhost), so it never reaches a
  production release even though both run the same build.
- Multiple fallback causes in one wake: report the first/most-specific reason.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The generic/placeholder message notification MUST NOT use the literal app name as its
  title (so iOS doesn't show the app name twice); rich notifications keep the sender/group name title.
- **FR-002**: When a background notification falls back to the generic placeholder, the service worker
  MUST determine the reason (relay non-OK / relay fetch error / device locked / decrypt failed /
  cold-start timeout).
- **FR-003**: On the dev deployment only, the generic notification MUST convey that reason (for
  on-device diagnosis); on a production host it MUST NOT show any internal reason text.
- **FR-004**: This spec MUST NOT add access-token refresh machinery — the token is a permanent device
  credential with no expiry, so token refresh would fix nothing (documented non-goal).
- **FR-005**: No server change; the zero-knowledge boundary is unchanged; the badge/iOS-notification-
  per-push behavior is preserved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A generic placeholder notification's title is not "Ring"; the app name appears once (the
  OS attribution), not twice.
- **SC-002**: On the dev host, a forced fallback shows its reason; on production, it does not.
- **SC-003**: No regression to the existing notification/SW-decrypt suites; rich notifications still
  show the sender name + content.

## Assumptions

- iOS forces the app-name attribution header from the manifest `name`; it cannot be removed per
  notification — only the notification's own title/body are controllable, so US1 fixes the title.
- The "generic after a while" root cause is undetermined; this spec instruments it (US2) rather than
  applying an unproven fix. The targeted content-fix follows once the dev-deployment reason confirms
  the cause.
