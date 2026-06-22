# Feature Specification: Unify in-app notifications/toasts + user-friendly "What's new"

**Feature Branch**: `fix/2004-unify-app-notifications`

**Created**: 2026-06-22

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     Directory number sets the category (2001+ = hotfix/bug). -->

**Input**: An installed iOS user reported the "Update available" prompt rendering broken
(pinned under the status bar, sharp top corners) and the "What's new" text reading as
developer jargon ("9 AM-local, behind-only version-announcement push (spec 1016)").

## Overview

Ring surfaces several kinds of in-app messages: notification-class cards (an incoming
message, a friend request, a system notice, and the "update available" prompt) and small
functional toasts (confirmations like "Muted", "Copied"; errors like "Microphone
unavailable"). Today the update prompt is rendered differently from the other notification
cards and renders **broken** on iOS (pinned to the very top, sharp corners), and the
functional toasts are created ad-hoc with inconsistent timing/appearance. Separately, the
"What's new" release notes shown to users are copied verbatim from developer commit
subjects, so they read as jargon with internal references.

This change makes every in-app **notification card** render through **one shared surface**
(so they look and sit identically and a fix in one place applies to all), gives the
**functional toasts** a single shared presentation (consistent and tunable in one place),
makes the **"What's new"** text read as plain user-facing language, and adds **governance**
so future release notes stay user-friendly by construction.

## Bug & Root Cause

- **Symptom 1**: the "update available" prompt appears pinned to the top of the screen
  (overlapping the status bar) with sharp top corners, unlike the app's other in-app
  notification cards, which appear as rounded cards below the header.
- **Root cause 1**: it is the only notification rendered as a transient system-style toast;
  the offset/rounding applied to it does not take effect on iOS, while the shared in-app
  notification overlay (used by messages/requests/system notices) positions and rounds
  correctly.
- **Symptom 2**: the "What's new" entry shows the raw (developer) commit summary, including
  an internal spec reference.
- **Root cause 2**: the user-facing release-note line is derived solely from the commit
  subject, with no rule that subjects be written as end-user copy, and the cleanup that
  strips internal references doesn't catch references that carry extra detail.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The update prompt looks like every other notification (Priority: P1)

A user offered an app update sees the prompt as a rounded card sitting below the header —
the same shape and position as an incoming-message or friend-request card — never pinned
under the status bar and never with sharp corners. Its actions (What's new / Update /
Later) are present and work.

**Why this priority**: This is the reported breakage; fixing it is the point.

**Independent Test**: Trigger the update prompt and confirm it renders as a rounded card
below the header (matching the message/system cards), with working actions.

**Acceptance Scenarios**:

1. **Given** an update is available, **When** the prompt appears, **Then** it is a rounded
   card positioned below the app header (not under the status bar, no sharp corners),
   visually consistent with the other in-app notification cards.
2. **Given** the prompt is showing, **When** the user taps What's new / Update / Later,
   **Then** each action behaves as before (open the details sheet / install / dismiss).
3. **Given** the prompt is dismissed but the update is still pending, **When** the app
   returns to the foreground, **Then** the prompt re-appears as a single card (it replaces,
   never stacks).

### User Story 2 - All notification cards share one surface (fix-once) (Priority: P1)

All notification-class surfaces (message, request, system notice, update prompt) render
through one shared component, so a change to their position/appearance in one place applies
to all of them.

**Why this priority**: This is what guarantees the bug can't recur per-surface and is the
user's explicit ask ("reuse the same shared component … adjusting it in one place fixes it
for all").

**Independent Test**: Change the shared card's offset/corner styling in one place and
confirm every notification kind (including the update prompt) reflects it.

**Acceptance Scenarios**:

1. **Given** the four notification kinds, **When** they are displayed, **Then** they share
   identical position, corner rounding, width, and base styling because they come from one
   component.
2. **Given** a single styling change to that component, **When** rebuilt, **Then** all four
   kinds reflect it without per-surface edits.

### User Story 3 - Functional toasts are mutually consistent (Priority: P2)

Confirmation and error toasts (e.g. "Muted", "Copied", "Microphone unavailable") look and
behave consistently — same position, rounded corners, and a sensible default duration —
because they go through one shared helper, tunable in one place. (They remain simple
transient toasts, not avatar cards.)

**Why this priority**: Consistency polish across ~two dozen scattered call sites; valuable
but secondary to the broken prompt.

**Independent Test**: Trigger several confirmation/error toasts from different screens and
confirm uniform position, rounding, and duration; change the shared helper once and confirm
all reflect it.

**Acceptance Scenarios**:

1. **Given** any confirmation or error toast, **When** shown, **Then** it uses the shared
   presentation (same position, rounded corners, default duration unless explicitly set).
2. **Given** a change to the shared toast presentation, **When** rebuilt, **Then** all
   functional toasts reflect it.

### User Story 4 - "What's new" reads as plain language (Priority: P2)

A user reading "What's new" sees plain, benefit-focused descriptions with no internal
jargon and no spec/issue references.

**Why this priority**: The reported jargon issue; user-facing quality.

**Independent Test**: Render the "What's new" list for release notes whose underlying
subjects contain references like "(spec 1013 US2/US3)" and confirm no such reference text
is shown.

**Acceptance Scenarios**:

1. **Given** a release note whose source subject ends with an internal reference (even one
   carrying extra detail, e.g. "(spec 1013 US2/US3)"), **When** shown in "What's new",
   **Then** the reference is not displayed.
2. **Given** the "What's new" list, **When** read, **Then** entries are sentence-style
   plain language without code/spec jargon.

### User Story 5 - Governance keeps release notes user-friendly (Priority: P2)

The project's governing documents require that user-facing commit types' subjects be
written as plain end-user release-note copy, so future "What's new" entries are
user-friendly by construction (not reliant on after-the-fact cleanup).

**Why this priority**: Prevents regression of US4 at the source; the user explicitly asked
for it.

**Independent Test**: The constitution and contributor guide state the rule (with an
example), and the constitution version is bumped to reflect the amendment.

**Acceptance Scenarios**:

1. **Given** the governing documents, **When** read, **Then** they require feat/fix/perf/
   security commit subjects to be plain-language, benefit-focused, jargon-free, and free of
   spec/issue references.
2. **Given** the amendment, **When** the constitution is inspected, **Then** its version
   metadata reflects the change.

### Edge Cases

- **Re-prompting**: dismissing the update prompt and returning to the foreground shows one
  card, not a growing stack (it replaces by identity).
- **Update prompt persistence**: the update card is not auto-dismissed on a timer; it stays
  until the user acts or explicitly closes it (unlike transient confirmation toasts).
- **Long version strings**: an unbreakable token (e.g. a version with a build hash) must
  not blow up the card layout.
- **A toast and a notification card at the same time**: both remain legible (the rare
  overlap is acceptable; they share the top region).
- **A release note with no internal reference**: shown unchanged (the cleanup only removes
  reference text, never real content).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app-update prompt MUST render through the same shared in-app notification
  surface as message/request/system notifications (a rounded card positioned below the
  header), not as a separate top-pinned toast.
- **FR-002**: The update card MUST present its actions — open "What's new", Update now, and
  Later/dismiss — and each MUST behave as before.
- **FR-003**: The update card MUST be persistent (no auto-dismiss timer) and, when
  re-shown, MUST replace the existing card rather than stack a duplicate.
- **FR-004**: All notification-class surfaces (message, request, system, update) MUST share
  one component such that a single change to position/corners/base style applies to all.
- **FR-005**: Functional confirmation and error toasts MUST be presented via one shared
  helper that sets a consistent position, rounded corners, and default duration in one
  place; individual call sites only supply message text (and optionally an error/success
  variant or an explicit duration).
- **FR-006**: Functional toasts MUST remain simple transient toasts (not rendered as
  avatar/notification cards).
- **FR-007**: The "What's new" release-note text MUST be shown free of internal references
  (spec/issue identifiers), including references that carry extra detail such as
  "(spec 1013 US2/US3)".
- **FR-008**: The governing documents (project constitution and the contributor guide) MUST
  require that, for user-facing commit types (feat/fix/perf/security), the subject after the
  type/scope prefix is plain-language, benefit-focused end-user release-note copy with no
  internal jargon and no spec/issue references; the constitution's version metadata MUST be
  updated to record the amendment.
- **FR-009**: The separate full-screen "What's new" details view (opened from the update
  card) MUST be retained and continue to function.

### Key Entities

- *(none — client-side presentation + release-note phrasing + governance docs; no data
  model change.)*

## Zero-Knowledge Impact

*(Required by Constitution Principle I.)*

- **What new data becomes visible to the server?** None. This change is entirely
  client-side presentation (how in-app notifications/toasts render), release-note phrasing,
  and governance documents. No client/server contract, request, payload, or stored data
  changes. The crypto/ZK checklist is therefore **not required** for this spec.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The update prompt appears as a rounded card below the header in 100% of cases
  (never pinned under the status bar, never with sharp corners) — verified visually on the
  affected platform.
- **SC-002**: All four notification kinds (message/request/system/update) share identical
  position and corner styling, sourced from a single component (one styling change updates
  all four).
- **SC-003**: 100% of functional confirmation/error toasts route through the shared helper
  (consistent position + rounded corners + default duration); the count of direct ad-hoc
  toast-creation call sites for confirmations/errors drops to zero (excluding documented
  special cases).
- **SC-004**: 0% of "What's new" entries display an internal spec/issue reference, including
  references with extra detail — verified by a test over representative subjects.
- **SC-005**: The constitution and contributor guide both state the user-facing
  release-note phrasing rule, and the constitution version is bumped.

## Assumptions

- The existing in-app notification overlay (used for message/request/system cards) is the
  correct, well-positioned surface to also host the update prompt; it can carry a title +
  body + action buttons.
- A small number of pre-existing toast call sites with bespoke behavior (e.g. a sticky
  prompt with its own buttons) may remain special-cased and are documented as exceptions to
  the shared functional-toast helper.
- Already-shipped commit subjects cannot be rewritten; the phrasing rule applies going
  forward, while the prettifier cleanup covers historical references at display time.
- Desktop and Android render the same shared surfaces; the fix is not iOS-specific even
  though the breakage was reported on iOS.
