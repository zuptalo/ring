# Feature Specification: Message and Post Audience Insight

**Feature Branch**: `feat/1065-message-and-post`

**Created**: 2026-07-30

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Message status report per user so you can see exactly when a message was delivered to each group member and when it was seen by each group member, designed to work with large groups. The same possibility for wall posts, so as a post owner I can see how many have already seen my post and see who has reacted to my post and when, with smart UI/UX since posts can get a lot of views and reactions. Post view count is author-only. The seen timestamp for a post is the first time a person saw it. The owner can see who reacted, with what, and when. People can also reply to and react to a comment on a post."

## Overview

Ring already knows far more about who received what than it ever shows you.

Group messages carry a per-member roster of delivered and seen moments (spec
1010), but the message-info screen renders only names in three buckets. The
*when* is recorded and then thrown away at the last step. Wall posts already
record one row per viewer with the moment they saw it, but the client discards
that moment, shows a single run-on line of names, and never shows a count. Post
reactions know who reacted and when, yet render as an anonymous tally.

This feature turns all of that recorded-but-hidden detail into one consistent,
volume-aware surface: **a single audience view** that leads with a count, then
lists people with avatars and times, and stays fast whether a group has 6
members or 60 and whether a post has 3 viewers or 300. The same surface serves
group message receipts, post viewers, and post reactions, so the app teaches
the pattern once.

It also finishes the conversation half of a post. Comments today are a flat
list you can only add to. This feature lets you **reply to a specific comment**
and **react to a comment**, so a busy post reads as threads rather than a wall
of unrelated lines.

Two boundaries shape every decision:

- **Zero-knowledge.** The server may not learn a reaction emoji, a comment
  body, or which comment a reply or reaction belongs to. Every new field rides
  inside the sealed engagement payload unless there is a stated reason it
  cannot, and any such reason is an explicit, argued exception.
- **Author-only reach.** A post's view count and viewer list belong to the
  author alone. Nobody else learns how far a post travelled, not even the
  people in the audience.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See exactly when each group member got it and saw it (Priority: P1)

Kamran sends a message to a group of twelve. The bubble shows the progress
counter he already knows ("Delivered 9/12", later "Seen 7/12"). He opens
message info and, instead of three run-on lines of names, sees three tappable
rows with a count and a few faces each. He taps "Seen by 7" and gets a list of
seven people, each with their avatar, their name, and the moment they saw it.
He taps "Delivered" and sees each member with the moment it reached their
device. "Not yet delivered" lists the rest with no time, because there is
nothing to time yet.

**Why this priority**: This is the original request and the smallest complete
slice. Every piece of data it needs is already stored on the device today, so
it delivers the headline value with no new wire format and no server change.

**Independent Test**: Send a message to a group, have members receive and open
it at staggered times, then open message info and confirm each member's row
carries the correct moment and each tier opens on its own.

**Acceptance Scenarios**:

1. **Given** an outgoing group message that three of five members have seen and
   one more has merely received, **When** the author opens message info,
   **Then** they see a "Seen by 3" row, a "Delivered 1" row, and a "Not yet
   delivered 1" row, each showing a count and a capped preview of faces.
2. **Given** that same message, **When** the author opens the "Seen by" row,
   **Then** each of the three members is listed with avatar, name, and the
   moment they saw it, ordered most recent first.
3. **Given** a member who received the message but has not opened it, **When**
   the author opens the "Delivered" row, **Then** that member's row shows the
   moment of delivery and no seen moment.
4. **Given** a member with no delivery yet, **When** the author opens "Not yet
   delivered", **Then** that member is listed with no time and a plain note
   rather than a blank space.
5. **Given** the author has turned Seen receipts off, **When** they open message
   info, **Then** no seen tier and no seen moments appear anywhere, and members
   who have seen it appear only as delivered.
6. **Given** a group of 60 members, **When** the author opens any tier, **Then**
   the list opens promptly and scrolls without stutter.

---

### User Story 2 - See how many people have seen your post (Priority: P1)

Kamran posts to his wall. Over the next hour people scroll past it in their
feed and some open it. On his own copy of the post he sees a quiet "Seen by 14"
line that only he can see. He taps it and gets the fourteen people with their
avatars and the moment each of them first saw it. Someone who scrolled past the
post six times still appears once, stamped with the first time, not the latest.

**Why this priority**: The second half of the original request, and the half
with the biggest gap between what is stored and what is shown. It is
independently valuable and independently shippable.

**Independent Test**: Post to an audience of several accounts, have some open
the post and others merely scroll it into view in the feed, then confirm the
author's count and list match, that non-authors see nothing, and that a repeat
viewer keeps their original time.

**Acceptance Scenarios**:

1. **Given** a post the author has published, **When** members of the audience
   see it in their feed or open it, **Then** the author's copy shows a seen
   count that grows to match.
2. **Given** a post with viewers, **When** anyone other than the author views
   that post, **Then** no count, no viewer list, and no hint that either exists
   is shown to them.
3. **Given** a person who has already been counted as a viewer, **When** they
   see or open the post again later, **Then** their recorded moment stays the
   first one and the count does not change.
4. **Given** a post with viewers, **When** the author opens the seen count,
   **Then** each viewer is listed with avatar, name, and the moment they first
   saw it, ordered most recent first.
5. **Given** a viewer who has Seen receipts turned off, **When** they see the
   post, **Then** they are not counted and do not appear in the list, and the
   author's screen does not present the count as total reach.
6. **Given** someone scrolling the feed quickly, **When** a post passes without
   half of it resting on screen for a second, **Then** it is not counted, and
   **When** they slow down and it does, **Then** it is.
7. **Given** a post with 300 viewers, **When** the author opens the list,
   **Then** it opens promptly, shows the first screenful immediately, and loads
   the rest as they scroll.
8. **Given** a post nobody has seen, **When** the author looks at it, **Then**
   they see a plain "No one yet" rather than an empty or missing row.

---

### User Story 3 - See who reacted to your post, with what, and when (Priority: P2)

A post picks up a dozen reactions. Everyone in the audience sees the familiar
emoji pills with counts. The author additionally can open them and see the
people behind the tally: each person with their avatar, the emoji they chose,
and when they chose it, grouped so the most-used emoji reads first.

**Why this priority**: High value, and the data already exists per person with a
timestamp. It ranks below story 2 because the aggregate pills already deliver
most of the social signal, while nothing at all tells you whether a post was
seen.

**Independent Test**: React to a post from several accounts with different
emoji, then confirm the author can open an attributed list showing person,
emoji, and time, and that non-authors still see only the aggregate pills.

**Acceptance Scenarios**:

1. **Given** a post with reactions from several people, **When** the author taps
   the reaction pills, **Then** they see each person with avatar, name, emoji,
   and the moment they reacted.
2. **Given** the same post, **When** a non-author taps the reaction pills,
   **Then** the existing toggle behaviour applies and no attributed list opens.
3. **Given** someone who changes their emoji, **When** the author opens the
   list, **Then** that person appears once with their current emoji and the
   moment of the change, not twice.
4. **Given** someone who removes their reaction, **When** the author opens the
   list, **Then** that person is gone from the list and the count reflects it.
5. **Given** a post with more than 100 reactions, **When** the author opens the
   list, **Then** it opens promptly and loads further rows as they scroll.

---

### User Story 4 - Reply to a comment on a post (Priority: P2)

A post has a busy comment section where two separate conversations have got
tangled. Someone taps reply on a specific comment and answers it directly.
Their reply appears attached to that comment, nested under it, so the thread
reads as a conversation rather than a stream.

**Why this priority**: A structural improvement to an existing feature rather
than a new insight surface, and it is the part that most changes the stored
shape of a comment, so it follows the read-only stories.

**Independent Test**: Comment on a post from two accounts, reply to one of the
comments from a third, and confirm the reply renders attached to its parent for
every member of the audience, including someone who loads the post fresh.

**Acceptance Scenarios**:

1. **Given** a post with comments, **When** a member of the audience taps reply
   on a comment and sends, **Then** their reply appears attached to that comment
   for them and for everyone else in the audience.
2. **Given** a comment with several replies, **When** anyone opens the post,
   **Then** the replies appear under their parent in the order they were sent,
   not scattered through the top-level list.
3. **Given** a comment with many replies, **When** anyone opens the post,
   **Then** a bounded number of replies show with a plain way to reveal the
   rest, so one loud thread cannot bury the others.
4. **Given** someone replying to a reply, **When** they send it, **Then** it
   joins the same thread at the same indent under the top-level comment and
   names the person it answers, rather than indenting a further step.
5. **Given** a parent comment that its author deletes, **When** anyone views the
   post, **Then** the replies remain readable under a plain "This comment was
   deleted" placeholder rather than vanishing or detaching.
6. **Given** a reply arriving while its parent has not yet synced, **When** the
   client renders the post, **Then** the reply is held and attaches once the
   parent arrives rather than rendering as an orphan or being lost.

---

### User Story 5 - React to a comment on a post (Priority: P3)

Someone leaves a comment that deserves a quick thumbs up rather than a reply.
Any member of the audience can react to that individual comment, and the
comment shows its own small tally.

**Why this priority**: The lightest addition, valuable but not required for any
other story to make sense. It reuses whatever targeting mechanism story 4
establishes, so it is cheap once that lands.

**Independent Test**: React to a specific comment from two accounts and confirm
the tally appears on that comment only, for every member of the audience, and
that re-tapping removes your own reaction.

**Acceptance Scenarios**:

1. **Given** a post with comments, **When** a member of the audience reacts to
   one comment, **Then** a tally appears on that comment for everyone in the
   audience and no other comment changes.
2. **Given** a comment you have already reacted to, **When** you tap the same
   emoji again, **Then** your reaction is removed and the tally drops.
3. **Given** a comment that is deleted, **When** anyone views the post,
   **Then** its reactions are gone along with it.
4. **Given** the post author, **When** they open a comment's tally, **Then**
   they see who reacted, with what, and when, matching the post-level behaviour
   in story 3.

---

### Edge Cases

- **A member joins the group after the message was sent.** They are not part of
  that message's roster, so they appear in no tier and are not counted in the
  denominator. The counter's total stays the roster at send time.
- **A member leaves the group before seeing the message.** Their row stays in
  its tier so the counts still add up, marked plainly as no longer in the group.
- **Someone's clock is wrong.** A reported moment that lands in the future or
  implausibly far in the past must not be shown verbatim. Ring already learned
  this the hard way with sender-clock skew in message ordering, so any
  person-reported moment is sanity-checked against the neutral moment the server
  recorded, and the neutral one wins when the two disagree beyond a tolerance.
- **The same person views a post on two devices.** They are counted once and
  keep the earliest moment across all of their devices.
- **A viewer is removed from the audience later.** They stay in the author's
  viewer list with their original moment, because they genuinely did see it.
- **A post is seen while offline.** The view is recorded when the device next
  reaches the server, and the stored moment is when they actually saw it, not
  when it synced.
- **Someone scrolls the feed at speed.** A post that flicks past without being
  meaningfully on screen must not count as seen. See FR-014.
- **Any tier or list is empty.** Each shows a plain, warm empty line rather than
  a blank row or a hidden section.
- **A reply targets a comment the viewer cannot read.** The reply is not shown
  rather than shown detached.
- **A comment is deleted while someone is typing a reply to it.** The reply
  still sends and attaches to the deleted-comment placeholder.
- **A reply or reaction arrives for a comment that was already deleted.** It is
  accepted and dropped on render rather than causing an error.

## Requirements *(mandatory)*

### Functional Requirements

#### The shared audience view

- **FR-001**: The app MUST present audience detail through one consistent
  surface used by group message receipts, post viewers, post reactions, and
  comment reactions, so the interaction is learned once.
- **FR-002**: That surface MUST lead with a count and a small capped preview of
  faces, and open into a full list only on demand.
- **FR-003**: Each row in the full list MUST show the person's avatar, the name
  the viewer knows them by, and the relevant moment, plus the emoji where the
  list is about reactions.
- **FR-004**: Lists MUST render only a bounded first window and extend as the
  person scrolls, so a list of hundreds opens as fast as a list of five.
- **FR-005**: Lists MUST be ordered most recent first, with a stable tiebreak so
  identical moments never reorder between openings.
- **FR-006**: Every list MUST have a plain empty state rather than a blank or
  absent section.

#### Group message receipts

- **FR-007**: Each member row in a group message's Seen by and Delivered tiers
  MUST show the moment that member saw or received the message.
- **FR-008**: Members with no delivery yet MUST be listed without a moment and
  labelled plainly, not shown with a blank or a made-up time.
- **FR-009**: Each tier MUST open into the full member list of that tier.
- **FR-010**: When the viewer has Seen receipts turned off, seen moments and the
  seen tier MUST stay fully suppressed, preserving the existing reciprocity.
- **FR-011**: Members who have left the group MUST still appear in their tier,
  marked as no longer in the group, so the counts stay truthful.

#### Post views

- **FR-012**: A post's view count and viewer list MUST be visible to the post
  author only, on every surface, with no indication to others that either
  exists.
- **FR-013**: A person's recorded view moment MUST be the first moment they saw
  the post, across all of their devices, and MUST never be overwritten by a
  later view.
- **FR-014**: A post MUST be counted as seen when at least half of it has been
  on screen in the feed for a continuous second, and immediately when its detail
  page is opened. A post that scrolls past faster than that MUST NOT be counted.
- **FR-015**: View reporting MUST stay gated on the existing reciprocal Seen
  receipts setting, so someone who does not share their own seen status is
  neither counted nor listed.
- **FR-016**: The author's screen MUST NOT present the count as total reach,
  because people with Seen receipts off are invisible to it. The wording must
  stay honest without being alarming.
- **FR-017**: The viewer list MUST show each viewer once, with their avatar,
  name, and first-seen moment.

#### Post and comment reaction attribution

- **FR-018**: The post author MUST be able to open a post's reactions and see
  who reacted, which emoji they used, and when.
- **FR-019**: Non-authors MUST continue to see only the aggregate pills, with
  today's tap-to-toggle behaviour unchanged.
- **FR-020**: Someone who changes their emoji MUST appear once, with their
  current emoji and the moment of that change.
- **FR-021**: Someone who removes their reaction MUST disappear from the list
  and from the count.
- **FR-022**: Attributed reaction lists MUST group by emoji, most-used first.

#### Comment replies and comment reactions

- **FR-023**: Any member of a post's audience MUST be able to reply to a
  specific comment, and the reply MUST render attached to that comment for
  everyone in the audience.
- **FR-024**: Any member of a post's audience MUST be able to react to a
  specific comment, and that comment MUST carry its own tally.
- **FR-025**: Replies MUST nest exactly one level. A reply to a reply joins the
  same thread under the same top-level comment rather than indenting further,
  and names the person it answers so the exchange stays followable.
- **FR-026**: A thread MUST show a bounded number of replies with a plain way to
  reveal the rest, so one long thread cannot bury the rest of the comments.
- **FR-027**: When a parent comment is deleted, its replies MUST stay readable
  beneath a placeholder rather than disappearing or detaching.
- **FR-028**: A reply or comment reaction that arrives before its parent MUST be
  held and attached when the parent arrives, never rendered detached and never
  silently dropped.
- **FR-029**: Deleting a comment MUST remove its reactions along with it.

#### Zero-knowledge and data minimisation

- **FR-030**: The server MUST NOT learn a reaction emoji, a comment body, or a
  reply body. This is unchanged from today and MUST survive every addition here.
- **FR-031**: The reference that ties a reply or a comment reaction to its
  parent comment MUST be sealed inside the encrypted payload. The server MUST
  NOT be able to tell a reply from a plain comment, tell which comment anything
  answers, or reconstruct the shape or size of any thread. This adds no new
  metadata to what the server already holds.
- **FR-031a**: Because the server cannot group a thread, the app MUST assemble
  threads on the device from a bounded, recency-ordered page of a post's
  engagement, and MUST be able to reach further back on demand when a reply's
  parent falls outside the loaded page, so a reply is never stranded merely
  because its parent is older than the window.
- **FR-032**: No new plaintext field may be added to what the server stores
  without being named and justified in this spec.
- **FR-033**: A post's viewer identities MUST stay readable only by the post
  author, enforced on the server and not merely hidden in the app.

#### Truthfulness and scale

- **FR-034**: Any moment reported by someone else's device MUST be
  sanity-checked against the neutral moment recorded when it reached the server,
  and the neutral moment MUST be used when the two disagree beyond a tolerance,
  so a wrong clock cannot show an impossible time.
- **FR-035**: Loading a post's engagement MUST be bounded rather than fetching
  every reaction, comment, and view a post has ever accumulated in one go.
- **FR-036**: The feed MUST NOT hold every engagement record for every post in
  memory at once in order to render its summaries.
- **FR-037**: All new counts, lists, and threads MUST work offline from what the
  device already holds, and reconcile when the device reconnects.

### Key Entities

- **Receipt roster entry**: For one outgoing group message and one member, the
  moment it reached them and the moment they saw it, plus whether they are still
  in the group. Already stored; this feature surfaces the moments.
- **Post view**: One person's first sighting of one post, with the moment,
  readable by the post author only. Already stored; this feature keeps the
  moment instead of discarding it and starts recording feed sightings.
- **Post reaction**: One person's current emoji on one post, with the moment
  they chose it. Already stored; this feature attributes it to the author.
- **Comment**: One person's text on one post, with the moment, and now
  optionally a reference to the comment it replies to.
- **Comment reaction**: One person's emoji on one comment, with the moment.
- **Audience summary**: The count and capped face preview that fronts any of the
  above before the full list is opened.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a group of 60, opening any receipt tier shows its first
  screenful within one second on a mid-range phone, and scrolling the full list
  holds a smooth frame rate.
- **SC-002**: Every member listed in a Seen by or Delivered tier shows a moment.
  A spot check of ten members across a staged run finds zero missing or
  obviously wrong times.
- **SC-003**: On a post seen by 300 people, the author's viewer list shows its
  first screenful within one second and never loads more than a screenful's
  worth of rows ahead of the scroll position.
- **SC-004**: Someone who sees the same post ten times over a week is counted
  once, and the shown moment equals the first sighting.
- **SC-005**: In a staged run with three non-author accounts, none of them can
  reach a post's view count or viewer list through the app or by requesting it
  directly.
- **SC-006**: A reply sent to a specific comment appears attached to that
  comment on every other audience device within five seconds on a normal
  connection.
- **SC-007**: Inspecting stored server data for a post with reactions, comments,
  replies, and comment reactions reveals no emoji, no comment text, and nothing
  beyond the metadata explicitly named and justified in this spec.
- **SC-008**: Opening a post with 200 comments and 500 reactions does not
  increase the app's memory use by more than it does for a post with 5 of each,
  beyond the bounded window actually rendered.
- **SC-009**: A device with a clock set two hours fast produces no visible
  future time anywhere in these lists.
- **SC-010**: Every list, tier, and thread has a written empty state, and a
  review of the feature's copy finds no em-dashes, no semicolons, and no
  internal jargon.

## Assumptions

- Spec 1010's per-member delivered and seen data is present, durable, and
  correct on the sender's device. This feature displays it and does not redesign
  how it is collected.
- Spec 0003's post view recording, the author-only viewer endpoint, and the
  reciprocal Seen receipts gate are the foundation for post views. This feature
  keeps that gate rather than adding a separate switch.
- Every member of a post's audience already holds the key needed to read that
  post's engagement, so a comment reply or comment reaction needs no new key
  exchange and no new key material.
- The moment the server recorded a piece of engagement is a trustworthy neutral
  reference, following the same reasoning that made a relay-side stamp the fix
  for sender-clock skew in message ordering.
- One-to-one message info already shows a status timeline with times and needs
  no change here. This feature's receipt work is group-only.
- Threads are assembled on the device, because the sealed parent reference
  (FR-031) deliberately denies the server any way to group them. "Bounded"
  therefore means a bounded page of a post's recent engagement, not a bounded
  page of one thread, and the app reaches further back on demand rather than
  asking the server for a thread.
- Existing per-person and per-post rate limits on engagement stay in force and
  cover comment replies and comment reactions without needing new limits.
- "Views" means a person, not a device. Two devices belonging to the same person
  are one view.
- Reaction attribution on posts is author-only for now, matching view
  visibility, even though the aggregate pills stay public. Widening it later is
  a deliberate, separate decision.
