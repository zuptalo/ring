# Phase 0 Research: Zero-Knowledge Social Wall

Decisions that resolve the unknowns in the plan's Technical Context. Each is **Decision /
Rationale / Alternatives considered**, grounded in the existing codebase.

## R1 — Friendship: reuse the existing `connections` subsystem

**Decision**: Treat an **accepted connection** as a **friend**. Do not build a new friend-request
system. Reuse: server `connections` table + `/v1/connections/{request,accept,reject,withdraw,link}` +
`GET /v1/connections` (`server/internal/api/connections_handlers.go`, `store/connections.go`,
`migrations/0017_connections.sql`); client `src/services/connections.ts`, the `requests` IndexedDB
store + `FriendRequest` type (`src/db/types.ts`), the `connectedPeers` ledger / `markContactConnected`
(`src/db/queries.ts`), and the Contacts-page request UI (`src/views/tabs/ContactsPage.vue`).

**Rationale**: This already implements spec US1 / FR-001…FR-006 end-to-end: directed
request→accept/decline/withdraw, block interplay (`Connected()` checks both directions and blocks),
E2EE gating (prekey-bundle fetch blocked until accepted), and content-free offline tickles
(zero-knowledge). The Wall's "all friends" audience = the set of accepted connections.

**Gaps to close (small)**:
- **Mutual semantics**: `Connected(a,b)` is true if *either* side accepted. For the Wall this is the
  right "are we friends" predicate; no change needed. FR-006 (crossing requests) is already handled
  (`RequestConnection` returns `accepted` when the reverse request exists).
- **Friend enumeration for audience building**: the client needs "my friends" = accepted connections.
  Derive from `connectedPeers` ledger + contacts; add a `listFriends()` query helper if not present.
- **FR-007 anti-harassment**: confirm/add rate-limiting on repeated `request` after decline/block
  (server already drops requests from blocked users; add a cooldown on repeat requests).

**Alternatives considered**: a brand-new `friendships` table — rejected (duplicates a working,
zero-knowledge-correct mechanism and fragments the social graph).

## R2 — Close-friends list: client-only, per-contact flag

**Decision**: Add `Contact.closeFriend: boolean` (default false), curated on a new `CloseFriendsPage`.
It rides the existing **own-data sync** (contacts are already in `SYNCED`, LWW on `updatedAt`), so it
restores across devices **encrypted** and is **never sent to the server in the clear**.

**Rationale**: FR-040/FR-041 require the close-friends set to be author-private (not disclosed to
others or the server). Keeping it a client-side flag on the already-encrypted contact record
satisfies this for free. Distinct from the per-**chat** favorite/pin (`Chat.favorite`) — different
intent, different record.

**Alternatives considered**: a server-side "close friends" group — rejected (would leak the roster to
the server, violating FR-041 and Principle I).

## R3 — Post encryption: fresh per-post content key, wrapped per recipient

**Decision**: For each post, generate a random symmetric **content key** `K_post`. Seal the post
payload (type, text, and the media-ref including the per-file media key) with `K_post` via the
existing AEAD (`crypto/envelope.ts`). Distribute `K_post` to each audience member by wrapping it over
that member's existing **1:1 Double Ratchet session** — the same per-recipient distribution pattern
`crypto/senderkeys.ts` already uses to hand out a sender key. The post **ciphertext blob** is uploaded
once (reusing `media-transfer.ts` / blob storage); the server stores it plus **one envelope per
recipient** (the wrapped `K_post`).

**Rationale**: Posts are discrete items with **per-post audiences and per-post lifetimes**. A fresh
key per post gives clean per-post access control and "revocation by expiry" without entangling posts.
Reuses only existing primitives (Principle IV). The new pure helpers live in `crypto/post.ts`
(testable without IndexedDB); orchestration in `posts.ts` stays crypto-only (mirrors `messaging.ts`;
`queries.ts → posts.ts` one-directional, no cycle).

**Alternatives considered**:
- A long-lived **author sender key** (ratchet) reused across posts — rejected: per-post audience +
  expiry + close-friends scoping would fight a single evolving key; forward secrecy across unrelated
  posts adds complexity without benefit.
- **MLS / new group scheme** — rejected (Principle IV: no new key-exchange schemes).

## R4 — Media: reuse the per-file AEAD blob transfer

**Decision**: Voice/video/image posts reuse `media-transfer.ts`: client generates a random file key,
AES-GCM-encrypts the file, uploads ciphertext to `POST /v1/blobs` (opaque, capability id), and embeds
the `{blobId, fileKey}` media-ref **inside** the `K_post`-sealed payload. Viewers extract the ref,
download the blob, decrypt locally. Multi-size image thumbnails reuse spec 1014's pipeline.

**Rationale**: Zero new media path; the server already stores blob ciphertext it cannot read. The file
key never appears outside the sealed post payload.

**Alternatives considered**: a separate "post media" store — rejected (blobs already are
capability-addressed and content-blind).

## R5 — Engagement (reactions/comments): encrypt under `K_post`, relay fans out to the post's audience

**Decision**: A reaction/comment is sealed under the **same `K_post`** (every audience member already
holds it) and submitted to the relay referencing **only the post id**. The server **fans the
engagement ciphertext out to the post's stored recipient set** (the envelopes it already has), after
checking the submitter is in that audience and not blocked. Each recipient stores it in the new
`postEngagement` store; the Wall renders reactions/comments reactively. Reactions reuse the existing
**reaction caps + last-write-wins-per-user** semantics (`queries.ts`). Comment ordering is by author
timestamp with id tiebreak. Deletions (own comment, or author moderating, or post deletion) are
tombstone engagement records fanned out the same way.

**Rationale**: Satisfies FR-030…FR-036 + SC-010 (engager never learns the roster — the **server**
addresses the fan-out from the set it already stores), keeps everything E2EE under a key the server
lacks, and removes any author-online dependency. Only audience members can produce valid `K_post`
ciphertext, so non-members can't forge engagement.

**Server learns**: that submitter X engaged with post P (and the post's audience, already known). It
does **not** learn the emoji, comment text, or who is in the close-friends tier. This is the minimum
routing metadata (Principle IX) and is consistent with today's addressed-message model.

**Alternatives considered**:
- **Author re-broadcast** (viewer→author, author→audience) — rejected: adds an author-online
  dependency for engagement to appear; no ZK benefit over server fan-out (server learns the same).
- **Viewer addresses the audience directly** — rejected: the viewer doesn't know (and must not learn)
  the roster, especially close friends (FR-041).

## R6 — View receipts: 1:1 viewer→author, gated by seen-receipts

**Decision**: When an audience member opens a post, the client sends a **view signal to the author
only** (over the 1:1 session), recorded in the author's `postEngagement` as a view. It is gated by the
existing `privacy.seenReceipts` setting **reciprocally**: a viewer with receipts off sends none and is
shown no view lists on their own posts (mirrors the chat seen-receipt reciprocity in `useSync.ts`).

**Rationale**: FR-037/FR-038 + SC-008. Reuses the established seen-receipt privacy contract rather
than inventing a new visibility rule. View lists are author-only, so no fan-out is needed.

**Alternatives considered**: fanning views to the whole audience — rejected (the spec makes views
author-only; broader disclosure would be a privacy regression).

## R7 — Lifetime/expiry: reuse the disappearing-message TTL + sweep

**Decision**: A post carries `expiresAt` (author chooses 24h / 7d / keep). Reuse the existing
disappearing-message sweep (the `useSync.ts` expiry sweep over `expiresAt`) extended to the `posts` +
`postEngagement` stores; the server stores a coarse expiry on the post row and prunes expired posts +
envelopes + engagement on a periodic job (or lazily on fetch).

**Rationale**: FR-012/FR-023 + SC-005; one mechanism for "disappearing", consistent UX, no new timer
infrastructure.

**Alternatives considered**: a bespoke post-expiry timer — rejected (duplicates existing sweep).

## R8 — Server storage shape

**Decision**: New forward-only migration `0021_posts.sql`:
- `posts(id, author, blob_id, size, created_at, expires_at)` — opaque; `blob_id` is the post-payload
  ciphertext capability.
- `post_envelopes(post_id, recipient, wrapped_key)` — per-recipient `K_post` envelope (the audience
  addressing the server uses to deliver + to fan out engagement).
- `post_engagement(id, post_id, author, blob_or_inline, kind, created_at)` — opaque engagement
  ciphertext (reaction/comment/tombstone) fanned out to the post's audience.
- `post_views(post_id, viewer, viewed_at)` — author-only view receipts (only rows the author can read;
  stored as opaque/min-metadata, author aggregates client-side).

All content is ciphertext or capability ids; no plaintext columns. Handlers are stdlib `net/http` on a
new `PostStore` interface at the call site, tested against the in-memory fake store (Principle VI).

**Rationale**: Mirrors existing `blobs` + addressed-delivery patterns; minimal, content-blind schema.

**Alternatives considered**: storing post content in a column — rejected (Principle I).

## R9 — UI: Ionic-first

**Decision**: Wall feed = `ion-content` + `ion-list`/cards composed from `ion-*` and existing media
components (image/video/voice bubbles reused). Composer reuses the bidi-aware textarea approach and the
existing media-capture/attach flows. Audience + lifetime pickers are `ion-segment`/`ion-select`.
Post/Wall **settings** are a **data edit to `src/settings/schema.ts`** (real, wired controls replacing
the removed placeholder "Status" rows), not bespoke components.

**Rationale**: Principles X & XI. Any custom post tile is composed from Ionic + `--ring-*` tokens and
reasoned here; no hand-rolled primitives.

## Open risks (carry into tasks/checklist)

- **Crypto/ZK checklist is mandatory** (Principles I & IV) — must cover post seal/open, per-recipient
  `K_post` wrap, engagement forgery/replay/out-of-order, and that no plaintext/roster leaks server-side.
- **Audience-change semantics**: audience is frozen at post time (envelopes are fixed); removing a
  friend affects future posts only — already in spec Edge Cases; tests must assert it.
- **Fan-out cost**: per-post + per-engagement fan-out is O(audience), like group messages today;
  acceptable at the stated scale.
