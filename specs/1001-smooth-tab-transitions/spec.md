# Feature Specification: Smooth Tab Transitions

**Feature Branch**: `feat/1001-smooth-tab-transitions`

**Created**: 2026-06-15

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "navigating the ui is not as smooth as it should be, when switching between tabs I can see the rendering of different sections and that is not a native feeling you'd expect from using ionic, I have captured a video and then exported the before and after frames from when changes are happening so you better understand the problem and can come up with proper solution for it"

## Overview

When a user switches between the four bottom tabs (Calls, Chats, Contacts,
Settings), the destination screen does not appear fully formed. Instead the
user briefly sees an incomplete version of the screen that then "fills in" over
the next moment. The captured before/after frames show this consistently:

- **Calls**: first frame shows only the large "Calls" title, "Recent" heading,
  and "No calls found" — with **no search bar and no top-right action buttons**.
  A later frame shows the same screen now **with** the search bar and the
  "new group / new call" action buttons, and (when data exists) the populated
  recent-calls list.
- **Chats**: first frame shows only the "Chats" title on an otherwise empty
  screen — **no search bar, no filter chips (All / Unread / Favorites /
  Groups), and no chat list**. A later frame shows the full screen with search,
  filter chips, and the conversation list.
- **Contacts**: first frame shows the "Contacts" title and the "Browse user
  directory" row with **no search bar, no add-contact button, and "No contacts
  found"**. A later frame shows the search bar, the add-contact button, the
  "Invited" section, and the populated contact list.
- **Settings**: first frame shows a **generic placeholder profile** — a plain
  "Y" avatar and the name "You" — and is missing the search field and the
  top-right QR action. A later frame shows the **real profile photo and name
  ("Kamran")**, the "Search settings" field, and the QR action.

The net effect is visible pop-in, layout shift, and a non-native feel on every
tab switch. The goal of this feature is to make tab switching present the
destination screen as a single, complete, stable view — matching the instant,
fully-rendered transitions users expect from a native Ionic app.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tab content appears fully formed on switch (Priority: P1)

A user taps a different bottom tab. The destination screen appears already
complete: its header (title, search field, and any top action buttons), its
section structure, and its data are all present at the same time. The user never
sees a partially built screen that then fills in.

**Why this priority**: This is the core complaint. Visible progressive
rendering on every navigation is the single biggest contributor to the "not
native" feeling, and it affects every user on every tab switch.

**Independent Test**: Switch between each pair of tabs repeatedly and capture
frames during the transition. Every captured frame of the destination tab shows
either the previous tab or the fully-formed destination tab — never an
intermediate state missing the search bar, action buttons, filter chips, or
list content.

**Acceptance Scenarios**:

1. **Given** the user is on any tab, **When** they tap another tab, **Then**
   the destination screen's header (title, search field, and top action buttons)
   is fully present from the first painted frame of that screen.
2. **Given** the user switches to the Chats tab, **When** the screen appears,
   **Then** the filter chips (All / Unread / Favorites / Groups) and the chat
   list are visible together with the header, with no intermediate frame that
   shows only the title.
3. **Given** the user returns to a tab they have already visited this session,
   **When** the tab appears, **Then** it restores its previous content and
   scroll position without re-showing empty or placeholder states.

---

### User Story 2 - No layout shift as a screen settles (Priority: P2)

When a tab screen appears, elements do not jump, reflow, or shift position after
the first paint. The search bar, headings, and list rows occupy their final
positions immediately.

**Why this priority**: Even when content loads quickly, elements appearing in
sequence (e.g., a search bar pushing the list down a moment later) reads as
janky. Eliminating layout shift is what makes the transition feel "settled".

**Independent Test**: Record a tab switch and confirm that no on-screen element
changes position between the first painted frame of the destination screen and
the steady state.

**Acceptance Scenarios**:

1. **Given** a tab is appearing, **When** its header and list render, **Then**
   no element that is present in the first frame moves to a different position in
   a later frame.
2. **Given** a tab whose data is still loading, **When** the screen appears,
   **Then** the space for the eventual content is reserved so its arrival does
   not push other elements.

---

### User Story 3 - Identity-bearing screens show the real user immediately (Priority: P2)

When the Settings screen appears, it shows the user's actual profile photo and
name rather than a generic placeholder that is then replaced.

**Why this priority**: Showing "You" with a placeholder avatar and then swapping
in the real photo and "Kamran" is a jarring, identity-level flicker that
undermines confidence in the app. It is highly visible because the profile sits
at the top center of the screen.

**Independent Test**: Open Settings from any other tab and capture frames; the
real avatar and display name are present in the first painted frame of the
Settings screen, with no placeholder-then-real swap.

**Acceptance Scenarios**:

1. **Given** the user has a profile photo and name set, **When** they open the
   Settings tab, **Then** the real photo and name appear immediately with no
   "You"/placeholder intermediate state.
2. **Given** any tab that displays the user's own avatar or name, **When** it
   appears, **Then** the real identity is shown from the first frame.

---

### Edge Cases

- **First visit to a tab in a session**: the very first time a tab is opened
  (before any caching warms up), the transition must still avoid showing a
  visibly incomplete screen; if data genuinely cannot be ready instantly, a
  stable, intentional loading presentation is acceptable as long as it does not
  read as broken or shift layout when content arrives.
- **Genuinely empty data**: a tab with no data (e.g., "No calls found", "No
  contacts found") must show its empty state only when the absence of data is
  confirmed — not as a flash that precedes real data appearing.
- **Slow data load**: when underlying data takes longer than usual to become
  available, the screen must not oscillate between empty, placeholder, and
  populated states.
- **Rapid tab switching**: quickly tapping between tabs must not surface
  half-built screens or leave a tab stuck in a placeholder state.
- **Returning after backgrounding**: returning to the app and switching tabs
  should not regress to the placeholder-then-real behavior.
- **Right-to-left / long content**: screens containing RTL text or long names
  (visible in the Chats list) must still appear fully formed without reflow.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Switching between bottom tabs MUST present the destination screen
  as a single, complete view; the user MUST NOT see an intermediate frame in
  which the destination screen's header, search field, action buttons, filter
  chips, or list content are missing.
- **FR-002**: Each tab's full header — title, search field, and all top action
  buttons — MUST be present from the first painted frame of that screen.
- **FR-003**: Once a tab has been visited in a session, returning to it MUST
  restore its rendered content and scroll position without re-displaying empty
  or placeholder states.
- **FR-004**: Screens MUST NOT exhibit layout shift after first paint; elements
  present in the first frame MUST remain in their final positions.
- **FR-005**: The Settings screen (and any screen showing the user's own avatar
  or name) MUST display the user's real profile photo and name from the first
  painted frame, with no placeholder-then-real swap.
- **FR-006**: Empty states ("No calls found", "No contacts found", empty Chats)
  MUST be shown only when the absence of data is confirmed, never as a flash
  that precedes real content.
- **FR-007**: Rapid or repeated tab switching MUST NOT produce half-rendered
  screens or leave any tab stuck in a placeholder/partial state.
- **FR-008**: The smoothness improvement MUST apply to all four bottom tabs
  (Calls, Chats, Contacts, Settings) consistently.
- **FR-009**: The transition behavior MUST remain correct and visually stable
  across the app's supported themes (the captured frames are in dark mode) and
  for both left-to-right and right-to-left content.
- **FR-010**: When data genuinely cannot be ready at the moment a tab is first
  opened, the screen MUST present a single intentional loading state that does
  not shift layout when real content arrives, rather than a sequence of
  empty/placeholder/populated frames.

### Key Entities

*(Not applicable — this feature changes presentation/navigation behavior, not
the data model.)*

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire**: Nothing new. This is a client-side
  presentation/navigation change; the server is not touched and no new request,
  field, log line, or metric is added.
- **What is encrypted**: Unchanged. Profile name/avatar and the chat/call/contact
  data remain encrypted-at-rest (AEAD-wrapped under the PIN-derived key) and are
  only ever decrypted client-side through the existing `getSecret`/query paths.
- **The one sensitive decision**: To make a tab (especially Settings) appear fully
  formed on first paint, decrypted profile/list values are held in an **in-memory**
  warm cache for the duration of the unlocked session. This plaintext lives only in
  memory and is **cleared when the keystore locks**. It is **never** persisted in
  the clear. A cleartext-at-rest cache was explicitly rejected as a zero-knowledge
  violation.
- **Metadata unavoidably visible to the server**: Unchanged from today (none added).

### Zero-Knowledge Requirements

- **FR-ZK-1**: Warm-cache plaintext (own-profile name/avatar, chat/call/contact
  lists) MUST exist only in process memory. It MUST NOT be written to any clear
  (non-AEAD-wrapped) medium — IndexedDB, `localStorage`, `sessionStorage`,
  service-worker / Cache Storage, or any serialized form. "Clear storage" here
  means any persistence reachable after a page reload or by another origin context.
- **FR-ZK-2**: The warm cache MUST be cleared on **every** transition that ends the
  unlocked session — keystore lock, sign-out, and account removal — leaving no
  decrypted residue reachable in memory (all warm refs reset to their cold initial
  values: lists `[]`/`loaded=false`, profile name→username/"You", avatar→initials,
  `warmed=false`).
- **FR-ZK-3**: Clearing MUST be objectively verifiable: after a lock/sign-out, an
  inspection of the warm refs shows cold initial values, and an inspection of clear
  storage after exercising all tabs reveals no profile/list plaintext.
- **FR-ZK-4**: If unlock fails or is aborted, warming MUST NOT run and no partial
  plaintext may be cached. If a `getSecret`/list decryption fails mid-warm, the
  affected store MUST stay cold (its cold fallback) rather than caching a partial or
  fallback value as though it were real data.
- **FR-ZK-5**: While the keystore is locked, every own-identity surface MUST show
  the non-identifying fallback (username/"You" + initials avatar), never decrypted
  content from a prior session.
- **FR-ZK-6**: The in-memory warm guarantee (FR-ZK-1, FR-ZK-2) applies to **all**
  consumers of own-profile (Settings plus call tiles, group member lists, reply
  quotes, media captions), not only the Settings tab.
- **FR-ZK-7**: This feature MUST NOT weaken the existing AEAD-at-rest wrapping of
  secrets; it only adds an in-memory read cache layered on the unchanged
  `getSecret` decryption path.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In frame-by-frame capture of any tab-to-tab switch, 100% of frames
  show either the source tab or the fully-formed destination tab — zero frames
  show a destination screen missing its search bar, action buttons, filter
  chips, or list content.
- **SC-002**: Across all four tabs, there is no measurable layout shift after a
  screen's first paint (no element changes position between first paint and
  steady state).
- **SC-003**: The Settings screen never shows the generic "You"/placeholder
  avatar-and-name when a real profile exists; the real identity is present in the
  first painted frame in 100% of openings.
- **SC-004**: A previously-visited tab restores its content and scroll position
  on return without re-rendering empty/placeholder states in 100% of returns
  within a session.
- **SC-006**: After locking or signing out, inspection of the warm cache shows all
  refs reset to their cold initial values, and inspection of clear storage after
  exercising every tab reveals zero profile/list plaintext (FR-ZK-2, FR-ZK-3).
- **SC-005**: A before/after review (the `quickstart.md` frame-capture walkthrough)
  confirms, for every tab-to-tab switch, that none of the partial-frame symptoms
  catalogued in the Overview reproduce (title-only header, missing search/buttons/
  chips, empty-state flash, placeholder identity), and the reviewer signs off that
  the result reads as "native / instant" rather than "fills in / janky". This is the
  holistic acceptance gate over the objective per-criterion checks (SC-001–SC-004).

## Assumptions

- The visual flicker shown in the captured frames is caused by destination tab
  screens rendering progressively after navigation (header and action controls,
  list data, and own-profile identity arriving in separate paints), not by an
  intentional design choice.
- "Native feeling" is defined as the destination screen appearing complete and
  stable in a single step, consistent with standard Ionic tab navigation
  expectations.
- Restoring a previously-visited tab's exact content and scroll position within
  the same session is desirable and in scope.
- The underlying data sources (local conversation, calls, contacts, and profile
  data) can be made available quickly enough that, for already-visited tabs,
  content is effectively instant; first-visit timing is handled per FR-010.
- No change to the zero-knowledge boundary, data model, or server behavior is
  required; this is a client-side presentation/navigation concern.
- The four-tab structure and the existing per-tab feature set (search, filters,
  action buttons, directory/invite rows) remain unchanged; only the smoothness
  of their appearance changes.
- The warm cache is a module-level singleton scoped to a single document/JS context.
  Multiple PWA tabs/windows each have their own isolated heap, so warm plaintext is
  not shared across browsing contexts; no cross-context sharing is introduced.
