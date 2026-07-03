# Feature Specification: Wall notifications go to the owner only

**Feature Branch**: `feat/1031-wall-notifications-only`

**Created**: 2026-07-03

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Feature Improvement: Wall Notification Logic — the notification
system generates notifications for users whenever there is activity on a wall post, even when the
activity is not directly related to them. Update the logic so users are only notified about
interactions with content they own: post owners are notified about reactions and comments on their
posts; comment owners about interactions with their comments; nobody is notified about activity on
other people's content; nobody is notified about their own actions; notifications are never
broadcast to everyone in a thread."

## Context: what Ring's Wall supports today

The Wall offers exactly two engagement interactions: **reacting to a post** (one emoji per person,
changeable) and **commenting on a post** (a flat list — there are no replies to comments, no
reactions on comments, no sharing/reposting, and no mentions on the Wall). View receipts exist but
are already visible only to the post owner and never notify.

Current notification behavior this spec changes:

- A **comment** today notifies **every member of the post's audience** (all friends / close
  friends who can see the post), not just the post owner. This is the noise being removed.
- A **reaction** today notifies **nobody** — not even the post owner. This is the gap being filled.

The parts of the original request that concern comment replies, comment reactions, shares, and
mentions describe interactions that do not exist on the Wall; they are recorded here as governing
rules for the future (see Assumptions), not as buildable behavior.

## Clarifications

### Session 2026-07-03

- Q: Should reaction alerts wake a closed app (web push), or only show while the app is open? →
  A: Push reactions too — reactions also wake a closed app; the device decrypts the engagement
  and suppresses the notification if it was a removal (or a change that shouldn't re-alert).
- Q: How should Settings control the new engagement (reaction/comment) alerts on your posts? →
  A: Separate activity toggle — keep the existing "New posts" Wall toggle, and add a new
  "Activity on your posts" toggle that governs comment + reaction alerts together.
- Q: Should per-person Wall mute/hide also silence alerts when that person engages with YOUR
  posts? → A: No, posts only — mute/hide keeps governing their new-post alerts; engagement with
  your own content still alerts you (it's your content).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stop notifying people about posts they don't own (Priority: P1)

I commented on a friend's post, or I'm simply in the audience of a busy post. Today my phone lights
up every time anyone else comments on it. After this change, activity on someone else's post is
quiet for me: I still see the new comments and reactions when I look at the Wall, but I'm never
alerted about them. Only the person who owns the post is alerted.

**Why this priority**: This is the reported problem — notification noise for activity that isn't
about you. Removing the audience-wide broadcast is the whole point of the feature and is valuable
on its own even if nothing else ships.

**Independent Test**: With three accounts (A owns a post; B and C in the audience), have B comment.
Verify A is notified and C is not — with C's app open (no banner) and closed (no system
notification). Deliverable value: bystanders stop getting pinged.

**Acceptance Scenarios**:

1. **Given** user A owns a post visible to B and C, **When** B comments on it, **Then** A receives
   a notification and C receives none (TC-02).
2. **Given** user A owns a post, **When** B and C each comment, **Then** A is notified about both
   comments, and B is never notified about C's comment (or vice versa) — commenting on a post does
   not subscribe you to its thread (TC-05 as applicable to flat comments, BR-3).
3. **Given** user A comments on user X's post, **When** other people engage with X's post, **Then**
   A receives no notifications for that activity (FR-4 "unrelated activity").
4. **Given** user C received no notification for B's comment, **When** C opens the Wall or the
   post, **Then** the comment is there — suppressing the notification never suppresses the content.

---

### User Story 2 - The post owner hears about reactions and comments on their post (Priority: P2)

I shared something on my Wall. When a friend reacts with an emoji or writes a comment, I get a
notification — whether the app is open (in-app banner) or closed (system notification). Nobody else
gets that notification, and I don't get one when I react to or comment on my own post.

**Why this priority**: Completes the "owner-only" model. Comments already reach the owner today
(along with everyone else); reactions currently reach nobody, so the owner is missing genuine
signals about their own content. Depends on nothing in User Story 1 but is less urgent than
stopping the noise.

**Independent Test**: A owns a post; B reacts. Verify A gets a notification naming no more than
what A is entitled to know (who engaged, on which post), B gets nothing, and a third account C gets
nothing — app open and app closed.

**Acceptance Scenarios**:

1. **Given** user A owns a post, **When** B reacts with 👍, **Then** A receives a notification and
   B and all other audience members receive none (TC-01).
2. **Given** user A owns a post, **When** B, C, and D react, **Then** A receives notifications for
   the reactions — grouped/coalesced where several arrive close together — and B, C, D receive
   none (TC-06).
3. **Given** B reacted to A's post, **When** B removes the reaction (or merely changes the emoji),
   **Then** A receives no notification for the removal, and at most one fresh notification if the
   emoji changed.
4. **Given** A's app is closed, **When** B comments on or reacts to A's post, **Then** A's device
   shows a system notification (governed by the "Activity on your posts" setting), and a
   reaction *removal* wakes the device but shows nothing.

---

### User Story 3 - Never notified about your own actions, and settings are respected (Priority: P3)

When I react to or comment on my own post, nothing pings anyone — least of all me. A dedicated
"Activity on your posts" setting lets me turn engagement alerts off without losing new-post
alerts. Muting or hiding someone on my Wall keeps silencing *their posts*, but if they engage
with *my* post I still hear about it — that's my content.

**Why this priority**: Mostly guard rails — self-action exclusion largely holds today and must be
preserved and proven by tests; the settings/mute semantics keep the new reaction/comment alerts
predictable alongside existing Wall controls.

**Independent Test**: A reacts to and comments on A's own post — verify zero notifications
anywhere. A turns "Activity on your posts" off; B comments — no alert, comment still visible.
A mutes B; B comments on A's post — A is still alerted.

**Acceptance Scenarios**:

1. **Given** user A owns a post, **When** A reacts to their own post, **Then** no notification is
   generated for anyone (TC-07).
2. **Given** user A owns a post, **When** A comments on their own post, **Then** no notification is
   generated for anyone (TC-08).
3. **Given** A has muted (or hidden) user B on the Wall, **When** B reacts to or comments on A's
   post, **Then** A is still notified — mute/hide governs B's *new-post* alerts only, not
   engagement with A's own content (per clarification).
4. **Given** A has turned the "Activity on your posts" setting off, **When** anyone engages with
   A's post, **Then** A receives no engagement notifications (content still syncs), while
   new-post alerts keep following the existing "New posts" setting.

---

### Edge Cases

- **Reaction removal / churn**: reactions are change-and-removable. Removing a reaction must never
  notify; rapidly changing emoji must not generate a stream of alerts (coalesce or dedupe per
  actor per post).
- **Stale engagement on reconnect**: after being offline, a batch of old engagement syncs in at
  once. Old activity must not flood the owner with banners on reconnect (mirror the recency guard
  used for new-post notifications).
- **Owner is looking at the post**: if the owner has the post (or the Wall) open in the foreground
  when engagement arrives, a banner for it is redundant; it may be suppressed.
- **Comment deleted**: a comment tombstone (deletion) must never generate a notification.
- **View receipts**: viewing a post is engagement in the data model but must never notify anyone.
- **Post expired or deleted before delivery**: a notification for engagement on a post that no
  longer exists on the device must be dropped, not shown as a dead-end alert.
- **Owner engages, then a stranger engages**: A commenting on A's own post must not suppress or
  alter the notification A gets when B later comments.

## Zero-Knowledge Impact *(constitution Principle I)*

- **What crosses the wire**: unchanged content — engagement payloads stay sealed under the
  post key; the server still never reads reactions, comments, or the reaction add/remove
  flag. What changes is *routing*: the engagement wake-up push narrows from "every audience
  member" to "the post's author only", and it may carry the post id so the owner's device
  knows which post's engagement to pull and judge.
- **What is encrypted**: everything it is today (engagement payloads under K_post; Web Push
  payloads are already encrypted to each device subscription, so even the push service sees
  nothing). No new plaintext is introduced.
- **Unavoidably visible metadata**: the server already knows the post id, its author, the
  engagement actor, and the unsealed engagement kind (reaction/comment/tombstone) — that is
  exactly the metadata used to route. Narrowing the fan-out *reduces* who receives wake-up
  metadata; it adds nothing the server doesn't already hold.
- **Why**: the alert decision requires knowing "is this my post" (server-routable via
  existing author metadata) and "is this reaction an add or a removal" (sealed — so that
  decision is made on the owner's device after decrypting, per FR-009).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The post owner MUST receive a notification when another user comments on their post.
- **FR-002**: The post owner MUST receive a notification when another user adds a reaction to
  their post. Reaction *removals* MUST NOT generate a notification, and emoji *changes* MUST
  produce at most one fresh notification.
- **FR-003**: No user other than the post owner may be notified about engagement (reactions,
  comments) on a post. In particular, being in the post's audience or having previously commented
  on the post MUST NOT cause notifications about other people's engagement — thread-wide
  broadcasts are removed entirely (BR-3).
- **FR-004**: Users MUST NOT receive notifications for their own actions: reacting to or
  commenting on their own post generates no notification for anyone (BR-4, TC-07, TC-08).
- **FR-005**: Suppressing a notification MUST NOT suppress the content: all audience members
  continue to see new comments and reactions on the post exactly as today; only who gets *alerted*
  changes.
- **FR-006**: Ownership determines notification routing: the post's author is the sole
  notification recipient for post-level engagement (BR-1). Should comment-level interactions
  (replies to comments, reactions on comments, mentions) ever be added to the Wall, the comment's
  author is the sole notification recipient for comment-level engagement (BR-2) — recorded here as
  a governing rule; building those interactions is out of scope.
- **FR-007**: Engagement notifications are governed by a new "Activity on your posts" setting
  (on by default), separate from the existing "New posts" Wall setting. The temporary Wall mute
  suppresses engagement alerts along with everything else on the Wall. Per-person mute/hide does
  NOT suppress engagement alerts on the owner's own posts — it continues to govern that person's
  new-post alerts only (per clarification).
- **FR-008**: Engagement notifications MUST be delivered both while the app is open (in-app
  banner) and while it is closed (system notification) — for comments AND reactions. Multiple
  engagements arriving close together MAY be grouped into one notification (TC-06).
- **FR-009**: The zero-knowledge boundary holds: the change must not require the server to learn
  anything about post or engagement content beyond the routing metadata it already handles.
  Because reaction adds and removals look identical to the server, a closed-app reaction push
  wakes the owner's device, which opens the sealed engagement locally and decides whether to show
  anything — removals and non-alerting changes show nothing (per clarification).
- **FR-010**: New-post notifications (a friend shares a new post → their audience is alerted) are
  unchanged; this spec governs engagement notifications only.
- **FR-011**: View receipts and comment deletions MUST NOT generate notifications for anyone.

### Key Entities

- **Post**: content a user shares on their Wall. Its *author* is the owner — the only person
  entitled to engagement notifications for it.
- **Engagement**: a reaction (one changeable emoji per person per post) or a comment (flat,
  append-only list) or a view receipt. Its *actor* is the person who performed it; the actor is
  never notified about their own engagement.
- **Notification**: a transient alert (in-app banner or system notification) telling the post
  owner someone engaged with their post. Distinct from the engagement data itself, which syncs to
  the whole audience regardless.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Audience members who don't own the post receive **zero** notifications for reactions
  and comments on it — verified across app-open and app-closed states in the acceptance tests
  (today every audience member is alerted for every comment).
- **SC-002**: For a post with N commenters plus the owner, a new comment produces exactly **one**
  notified user (the owner) instead of the entire audience — a per-comment notification fan-out
  reduction from "everyone who can see the post" to 1.
- **SC-003**: The post owner is alerted about a comment or reaction from another user within a few
  seconds when online, and on next wake via system notification when the app is closed.
- **SC-004**: Self-actions produce zero notifications in 100% of the acceptance scenarios.
- **SC-005**: All nine acceptance test cases from the feature request that apply to existing Wall
  interactions (TC-01, TC-02, TC-06, TC-07, TC-08, and the flat-comment readings of TC-05/TC-09)
  pass; none of the suppression cases regress content visibility.

## Assumptions

- **Comment-level interactions are out of scope.** Replies to comments, reactions on comments,
  sharing/reposting, and mentions on the Wall do not exist in Ring today (mentions exist only in
  chats/groups). The parts of the request that reference them (FR-2 scenarios, TC-03, TC-04, parts
  of TC-05/TC-09) are captured as the BR-2 governing rule in FR-006 and will apply if those
  interactions are ever built; this spec does not add them.
- **"Notification" means an alert** — an in-app banner while the app is open or a system
  notification while it is closed. It does not mean data sync: engagement continues to reach every
  audience member's device so the post renders correctly for everyone.
- **Reaction alerts are new.** Today reactions notify nobody, so FR-002 adds a capability rather
  than narrowing one. Per clarification, reactions alert the owner both in-app and via
  closed-app push, with the add/remove decision made on the device.
- **A new "Activity on your posts" setting governs engagement alerts** (comments + reactions
  together, on by default), alongside the existing "New posts" setting — per clarification.
- **Self-action exclusion largely holds today** (the actor is already excluded from live fan-out);
  the requirement is kept so the property is preserved and covered by tests rather than left
  incidental.
- **Per-person Wall mute/hide stays posts-only** — per clarification, muting or hiding someone
  silences their new-post alerts but does not silence alerts for their engagement with your own
  posts.
- **Zero-knowledge invariant is non-negotiable** (constitution): any routing narrowing happens on
  metadata the server already has (post id, actor, audience), and any content-dependent decision
  (e.g., reaction add vs. remove, which is sealed) happens on the recipient's device.
