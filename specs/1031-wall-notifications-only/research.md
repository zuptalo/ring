# Research: Wall notifications go to the owner only (spec 1031)

All Technical Context items were resolvable from the codebase; no external unknowns
remained. Decisions and the alternatives considered:

## D1. Where the "owner only" narrowing happens

**Decision**: at the server's *push* fan-out (`submitEngagement`), while keeping the live
WS `post-engagement` nudge audience-wide.

**Rationale**: the WS frame is data sync — every audience member must keep reconciling
reactions/comments live or posts would render stale for non-owners (FR-005). The web push
is the *wake-a-device* channel, i.e. the alert; the server already holds exactly the
metadata needed to route it (post id → author via `PostAuthor`, actor = authenticated
uid). Narrowing there removes N−1 device wakes per comment and reduces metadata spread
(Principle IX). The client still re-checks ownership (`post.outgoing`) before alerting, so
a misrouted push can never produce a wrong banner.

**Alternatives considered**:
- *Client-only filtering (keep pushing everyone, suppress on device)*: rejected — keeps
  waking every audience device for every comment (battery, metadata), and a suppressed
  push still risks the SW's generic fallback notification racing ahead. Fails BR-3 in
  spirit.
- *Server-only filtering with no client predicate*: rejected — the reaction add/remove
  flag is sealed (server cannot see it), so the device must make the final show/skip call
  anyway (FR-009).

## D2. A new `post-activity` push type vs reusing the `post` tickle

**Decision**: new content-free payload `{"t":"post-activity","post":"<id>"}` sent only to
the post author; the existing `{"t":"post"}` tickle reverts to meaning "new post" only.

**Rationale**: the SW needs to know (a) that this wake is engagement, not a new post — so
it doesn't announce "〈name〉 posted on their Wall" wrongly — and (b) *which* post, so it can
fetch one engagement list and decide add-vs-remove locally. Web Push payloads are encrypted
per-subscription (aes128gcm), so nothing new is visible to the push service; the post id is
routing metadata the server already stores next to the subscription anyway.

**Alternatives considered**:
- *Reuse `{t:'post'}` unchanged*: rejected — the SW's `previewPosts` finds no fresh post
  and falls back to a generic "New activity on your Wall" notification even for a reaction
  *removal* (spurious alert, violates FR-002), and it can't name the actor.
- *Carry actor id in the payload too*: rejected as unnecessary — the engagement list
  already returns actors (server metadata), and a smaller payload is a smaller contract.

## D3. Reaction add/remove when the app is closed

**Decision**: the SW opens the sealed reaction payload under the post's `postKey` (already
stored on the post row in IDB; libsodium is already initialized in the SW for message
previews). `remove: true` → show nothing. If decryption is unavailable (cold start /
locked), reactions are skipped silently; comments still alert because their `kind` is
cleartext and needs no decryption.

**Rationale**: "never a spurious alert" beats "never a missed reaction" — a removal that
notifies is a visible bug; a missed reaction alert in the rare locked-SW case self-heals on
next open. Comments — the request's primary scenario — degrade gracefully without crypto.

**Alternatives considered**:
- *Generic fallback notification when undecryptable*: rejected — that's exactly the
  spurious-removal alert.
- *Server distinguishes add/remove*: rejected outright — would require unsealing the
  payload or a cleartext flag, breaking Principle I. (A cleartext `remove` hint was
  considered and rejected: it leaks user behavior the server currently cannot see.)

## D4. Settings shape

**Decision** (from clarification): a second toggle in the Wall group —
`notifications.wall.activity` ("Activity on your posts", default **on**) — alongside the
existing `notifications.wall.show` ("New posts"). Added to `SYNCED_PREF_KEYS` so it roams
with own-data sync like its sibling.

**Alternatives considered**: single shared toggle (rejected by user), reactions-only
sub-toggle mirroring groups (rejected by user in favor of one activity toggle covering
comments + reactions).

## D5. Per-person mute/hide semantics

**Decision** (from clarification): mute/hide stays **posts-only**. The pure predicate
deliberately does not consult `wall.mutedUsers` / `wall.hiddenUsers` for engagement on
your own posts. The temporary global Wall mute (`wall.muteUntil`) *does* suppress
engagement alerts — it means "quiet the Wall for a while".

## D6. Where the client alert decision lives

**Decision**: a dependency-free pure module `src/services/wall-activity-policy.ts`
(mirroring the established `notify-policy.ts` pattern), consumed by `queries.ts`
(page path). The SW path shares the same *rules* via its preview filter; its
environment differs (no Vue, ledger-based dedupe) so it is tested separately in
`sw-inbox.postactivity.test.ts` like the existing `sw-inbox.preview.test.ts`.

**Rationale**: pure function → vitest-first TDD (Principle III), and the page/SW pair
stays reasoning-identical the way `notificationOwner` already does for messages.

## D7. Recency guards and dedupe

**Decision**: page path mirrors `notifyNewPost` — 5-minute freshness window + a
session-scoped notified-ids set. SW path mirrors `previewPosts`/conn — 10-minute window +
a persisted shown-ledger (`sw.wallActShown`, capped like `CONN_SHOWN_KEY`). Push topic
collapses per post at the push service (base64url hash prefix of the post id, ≤32 chars).

**Rationale**: reconnect after a day offline must not flood the owner (spec edge case);
the mechanisms already exist and are proven — reuse their shapes exactly.

## D8. No DB migration, no store-interface change

**Decision**: none needed. `PostAuthor` and `PostAudience` already exist on the store and
the router's `PostsStore` interface; the engagement schema is untouched; IndexedDB gains
no store (settings live in the existing `settings` store).
