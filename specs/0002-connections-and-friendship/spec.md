# Feature Specification: Connections & Friendship

**Feature Branch**: `feat/0002-connections-and-friendship`

**Created**: 2026-06-16

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "When a new user browses the directory they should not see people they're already connected to. Tapping a directory user offers Connect and Save to contacts — drop Save to contacts (you should first accept friendship) and rename Connect to 'Request Friendship'. Add a Friend Requests section (incoming + outgoing) and a Friends section (accepted either way). While an open valid request exists, that user shouldn't appear in the directory. An incoming request shows a badge on the Contacts tab AND the app icon, accumulating with message badges; the badge persists until the request is answered. Requests carry timestamps (incoming and outgoing). You can cancel an outgoing request, which also retracts it from the other party's incoming list."

## Overview

Ring already has a server-side consent gate (`connections`: pending/accepted/
rejected with timestamps) and a directory, but the UX contradicts a friendship
model: the directory **auto-connects and auto-imports every member**, shows
everyone (including people you already know), and offers a "Save to contacts"
shortcut that skips consent. Requests are split across two overlapping
representations (the server connections store and local `FriendRequest` records),
surfaced in several confusing Contacts sections, and an outgoing request can't be
cleanly withdrawn from the other person's inbox.

This feature makes the model coherent: browsing the directory shows only people
you are **not** already connected to and have **no open request** with; the single
action is **Request Friendship**; requests live in one **Friend Requests** section
(incoming + outgoing, each with a timestamp); accepted people live in a **Friends**
section; you can **cancel an outgoing request** and it disappears from the other
person's incoming list; and an incoming request badges the **Contacts tab and the
app icon** (accumulating with unread messages) until you answer it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Directory shows only not-yet-connected people (Priority: P1)

Browsing the user directory, I see people I'm not already friends with and have no
open request with — not my existing friends, and not anyone I already have a
pending request to/from.

**Why this priority**: Without this, the directory is cluttered with people you
can't meaningfully act on, and it currently auto-adds everyone, breaking consent.

**Acceptance Scenarios**:

1. **Given** I am friends with user X (accepted, either direction), **When** I
   browse the directory, **Then** X does not appear.
2. **Given** I have a pending request to/from user Y, **When** I browse the
   directory, **Then** Y does not appear (until the request is answered/cancelled).
3. **Given** I browse the directory, **When** members load, **Then** they are NOT
   silently imported as contacts or auto-connected; they appear only as directory
   entries I can act on.

---

### User Story 2 - Request Friendship is the only action (Priority: P1)

Tapping a directory user offers a single primary action, **Request Friendship**
(no "Save to contacts"). Sending it creates an outgoing request.

**Acceptance Scenarios**:

1. **Given** a directory user I'm not connected to, **When** I tap them, **Then**
   the action is "Request Friendship" and there is no "Save to contacts" option.
2. **When** I send the request, **Then** it appears in my Friend Requests
   (outgoing) and the user disappears from my directory browse list.

---

### User Story 3 - Friend Requests section with incoming + outgoing + timestamps (Priority: P1)

The Contacts tab has one **Friend Requests** section listing both incoming
("wants to be friends") and outgoing ("requested") requests, each showing **when**
it was made; incoming requests have Accept/Decline, outgoing have Cancel.

**Acceptance Scenarios**:

1. **Given** incoming and outgoing requests exist, **When** I open Contacts, **Then**
   one Friend Requests section shows both, each with a human timestamp, incoming with
   Accept/Decline and outgoing with Cancel.
2. **Given** I accept an incoming request (or my outgoing one is accepted), **Then**
   that person moves to the Friends section and leaves Friend Requests.

---

### User Story 4 - Friends section (Priority: P2)

Accepted connections (whether I accepted theirs or they accepted mine) appear in a
**Friends** section.

**Acceptance Scenarios**:

1. **Given** an accepted connection, **When** I open Contacts, **Then** the person
   is in Friends and not in Friend Requests or the directory.

---

### User Story 5 - Cancel an outgoing request retracts it everywhere (Priority: P1)

I can cancel an outgoing request; it leaves my outgoing list AND disappears from
the other person's incoming list, and both of us can then re-discover each other in
the directory.

**Why this priority**: A request you can't cleanly take back is a trust/UX problem;
the current cancel is a best-effort peer message that fails if the peer is offline.

**Acceptance Scenarios**:

1. **Given** I have an outgoing pending request to Z, **When** I cancel it, **Then**
   it is removed from my outgoing list and from Z's incoming list (server-side
   withdraw, not only a peer message), and Z's badge for it clears.
2. **Given** I cancelled, **When** either of us browses the directory, **Then** the
   other reappears (no lingering open request).

---

### User Story 6 - Incoming-request badges that persist until answered (Priority: P2)

An incoming friend request raises a count badge on the **Contacts tab** and the
**app icon**, combined with unread-message/missed-call counts, and the badge stays
until I accept or decline the request.

**Acceptance Scenarios**:

1. **Given** one or more incoming requests, **When** I view the app, **Then** the
   Contacts tab shows a count badge and the app-icon badge includes it (added to
   unread messages and missed calls).
2. **Given** an unanswered incoming request, **When** I navigate around without
   answering it, **Then** the badge does not clear; it clears only on accept/decline.

### Edge Cases

- A request whose target/requester later blocks the other: directory hiding +
  request state must stay consistent (no ghost entries).
- Cancel arriving when the other party already accepted: the accept wins (no
  resurrection of a withdrawn request); state converges.
- Offline cancel: the withdraw is recorded server-side so the other side reflects it
  on next sync even if it was offline at cancel time.
- Group-invite requests (existing `kind:'group-invite'`) are a separate flow and
  MUST NOT be merged into the friend Friend Requests/Friends sections incorrectly.
- Directory entry for someone with a *rejected* prior request: define whether they
  reappear (assumption: a rejected/withdrawn request frees them to reappear; a
  block keeps them hidden).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Directory browse/search MUST exclude users who are already friends
  (accepted connection, either direction) and users with an open pending request
  (incoming or outgoing).
- **FR-002**: Browsing the directory MUST NOT auto-import members as contacts or
  auto-mark them connected; membership in the directory is not friendship.
- **FR-003**: The only directory action for a not-yet-connected user MUST be
  "Request Friendship"; "Save to contacts" MUST be removed.
- **FR-004**: Sending a request MUST create an outgoing pending request and remove
  that user from the requester's directory browse results.
- **FR-005**: The Contacts tab MUST present a single **Friend Requests** section
  containing both incoming and outgoing pending requests; incoming offer
  Accept/Decline, outgoing offer Cancel.
- **FR-006**: Each request (incoming and outgoing) MUST display a timestamp of when
  it was made (sourced from the existing server `created_at`/`updated_at`).
- **FR-007**: Accepted connections (either direction) MUST appear in a **Friends**
  section and not in Friend Requests or the directory.
- **FR-008**: Cancelling an outgoing request MUST withdraw it server-side so it is
  removed from the other party's incoming list (not only via a peer message),
  converging even if a side was offline.
- **FR-009**: After cancel/withdraw (or decline), the two users MUST be able to
  rediscover each other in the directory (no lingering open request) — unless a
  block applies.
- **FR-010**: Incoming friend requests MUST contribute to the Contacts tab badge
  and the app-icon badge, accumulating with unread messages and missed calls, and
  MUST persist until the request is accepted or declined.
- **FR-011**: The two request representations (server connections + local
  `FriendRequest` records) MUST be reconciled so each pending request is shown once,
  with consistent state, timestamp, and actions (no duplicate/contradictory rows).
- **FR-012**: All new/changed UI MUST use stock Ionic components + existing theme
  tokens (Constitution XI).

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire**: The connection graph + request states already live on
  the server (existing `connections` table — the consent gate). This feature adds a
  **withdraw/cancel** endpoint that abandons a *pending* row the server already
  holds, and surfaces existing timestamps. No message/profile plaintext is added to
  the wire. The server already sees who-requested-whom (unavoidable for a consent
  gate); this does not expand that beyond what relaying a request requires.
- **What is encrypted**: Profile data shown for a request (name/avatar) continues to
  come from the directory/contact via existing paths; no new plaintext at rest.
- **Metadata**: No new server-visible metadata beyond the request/withdraw the
  consent gate inherently needs. The withdraw notification reuses the existing
  `connect-update` frame style.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The directory never lists a current friend or a user with an open
  request (verified e2e for both directions).
- **SC-002**: Tapping a directory user offers only "Request Friendship"; no
  "Save to contacts" anywhere.
- **SC-003**: Friend Requests shows incoming + outgoing with timestamps; accepting
  moves the person to Friends; both verified e2e.
- **SC-004**: Cancelling an outgoing request removes it from the other party's
  incoming list server-side (verified across two accounts e2e), and both reappear in
  each other's directory.
- **SC-005**: An incoming request increments the Contacts-tab and app-icon badges
  (added to unread/missed), and the badge persists until answered.

## Assumptions

- Reuse the existing server `connections` table (states + `created_at`/`updated_at`)
  rather than a new model; add a withdraw endpoint + store method + a
  `connect-update`-style frame, and a forward-only migration only if a column is
  missing (none expected — timestamps already exist).
- "Friends" = an accepted connection in either direction; the local contact record
  remains the address-book entry, gated by connection state for messaging.
- The dual request representation is consolidated by treating the server connections
  store as the source of truth for friend requests, with local records reconciled to
  it (group invites stay a separate `kind`).
- A rejected or withdrawn request frees both users to reappear in the directory; a
  block keeps the blocker hidden from the blocked (existing behavior).
- Badge plumbing reuses `useBadges` + `countPendingRequests`; the change ensures
  incoming *connection* requests (server) are counted, not only legacy local records.
