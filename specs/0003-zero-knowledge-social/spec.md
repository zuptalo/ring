# Feature Specification: Zero-Knowledge Social Wall

**Feature Branch**: `feat/0003-zero-knowledge-social`

**Created**: 2026-06-20

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Bring a social 'Wall' into Ring: let people post status updates
(text, voice, video, or image) visible to their friends or a favorite-friends subset, with the
author in control of who can see each post. Viewers see the author's profile (avatar, name,
username), can react, and the author can see who reacted. People can request friendship in either
direction. Posts must stay private — the network's zero-knowledge guarantee holds."

## Overview

Ring is a private, end-to-end-encrypted messenger. This feature adds a **Wall**: a place to share
short status posts with people you are connected to, without weakening the zero-knowledge
guarantee. Two new capabilities underpin it: a real **friendship** relationship (mutual,
request-and-accept) replacing today's one-way "add a contact", and **posts** that the author shares
to a chosen audience of friends.

Crucially, there is **no public, server-readable feed**. Post content (text, voice, video, image)
is always end-to-end encrypted to its chosen audience. Strangers on the network can still find your
public profile and send you a friend request, but they can never see your posts unless you accept
them and include them in the audience.

Engagement is social and audience-visible: audience members can **react** and add **comments** that
the whole audience sees, and the author sees a **per-post view list**. Because a post's audience —
especially the close-friends subset — is known only to the author, engagement must reach everyone
without any engager learning who else is in the audience. The system delivers each reaction/comment
to the post's audience (the same recipient set the post was sent to) end-to-end encrypted, while the
engager only ever addresses "this post" — never a roster. Audience membership therefore stays
author-private while reactions and comments still appear for everyone.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a friends list with requests (Priority: P1)

A person finds someone on the network (by username/profile) and sends a **friend request**. The
other person sees an incoming request and can **accept** or **decline**. Either side can **cancel**
a still-pending outgoing request. Once accepted, the two are **friends** (mutual), which is the
basis for everything else on the Wall. Blocking someone removes/forbids the friendship.

**Why this priority**: Friendship is the foundation — without a mutual relationship there is no
audience to post to. It also delivers standalone value: a curated, consent-based connection model
that today's unilateral "add contact" lacks.

**Independent Test**: Two accounts; one sends a request, the other accepts; both now list each other
as friends. Decline, cancel, and block paths each reach the correct end state. Fully testable
without any posting feature.

**Acceptance Scenarios**:

1. **Given** Bob's public profile, **When** Alice sends a friend request, **Then** Bob sees a
   pending incoming request and Alice sees a pending outgoing request.
2. **Given** a pending incoming request, **When** Bob accepts, **Then** Alice and Bob are friends and
   both see the other in their friends list.
3. **Given** a pending incoming request, **When** Bob declines, **Then** the request disappears for
   both and neither becomes a friend; Alice is not told whether it was declined or merely unseen.
4. **Given** a pending outgoing request, **When** Alice cancels it, **Then** it disappears for both.
5. **Given** Alice and Bob are friends, **When** either blocks the other, **Then** the friendship
   ends and no new request can be sent while the block stands.
6. **Given** Bob already sent Alice a request, **When** Alice sends Bob a request, **Then** the two
   are reconciled into a single accepted friendship rather than two crossing requests.

---

### User Story 2 - Compose and share a post to friends (Priority: P1)

A friend opens a composer, creates a post that is **text, a voice clip, a video, or an image**,
chooses **who can see it** (all friends, or close friends only), chooses **how long it lasts**
(e.g. 24 hours, 7 days, or keep), and shares it. The post is delivered, end-to-end encrypted, only
to the chosen audience.

**Why this priority**: This is the headline value — sharing moments privately. Together with US1 and
US3 it forms the MVP.

**Independent Test**: With an existing friendship, the author posts each media type with an audience
and a lifetime; only audience members receive it; the server never holds readable content.

**Acceptance Scenarios**:

1. **Given** Alice has friends, **When** she posts text to "all friends", **Then** every current
   friend can see it and no one else can.
2. **Given** Alice posts an image/voice/video, **When** an audience member opens it, **Then** the
   media is fetched and decrypted on their device and plays/renders correctly.
3. **Given** Alice chooses "close friends", **When** she posts, **Then** only her close-friends
   subset receives it; other friends receive nothing and see no indication a post exists.
4. **Given** Alice sets a 24-hour lifetime, **When** 24 hours pass, **Then** the post disappears for
   both Alice and all viewers (lifetime/expiry per FR-012 and FR-023).
5. **Given** the device is offline, **When** Alice creates a post, **Then** it is queued locally and
   sent when connectivity returns (offline-first).

---

### User Story 3 - View friends' posts in a Wall feed (Priority: P1)

A person opens the Wall and sees recent posts from their friends, each labelled with the author's
**avatar, name, and username**, newest first, with media rendered inline. Tapping a post opens it
full-screen.

**Why this priority**: Posting has no value if no one can see it; viewing completes the MVP loop.

**Independent Test**: Given posts addressed to a viewer, the viewer's Wall lists exactly those posts
with correct author identity and content, and excludes posts they are not in the audience for.

**Acceptance Scenarios**:

1. **Given** friends have posted, **When** the viewer opens the Wall, **Then** they see those posts
   newest-first with author avatar/name/username.
2. **Given** a post the viewer is NOT in the audience for, **When** the Wall loads, **Then** that
   post does not appear and its existence is not revealed.
3. **Given** a new post arrives while the Wall is open, **When** it is received, **Then** it appears
   without a manual refresh (reactive update).
4. **Given** an author's profile photo is hidden by their privacy settings, **When** their post
   shows, **Then** it respects that setting consistently with the rest of the app.

---

### User Story 4 - React to posts; the audience sees reactions (Priority: P2)

A viewer reacts to a post with an emoji. The reaction is visible to the **whole audience** (each
reactor's identity and emoji), not just the author — like reactions in a group chat. A reactor can
change or remove their reaction.

**Why this priority**: Reactions are the core lightweight engagement. Making them audience-visible
(the author's choice) gives the Wall a social feel; it is possible because everyone in the audience
is a friend of the author, who relays reactions out to the audience.

**Independent Test**: A viewer reacts; the author and every other audience member see that reactor
and emoji; removing the reaction updates everyone's view.

**Acceptance Scenarios**:

1. **Given** a post, **When** an audience member reacts, **Then** the author and all other audience
   members see that reactor's identity and emoji.
2. **Given** a reaction exists, **When** the reactor removes or changes it, **Then** the audience's
   reaction list updates accordingly (last-write-wins per reactor).
3. **Given** the per-item reaction caps already used elsewhere in Ring, **When** reactions exceed
   them, **Then** the same caps apply to posts.
4. **Given** the author is briefly offline, **When** a viewer reacts, **Then** the reaction still
   reaches the rest of the audience (delivery does not depend on the author being online).

---

### User Story 5 - Curate a close-friends list (Priority: P2)

A person maintains a **close friends** list — a curated subset of their friends — and can post to it
as a distinct, more private audience. This is separate from any chat pinning/favorite.

**Why this priority**: Enables the "favorite friends only" audience that the author asked to control
per post. Lower than posting itself because "all friends" alone is already a usable MVP audience.

**Independent Test**: Add/remove friends to the close-friends list; a "close friends" post reaches
exactly that set and no other friend.

**Acceptance Scenarios**:

1. **Given** a friends list, **When** the author marks some as close friends, **Then** those friends
   form the close-friends audience.
2. **Given** a close friend is later removed from the list, **When** the author posts to close
   friends, **Then** that person no longer receives new close-friends posts.
3. **Given** the close-friends list, **When** anyone other than the author tries to learn its
   membership, **Then** it is not disclosed (including to the server).

---

### User Story 6 - Comment on a post (audience-visible thread) (Priority: P3)

An audience member adds a short **text comment** to a post. Comments form a thread that the whole
audience can read, each labelled with the commenter's profile. A commenter can delete their own
comment; the author can remove any comment on their post (and deleting the post removes its thread).

**Why this priority**: Comments deepen engagement beyond reactions but are not needed for the MVP
loop (friends → post → view → react). They share the same author-relay fan-out as reactions.

**Independent Test**: A viewer comments; the author and other audience members see the comment with
the commenter's identity; the commenter deletes it and it disappears for everyone.

**Acceptance Scenarios**:

1. **Given** a post, **When** an audience member comments, **Then** the comment appears for the author
   and all audience members, attributed to the commenter, in a consistent order.
2. **Given** a comment, **When** its author (the commenter) deletes it, **Then** it disappears for the
   whole audience (best-effort per the E2EE limitation).
3. **Given** a comment on her post, **When** the post author removes it, **Then** it disappears for the
   audience.
4. **Given** a blocked user, **When** they attempt to comment, **Then** the comment is not delivered.

---

### User Story 7 - See who viewed a post (Priority: P3)

The author opens one of their posts and sees a **list of who has viewed it**, respecting Ring's
existing seen-receipts privacy control: a viewer who has turned seen receipts off is not reported as
having viewed, and correspondingly cannot see view lists on their own posts.

**Why this priority**: A nice-to-have insight (story-style) layered on top of the core loop; it must
honor existing reciprocal seen-receipt privacy, so it is lower priority and gated by that setting.

**Independent Test**: A viewer with seen receipts on opens a post; the author sees them in the view
list. A viewer with seen receipts off opens the post; the author does not see them.

**Acceptance Scenarios**:

1. **Given** a viewer with seen receipts enabled, **When** they view a post, **Then** the author sees
   them in that post's view list.
2. **Given** a viewer with seen receipts disabled, **When** they view a post, **Then** the author does
   NOT see them, and that viewer does not get view lists on their own posts (reciprocity).
3. **Given** an expired post, **When** the author opens it before it is swept, **Then** the view list
   reflects only views recorded while it was live.

---

### Edge Cases

- **Unfriending / removal after delivery**: Content already delivered to a device cannot be
  cryptographically recalled. Removing a friend (or from close friends) affects **future** posts
  only; already-received posts may remain on that device until they expire or are deleted by their
  lifetime. This limitation MUST be reflected honestly in UI copy.
- **Deleting a post before expiry**: The author can delete a post; the system best-effort removes it
  from the server and signals viewers to remove their copies, but cannot guarantee deletion from a
  device that already downloaded it (same E2EE limitation).
- **Audience membership timing**: A post's audience is the set chosen **at post time**; someone who
  becomes a friend afterwards does not retroactively gain access to earlier posts.
- **Friend-request spam**: A stranger repeatedly sending requests after being declined/blocked MUST
  be rate-limited or suppressed so requests cannot be used to harass.
- **Reacting/commenting after expiry/unfriend**: A reaction or comment on a post the author can no
  longer fan out (expired/deleted, or the engager was unfriended) is dropped gracefully.
- **Engagement does not depend on the author being online**: a reaction/comment is delivered to the
  post's audience by the relay independently of the author; the engager sees their own action
  immediately and the rest of the audience receives it on their next sync.
- **Engagement reveals co-engagers**: Audience-visible reactions/comments inherently disclose, to the
  audience, *which* audience members chose to react or comment (not the full audience roster). UI copy
  MUST set this expectation, especially for close-friends posts.
- **View-list privacy reciprocity**: A viewer with seen receipts disabled is never listed as a viewer
  and never receives view lists on their own posts.
- **Large media / unsupported codecs**: Oversized or unplayable media degrades to a clear error, not
  a broken post.
- **Account termination / ghosted author**: Posts from an author who deletes their account stop
  appearing and stop being fetchable; their relayed threads stop updating.

## Requirements *(mandatory)*

### Functional Requirements

**Friendship**

- **FR-001**: Users MUST be able to send a friend request to any discoverable network user who has
  not blocked them.
- **FR-002**: The recipient MUST be able to accept or decline an incoming request; the sender MUST be
  able to cancel a pending outgoing request.
- **FR-003**: A declined request MUST NOT reveal to the sender whether it was actively declined or
  simply unseen.
- **FR-004**: Acceptance MUST establish a **mutual** friendship that both parties see in a friends
  list, and MUST establish/confirm a secure session between them.
- **FR-005**: Blocking MUST end any friendship and prevent new requests for the duration of the
  block; the existing block model is the basis.
- **FR-006**: Crossing requests (each sends the other a request) MUST reconcile into one accepted
  friendship without duplicate state.
- **FR-007**: Repeated requests from the same sender after decline/block MUST be rate-limited or
  suppressed to prevent harassment.
- **FR-008**: Posting and engagement MUST be volume-limited (per-author post rate, per-post comment
  rate, and per-user engagement rate) to prevent flooding a Wall or a viewer; limits MUST be enforced
  using only routing metadata the server already holds (author/recipient/post id), never by inspecting
  content. (Reaction caps per FR-032 are separate, content-level, and client-enforced.)

**Posts & audience**

- **FR-010**: Users MUST be able to create a post whose content is text, a voice clip, a video, or an
  image.
- **FR-011**: For each post, the author MUST choose an audience of either **all friends** or **close
  friends**.
- **FR-012**: Every post is ephemeral with a **hard maximum lifetime of 72 hours**, regardless of
  type (text/photo/video/voice). The author chooses a lifetime up to that ceiling (e.g. 1 hour, 24
  hours, 72 hours); there is no "keep"/permanent option. The 72-hour ceiling MUST be enforced
  server-side (the server clamps any longer or absent expiry), not just in the UI, so no post can
  outlive it.
- **FR-013**: A post MUST be delivered only to its chosen audience as of post time; non-audience users
  MUST receive nothing and MUST NOT be able to infer the post exists.
- **FR-014**: Post content and media MUST be end-to-end encrypted such that only audience members can
  decrypt them; the server MUST never receive readable content or media keys.
- **FR-015**: Authors MUST be able to delete their own post (best-effort propagation per the Edge
  Cases limitation).
- **FR-016**: Posts MUST be created and queued while offline and sent on reconnect; the local device
  is the source of truth.

**Wall / viewing**

- **FR-020**: Viewers MUST see a Wall listing posts they are in the audience for, newest-first, each
  showing the author's avatar, name, and username.
- **FR-021**: New incoming posts MUST appear without a manual refresh.
- **FR-022**: Author identity shown on a post MUST respect the author's existing profile-privacy
  settings (e.g. hidden photo).
- **FR-023**: Expired or deleted posts MUST disappear from the Wall.

**Engagement — reactions, comments, views**

- **FR-030**: Audience members MUST be able to react to a post with an emoji, and change or remove
  their reaction.
- **FR-031**: Reactions MUST be visible to the **whole audience** (each reactor's profile identity and
  emoji), not only the author.
- **FR-032**: Reactions MUST obey the same per-item reaction caps used elsewhere in Ring and resolve
  conflicts last-write-wins per reactor.
- **FR-033**: Audience members MUST be able to add a **text comment** to a post; comments MUST be
  visible to the whole audience, attributed to the commenter's profile, in a consistent order.
- **FR-034**: A commenter MUST be able to delete their own comment; the **post author** MUST be able to
  remove any comment on their post; deleting a post MUST remove its comment thread (best-effort per
  NFR, since delivered copies cannot be cryptographically recalled).
- **FR-035**: Reactions and comments MUST be delivered to the post's audience without disclosing the
  audience roster (including close friends) to the engager; only members of the post's audience may
  engage with it.
- **FR-036**: A blocked user's reactions and comments MUST NOT be delivered.
- **FR-037**: The post author MUST be able to see a **per-post view list** of which audience members
  have viewed it.
- **FR-038**: View reporting MUST honor the existing seen-receipts privacy control reciprocally: a
  viewer with seen receipts disabled MUST NOT be reported as a viewer and MUST NOT receive view lists
  on their own posts.

**Close friends**

- **FR-040**: Users MUST be able to curate a close-friends list as a subset of their friends,
  distinct from chat pin/favorite.
- **FR-041**: Close-friends membership MUST be known only to the author; it MUST NOT be disclosed to
  other users or to the server.

**Settings & notifications**

- **FR-050**: Users MUST be able to set a default post audience and manage post/Wall notifications
  through settings. (These replace the previously-removed placeholder "Status" settings with real,
  wired controls.)
- **FR-051**: Users MUST be notified of relevant events (new friend request, accepted request, and —
  per notification settings — new posts, reactions, and comments on their posts), consistent with
  Ring's existing notification model and per-item privacy (preview/no-preview).

### Zero-Knowledge Impact *(constitution-required)*

- **What new data crosses the client/server boundary, and in what form**: post ciphertext blobs,
  per-recipient encrypted key material, coarse post lifetime/expiry, friend-request signals, and
  reaction/comment/view signals — all as **opaque ciphertext or minimal routing metadata**. No post
  content, media plaintext, media keys, reaction emoji, comment text, view-list membership, or
  close-friends membership ever leaves a device in readable form.
- **Engagement routing**: a reaction/comment is encrypted to the post's audience and delivered to the
  same recipient set the post itself was addressed to; the engager addresses only "this post" and
  never learns the roster. (The plan realizes this by having the relay fan a submitted engagement
  ciphertext out to the audience it already holds for that post — keeping the close-friends roster
  author-private.) View receipts are encrypted viewer→author signals (gated by the seen-receipts
  setting).
- **What metadata the server necessarily learns**: that a user posted, the post's recipient set
  (audience addressing, as with any addressed message today), coarse size and expiry, that a friend
  request/acceptance occurred between two users (the contact graph is already server-readable by
  design), and that engagement signals flow between an engager and an author. The server MUST NOT
  learn audience *tier* names, close-friends membership, post/comment content, reaction emoji, or who
  viewed.
- **Residual disclosure to the audience (not the server)**: because reactions and comments are
  audience-visible by design, audience members learn *which co-audience members chose to engage*
  (those who react/comment), and the author learns who viewed (subject to seen-receipts). This is a
  product choice, surfaced in UI copy; it never widens what the *server* can read.
- **NFR-ZK-1**: The feature MUST NOT introduce any server endpoint or storage that requires reading
  user plaintext. A design that cannot meet this is rejected, not shipped (constitution Principle I).
- **NFR-ZK-2**: New crypto paths MUST reuse Ring's existing libsodium primitives and MUST include
  tests for forgery, replay, out-of-order delivery, and skipped-key cases, and MUST receive a
  security review (constitution Principle IV). A crypto/zero-knowledge **checklist** is required for
  this spec.
- **NFR-ZK-3**: No post/media/reaction/comment plaintext, media key, view-list entry, or close-friends
  membership may appear in any server log line, metric, error payload, debug aid, or migration. New
  server-side observability on these paths MUST be limited to the opaque routing metadata of
  NFR-ZK-1 (e.g. counts, ids, sizes), never content.

### Key Entities

- **Friendship**: a mutual relationship between two users with a state — none, pending-outgoing,
  pending-incoming, accepted, or blocked. Basis for all post audiences.
- **Friend Request**: a directed, pending intent from one user to another, resolvable to accepted,
  declined, or cancelled.
- **Close-Friends List**: an author-private set of friends used as a narrower audience.
- **Post**: an authored item with a type (text/voice/video/image), encrypted content/media, a chosen
  audience (all friends / close friends), a lifetime/expiry, and a created time.
- **Reaction**: an audience member's emoji response to a post, visible to the whole audience,
  attributed by profile, last-write-wins per reactor.
- **Comment**: an audience member's text response to a post, visible to the whole audience, attributed
  by profile, ordered, deletable by its commenter or the post author.
- **View Receipt**: a signal that an audience member viewed a post, shown to the author as a per-post
  view list, gated by the viewer's seen-receipts setting.
- **Profile (existing)**: avatar, name, username — already part of the public directory; shown on
  posts, comments, reactions, and friend requests.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A friend request can be sent, received, and accepted such that both parties see a mutual
  friendship, in under 30 seconds of network time end-to-end.
- **SC-002**: A post shared to "all friends" is visible to 100% of the author's current friends and to
  0% of non-friends and non-audience users.
- **SC-003**: A "close friends" post reaches exactly the close-friends subset — 0 leakage to other
  friends — in 100% of tests.
- **SC-004**: Across all post types (text, voice, video, image), audience members can open and
  render/play the content successfully on first attempt in at least 95% of cases.
- **SC-005**: A post with a 24-hour lifetime is no longer visible to author or viewers after expiry in
  100% of tests.
- **SC-006**: Every audience member (not just the author) sees each reactor's identity and emoji on a
  post, with reactor changes/removals reflected for the whole audience.
- **SC-007**: A comment posted by any audience member appears for the author and all audience members,
  correctly attributed and ordered, in at least 95% of cases; deletion by the commenter or post author
  removes it for the audience.
- **SC-008**: The author's per-post view list includes 100% of viewers who have seen receipts enabled
  and 0% of viewers who have them disabled.
- **SC-009**: Zero-knowledge holds: in inspection of server storage and traffic, no post content,
  media plaintext, media key, reaction emoji, comment text, view-list membership, or close-friends
  membership is recoverable — verified by the required checklist and security review.
- **SC-010**: An engager never learns the audience roster: in tests, a reacting/commenting viewer
  cannot enumerate other audience members beyond those who themselves publicly engaged.
- **SC-011**: A declined or blocked sender cannot harass via repeated requests (requests are
  rate-limited/suppressed) in 100% of tests.

## Assumptions

- **Discovery** reuses the existing public directory (search by username/profile); no new public
  surface is introduced beyond what already exists.
- **Secure sessions** between friends reuse Ring's existing session-establishment (X3DH); friendship
  acceptance is the natural point to establish/confirm one.
- **Audience is frozen at post time**; later friend/close-friend changes affect future posts only.
- **Engagement is audience-visible** (clarified): reactions and comments are shown to the whole
  audience and are delivered to the post's audience without disclosing the roster to the engager, so
  close-friends membership stays author-private. Delivery does not depend on the author being online
  (the relay fans engagement out to the post's audience).
- **View receipts** (clarified): the author sees a per-post view list, gated reciprocally by the
  existing seen-receipts privacy setting.
- **Media reuse**: posts reuse Ring's existing per-file encrypted media-blob transfer; no new media
  pipeline.
- **Lifetime reuse**: post expiry reuses Ring's existing disappearing-message timer/sweep machinery.
- **Single-network scope**: friendships and posts are within one Ring server/network instance.

## Clarifications

### Session 2026-06-21

- **Q: Reaction visibility** → A: **Reactions are visible to the whole audience** (each reactor's
  identity + emoji), not author-only. Drives FR-031 and the author-relay routing.
- **Q: Replies/comments scope** → A: **Audience-visible comment threads are in scope for v1** (not
  reactions-only). Drives User Story 6 and FR-033–FR-036.
- **Q: Viewer/seen list** → A: **The author sees a per-post view list**, gated by the existing
  seen-receipts privacy control. Drives User Story 7 and FR-037–FR-038.
