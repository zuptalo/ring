# UI Contract: Tab-Switch Rendering Invariants

This is the observable contract the feature must satisfy. It is technology-agnostic
and frame-based, so it can be checked by visual capture and by e2e assertions.

## Invariant R1 — Complete first frame (FR-001, FR-002, SC-001)

For any switch from tab A to tab B, every painted frame shows **either** tab A
**or** a fully-formed tab B. There is no frame in which tab B is missing any of:

- its title,
- its search field,
- its top action buttons (Calls: new group / new call; Contacts: add contact;
  Chats: compose; Settings: QR + search field),
- its filter chips (Chats: All / Unread / Favorites / Groups),
- its list content (when data exists).

## Invariant R2 — No layout shift after first paint (FR-004, SC-002)

No element present in tab B's first painted frame changes position in any later
frame. Space for asynchronously-arriving regions is reserved up front.

## Invariant R3 — Real identity immediately (FR-005, SC-003)

When Settings (or any surface showing the user's own avatar/name) appears and a
real profile exists, the real photo and name are present in the first painted
frame. The generic "You"/initials placeholder is never shown in place of an
existing real profile.

## Invariant R4 — Instant return with preserved state (FR-003, SC-004)

Returning to a tab visited earlier in the session restores its previous content
and scroll position with no re-render of empty or placeholder states.

## Invariant R5 — Honest empty states (FR-006)

An empty state ("No calls found", "No contacts found", empty Chats) is shown only
once the absence of data is confirmed — never as a flash preceding real content.

## Invariant R6 — Stable under stress (FR-007, FR-009, FR-010)

- Rapid/repeated tab switching never surfaces a half-built screen or leaves a tab
  stuck in a placeholder/partial state.
- Behavior is identical across supported themes and for LTR and RTL content.
- On a genuinely cold first run, a single stable loading presentation is shown
  that does not shift layout when real content arrives (no
  empty→placeholder→populated sequence).

## How each invariant is verified

| Invariant | Verification |
|-----------|--------------|
| R1 | e2e: after switching to a (warm) tab, header + chips + list assert present synchronously; manual frame capture |
| R2 | manual frame capture / visual diff: no element bounding-box change after first paint |
| R3 | e2e: open Settings, assert real display name present without an intervening "You" text |
| R4 | e2e: scroll a tab, switch away and back, assert content + scrollTop preserved, no empty-state element |
| R5 | e2e: empty account shows empty state; populated account never renders empty-state element before list |
| R6 | e2e: rapid tab cycling leaves each tab fully rendered; bidi spec coverage for RTL |
