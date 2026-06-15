# Feature Specification: Empty Chats/Calls Hint

**Feature Branch**: `feat/1003-empty-chats-calls`

**Created**: 2026-06-15

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "when there are no chats or recent calls add a similar first item which gives a hint to the Contacts to start a call or conversation with their contacts, and in Contacts when there are no contacts, we already get a hint to Browse user directory"

## Overview

When the Chats or Calls tab is empty, the screen is a dead end — a bare "No chats
yet" / "No calls found" with no obvious next step. The Contacts tab already solves
this: it pins a "Browse user directory" row that points the user forward. This
feature mirrors that pattern: an empty Chats or Calls tab shows a tappable first
row that guides the user to the Contacts tab to start a conversation or a call.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Empty Chats hints to start a conversation (Priority: P1)

A user with no chats opens the Chats tab and sees a clear, tappable row inviting
them to start a conversation, which takes them to Contacts.

**Why this priority**: An empty Chats tab is the most common first-run state; a
dead end here is the biggest "what now?" moment.

**Independent Test**: With no chats, the Chats tab shows the hint row; tapping it
navigates to the Contacts tab.

**Acceptance Scenarios**:

1. **Given** the user has no chats, **When** they open the Chats tab, **Then** a
   first row "Start a conversation / Pick a contact to chat with" is shown.
2. **Given** that row, **When** the user taps it, **Then** the app navigates to the
   Contacts tab.
3. **Given** a non-empty filter that happens to match nothing (e.g. Unread), **When**
   the user views it, **Then** a short contextual message is shown (not the hint row).

---

### User Story 2 - Empty Calls hints to start a call (Priority: P2)

A user with no recent calls opens the Calls tab and sees a tappable row inviting
them to start a call, which takes them to Contacts.

**Why this priority**: Same dead-end problem on Calls; slightly less frequent than
Chats but the same fix.

**Independent Test**: With no recent calls, the Calls tab shows the hint row;
tapping it navigates to the Contacts tab.

**Acceptance Scenarios**:

1. **Given** the user has no recent calls, **When** they open the Calls tab, **Then**
   a first row "Start a call / Pick a contact to call" is shown.
2. **Given** that row, **When** the user taps it, **Then** the app navigates to the
   Contacts tab.

---

### Edge Cases

- The hint must appear only once data has loaded (no flash before chats/calls
  resolve) — reuse the existing `loaded` gate (spec 1001).
- A brand-new user with no contacts who taps the hint lands on Contacts, which
  already shows the "Browse user directory" row — so the flow continues naturally.
- The hint must not appear when the tab actually has content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the Chats tab has no chats at all, it MUST show a tappable first
  row hinting to start a conversation, navigating to the Contacts tab.
- **FR-002**: When the Calls tab has no recent calls, it MUST show a tappable first
  row hinting to start a call, navigating to the Contacts tab.
- **FR-003**: The hint rows MUST visually match the existing Contacts "Browse user
  directory" row (icon + title + subtitle + chevron, flush at the top).
- **FR-004**: The hints MUST appear only after data has loaded (no empty-state flash),
  and MUST NOT appear when the tab has content.
- **FR-005**: A filtered-but-empty Chats view (e.g. Unread with nothing) MUST keep
  showing its short contextual message, not the start-a-conversation hint.
- **FR-006**: Contacts is unchanged — it already hints to "Browse user directory"
  when empty.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With no chats, the Chats tab shows the hint row and tapping it lands on
  Contacts, in 100% of cases.
- **SC-002**: With no recent calls, the Calls tab shows the hint row and tapping it
  lands on Contacts, in 100% of cases.
- **SC-003**: No empty-state/hint flash occurs before data resolves (the hint is
  gated on `loaded`).

## Assumptions

- "Similar first item" means the same visual treatment as the Contacts "Browse user
  directory" row.
- Both hints route to the Contacts tab (`/tabs/contacts`), the single place to pick a
  contact or browse the directory — rather than duplicating a directory CTA.
- This is a pure presentation change; no data model, server, or zero-knowledge impact.
