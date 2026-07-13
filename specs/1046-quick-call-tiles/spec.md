# Feature Specification: Quick Call tiles on the Calls tab, usage totals move to Network usage

**Feature Branch**: `feat/1046-quick-call-tiles`

**Created**: 2026-07-13

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Move the rest of the Calls-tab Totals into Settings → Storage and data → Network usage, and — like pinning chats in the Chats view — let users add Quick Call entries to the Calls tab: an audio or video call to someone, or an audio/video group call. Tapping one starts the call immediately with the entry's preferred method; the method is user-modifiable and limit-aware (group video max 4, audio max 8, counting yourself)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One tap to call the people I always call (Priority: P1)

I call the same few people and groups all the time. I want them at the top of
the Calls tab as Quick Call entries — my partner as a video call, my dad as an
audio call, the family group as a group audio call — so one tap rings them
immediately, without opening a contact page and choosing a call type each time.

**Why this priority**: This is the headline ask — the calling equivalent of
pinned chats. Everything else in this spec supports or decorates it.

**Independent Test**: Add a quick call for a contact, tap it, and confirm the
call starts ringing immediately with the chosen method.

**Acceptance Scenarios**:

1. **Given** a quick-call entry for contact Anna with method video, **When** I
   tap it, **Then** a video call to Anna starts ringing immediately (no
   intermediate screen).
2. **Given** a quick-call entry for the "Family" group with method audio,
   **When** I tap it, **Then** a group audio call rings the group's members.
3. **Given** I am already in a call, **When** I tap a quick-call entry, **Then**
   I get the existing "You're already in a call" notice and nothing else happens.
4. **Given** quick-call entries exist, **Then** each shows who it calls and its
   method (audio or video) at a glance.

---

### User Story 2 - Add, re-method, and remove Quick Calls (Priority: P1)

I manage the entries myself: add one by picking a contact or a group, switch
an entry between audio and video later, and remove entries I no longer use.
The app never lets me configure a call that can't happen: group video calls
hold at most 4 people and group audio calls at most 8 (counting me), so a
5-person group can't be a video quick call and a 9-person group can't be a
quick call at all.

**Why this priority**: Without management the tiles are static decoration; the
limit-awareness is what makes one-tap calling trustworthy (a tap must never
fail with "call full" for a call I myself configured).

**Independent Test**: Add entries for a contact, a 4-person group, a 5-person
group, and verify the method choices offered match the caps; switch a method;
remove an entry.

**Acceptance Scenarios**:

1. **Given** the Calls tab, **When** I choose to add a quick call and pick a
   contact, **Then** I choose audio or video and the entry appears.
2. **Given** I pick a group whose call size (members + me) is within 4,
   **Then** both audio and video are offered.
3. **Given** I pick a group whose call size is 5–8, **Then** only audio is
   offered, with a note that video calls hold at most 4 people.
4. **Given** a group whose call size exceeds 8, **Then** it cannot be added as
   a quick call, and the reason (audio calls hold at most 8 people) is shown.
5. **Given** an existing audio entry for a 5-person group, **When** I try to
   switch it to video, **Then** the switch is blocked with the video-limit
   reason; for a 3-person group the switch succeeds.
6. **Given** an entry I remove, **Then** it disappears from the Calls tab (the
   contact/group itself is unaffected).
7. **Given** my other signed-in device, **Then** it shows the same quick-call
   entries after sync.

---

### User Story 3 - Call statistics live with the other usage numbers (Priority: P2)

The "Totals" block (audio minutes + data, video minutes + data, combined data)
currently sits at the top of the Calls tab. I want those numbers in Settings →
Storage and data → Network usage, together with the message/media/call stats
already there — and the Calls tab freed up for the Quick Calls that earn the
prime spot.

**Why this priority**: Valuable cleanup that motivated this feature, but it
doesn't gate the quick-call flows.

**Independent Test**: Make an audio and a video call; open Network usage and
see per-kind minutes and data; confirm the Calls tab no longer shows Totals.

**Acceptance Scenarios**:

1. **Given** past audio and video calls, **When** I open Settings → Storage
   and data → Network usage, **Then** I see audio calls (minutes + data) and
   video calls (minutes + data) alongside the existing calls count, total call
   time, and combined call data.
2. **Given** the Calls tab, **Then** no Totals section renders; the page goes
   straight to Quick Calls (if any) and Recent.
3. **Given** the existing "Reset statistics" action, **When** I reset, **Then**
   the per-kind call rows reset with the rest (they follow the same
   reset point).

---

### Edge Cases

- A quick-call target that no longer exists (deleted contact, left/deleted
  group) or a ghosted (terminated) contact: the entry shows as unavailable and
  tapping offers to remove it instead of ringing; it never crashes or rings a
  void.
- A group that GROWS after an entry was added (e.g. video entry for 4, group
  becomes 6): the tap re-checks the cap at call time and explains why the call
  can't start as video, offering to switch the entry to audio (if within 8).
- A group that grows past 8 with an audio entry: the tap explains the limit and
  offers removal.
- Sync brings an entry whose target this device doesn't know (yet): it renders
  from the target's stored name/avatar once known; until then it is hidden
  rather than broken.
- Duplicate protection: the same target can appear only once; adding it again
  updates the method instead of creating a twin.
- Hidden chats must stay hidden: a hidden 1:1 conversation's existence is never
  revealed by this feature (quick calls target CONTACTS, not chats, so no
  hidden-chat linkage is shown; calling a contact with a hidden chat behaves
  exactly like calling them from their contact page today).
- The block/ghost rules hold: a blocked contact's quick call is unavailable
  (same reason surface as the contact page).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to add Quick Call entries to the Calls tab
  for (a) a contact or (b) a group they are a member of.
- **FR-002**: Each entry MUST carry a preferred method — audio or video — shown
  on the entry, and tapping the entry MUST immediately start that call (person
  call or group call) with that method, subject to the existing
  already-in-a-call guard.
- **FR-003**: The method MUST be user-modifiable per entry (audio ↔ video)
  after creation.
- **FR-004**: Method choices MUST be limit-aware everywhere (add, switch, and
  at tap time): a group call counts its members plus the user, video allows at
  most 4 such participants, audio at most 8. Options beyond the target's size
  MUST be blocked with the existing kind-specific reason copy; a group beyond 8
  MUST NOT be addable at all.
- **FR-005**: Entries MUST be removable, and a target that becomes invalid
  (deleted/ghosted/blocked contact, deleted/left group, group grown past its
  cap) MUST degrade gracefully at render and at tap time — explain and offer
  fix/removal, never a dead ring or crash.
- **FR-006**: The quick-call list MUST sync across the user's devices like
  other organisation preferences (encrypted, last-write-wins), and MUST never
  reach the server in plaintext.
- **FR-007**: The same target MUST appear at most once; re-adding updates the
  method.
- **FR-008**: The per-kind call statistics (audio minutes + data, video
  minutes + data) MUST appear in Settings → Storage and data → Network usage
  alongside the existing counters, honouring the same "Reset statistics" point.
- **FR-009**: The Totals section MUST be removed from the Calls tab.
- **FR-010**: Existing Calls-tab behaviour (Recent list, search, swipe delete,
  missed-badge clearing, New call / New group call buttons) MUST keep working
  unchanged.

### Key Entities

- **Quick Call entry**: target (one contact OR one group) + preferred method
  (audio | video). User-ordered set on the Calls tab; synced encrypted;
  removing one never touches the underlying contact/group.
- **Per-kind call statistics**: audio/video minutes and bytes derived from the
  on-device call log since the user's reset point; read-only display data.

## Zero-Knowledge Impact *(constitution I)*

- **What crosses the wire**: nothing new. Quick-call entries ride the existing
  encrypted own-data settings sync (sealed client-side); starting a call uses
  the existing sealed call-signalling paths unchanged.
- **What is encrypted**: the entry list (targets + methods) inside the synced
  snapshot; the server sees only the same opaque blob it already stores.
- **Unavoidably visible metadata**: unchanged — call setup reveals the same
  relay metadata any call does today; statistics are computed and displayed
  on-device only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Calling a favourite person takes one tap from the Calls tab
  (down from ≥3 interactions today: open contact/new-call picker → pick →
  choose kind).
- **SC-002**: 100% of quick-call taps either start the configured call or
  explain precisely why not (busy, limit, invalid target) — never a silent
  failure or an after-the-fact "call full".
- **SC-003**: It is impossible to configure a quick call that violates the
  4-video/8-audio participant caps, at add time, at switch time, and at tap
  time.
- **SC-004**: Quick-call entries appear on a second signed-in device after its
  next sync.
- **SC-005**: All call usage figures previously on the Calls tab are visible in
  Network usage, and the Calls tab renders none of them.

## Assumptions

- Quick Calls render as a compact tile row/grid above "Recent" (visually akin
  to the pinned-chat avatars), each showing avatar, name, and a method glyph;
  an add affordance lives with them. Exact layout is a plan/design decision.
- Entry management (switch method, remove) hangs off the entry itself (e.g. a
  long-press/context surface), mirroring how pinned chats are managed; drag
  reordering of quick calls is NOT in scope for v1 — entries keep insertion
  order.
- Group quick calls target existing groups; ad-hoc multi-contact quick calls
  (the New group call picker flow) are out of scope for v1.
- The participant caps are the existing product caps (video 4 / audio 8,
  counting self); this spec adds no new limits and changes none.
- The Calls tab keeps its "New call" and "New group call" toolbar buttons;
  Quick Calls complement, not replace, them.
- Statistics figures reuse the definitions already shown today (minutes
  rounded as on the Calls tab; bytes as stored per call), so numbers match
  what users saw before the move.
