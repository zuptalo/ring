# Phase 0 Research: Harden Hidden Chats + One-Hidden-One-Visible Per Person

**Spec**: [spec.md](./spec.md) | **Date**: 2026-07-02

This feature is a fix/harden pass over a shipped implementation, so "research"
here is primarily a precise audit of the current mechanics (file:line anchored)
plus the one open design decision the spec deferred: which crypto channel backs
each of the two coexisting threads and how inbound routing picks the right one.

## R1. How the pieces work today (audit summary)

- **Hidden set + PIN** (`src/services/hidden-chats.ts`): the hidden conversation
  ids live in `privacy.hiddenChats`, AEAD-sealed under the master key; the reveal
  PIN is a separate Argon2id-derived verifier (`privacy.hiddenPin`, decrypt-succeeds
  only, no oracle). Both are device-local settings excluded from own-data sync.
  This layer is sound — 1027 keeps it unchanged.
- **In-memory leaf** (`src/services/hidden-state.ts`): cached id set + `loaded`
  flag + memory-only `revealed` flag; fails closed by keeping the last-known set
  on decrypt failure and only marking `loaded` on success. Sound; kept.
- **Choke points** (`src/db/queries.ts`): `listChats` (L59), `listCallGroups`,
  `listCallsForTotals`, `archiveAllChats`, `countUnread` (L3794),
  `countMissedUnseen`, `startDirectChat` (L4059). All consult
  `ensureHiddenLoaded()` + `isRevealed()` and fail closed via `isHiddenKnown()`.
- **Ratchet sessions are keyed by chat id** (`src/services/messaging.ts` L83-97:
  `loadSession(chatId)` / `smeta:${chatId}`). The 1:1 Double Ratchet session for a
  peer lives under the id of the 1:1 chat row. This single fact drives the whole
  coexistence design (R2).
- **Inbound routing** (`src/db/queries.ts` `receiveIncomingInner` L4391): every
  inbound 1:1 frame resolves its chat via `startDirectChat(contact)` (L4429)
  *before* decrypting — and `startDirectChat` **refuses hidden chats** (the #544
  loophole fix) and creates a fresh visible chat when the only match is hidden.
- **Notifications**: page path `src/services/notify.ts` L373-391 (foreground:
  silent + claims the banner; backgrounded-but-connected: bridges a generic local
  notification); SW path `src/services/sw-inbox.ts` `noteForPayload` L207-216
  (generic "Ring / New message" note, before mute/mention/content branches).
- **Badges**: page `countUnread` honors `privacy.hiddenChatsBadge` but fails
  closed to **0 for the whole total** when the set is unknown (L3806). SW
  `unreadCount()` (sw-inbox L522) counts **all** chats unconditionally — it never
  applies the badge preference or the hidden set.
- **Reset** (`src/services/hidden-chats-reset.ts`): tombstones (localOnly,
  `deletedAt = MAX_SAFE_INTEGER`) then deletes messages/sessions/senderkeys/chats,
  then clears set+PIN. Tombstones are honored only by the own-data sync ingest
  (`services/sync.ts`, `services/ownsync.ts`) — **not** by `receiveIncomingInner`.
- **Calls**: `hiddenCallKeys` (`src/db/hidden-calls.ts`) excludes hidden peers
  from call history + missed-call badge. There is **no** pre-answer caller-identity
  suppression anywhere — the incoming-call overlay always shows full identity.
- **The NUL byte** (`src/db/queries.ts` L3703, offset 158588): an *intentional*
  hash-domain separator written as a raw byte inside a template literal
  (`` `${card.name}<NUL>${card.avatar}` `` feeding SHA-256). Functionally fine;
  it just makes grep treat the file as binary. Fix: the `\u0000` escape.

## R2. The confirmed core bugs (with mechanism)

### B1 — Hiding your only 1:1 breaks the thread and resurrects a visible chat
`receiveIncomingInner` L4429 calls `startDirectChat` for **every** inbound frame
from a peer. Once the sole 1:1 with that peer is hidden:
1. `startDirectChat` skips the hidden chat → creates a fresh **visible** chat `V`.
2. `openPacket(V, …)` finds **no session** under `V` (the ratchet lives under the
   hidden chat's id) → throws → `requestRekey(V, from)` fires (spurious wire
   traffic; also observable behavior change caused by hiding).
3. The peer re-keys; the new session establishes under `V`; their message lands
   **visibly** in `V`.
4. The hidden thread is permanently orphaned (its session is now stale) and never
   receives anything again.

This violates the privacy contract three ways (visible resurrection, visible
content, dead hidden thread) and matches the user-reported "buggy" behavior.
Corollary: even a **group** message from that peer (which rides the 1:1 session)
resurrects an empty visible 1:1 row.

### B2 — No per-person invariant
Nothing prevents hiding a second chat with the same person or unhiding into two
visible chats. `toggleHidden` (`ChatActionsSheet.vue` L102) is a bare
`addHidden`/`removeHidden`.

### B3 — Reset re-materialization
The reset tombstone is keyed by the **old chat id**, but a post-reset inbound
message creates a chat with a **new id** (via B1's path) — so even consulting
tombstones in the relay path would not block it. The block must be **peer-keyed**
for 1:1s (and id-keyed for groups, where ids are stable and shared).

### B4 — Collateral badge suppression + SW badge ignores the preference
Page: `countUnread` returns 0 for the whole app while the set is unknown (modes
`never`/`revealed`). SW: `unreadCount()` never filters at all, so mode `never`
still bumps the badge for hidden-chat pushes — leaking against an explicit choice.

### B5 — No relock kick-out
`relockHidden()` flips state and refreshes lists, but an open
`/chat/<hiddenId>` page stays on screen. Nothing navigates away, and no route
guard blocks direct navigation to a hidden chat while relocked.

### B6 — Backgrounded-but-connected generic banner
`notify.ts` L389 bridges a generic local notification on the non-push background
path. Per the clarified FR-012, every path the platform doesn't force must be
fully silent — this bridge must go.

## R3. Decision — coexistence channels and inbound routing

**Decision**: Two coexisting threads with one person are always **two distinct
channels**: at most one *plain 1:1* (the per-peer Double Ratchet channel, session
keyed by its chat id) and at most one *pair conversation* (a group-modeled
conversation with exactly that one participant, sender-key crypto, routed by
`groupId` — the existing `startHiddenChat`/`createGroup` mechanism). Hidden vs
visible are **roles**; channel type is whatever each thread happens to be.

- **Hide stays a move**: `addHidden(existingChatId)` — no migration, no wire
  traffic, no signal to the peer, history and ratchet intact. (B1 is fixed by
  routing, not by changing what "hide" does.)
- **Inbound routing rule R** (replaces the blind `startDirectChat` call in
  `receiveIncomingInner`) — two stages, since `payload.groupId` is sealed and
  only known post-decrypt:
  - *Stage 1 — session resolution (pre-decrypt)*: the **visible** plain 1:1 with
    the peer if one exists; else the **hidden** plain 1:1 (never creates
    anything visible); else, if a hidden-reset **peer block** exists (R4) →
    ack + drop, no trace; else create a fresh visible 1:1 (today's behavior for
    genuinely new peers).
  - *Stage 2 — content routing (post-decrypt)*: `payload.groupId` present →
    that conversation id (unchanged today); else the stage-1 chat.
  Stage 1 always opens the packet under the id that actually holds the session —
  no more spurious re-keys.
- **Fresh visible chat** (`startDirectChat`, user-initiated only): if a hidden
  plain 1:1 with the peer exists → create a **visible pair conversation**
  (group-modeled) instead of a second plain 1:1. If the hidden thread is itself a
  pair conversation (legacy 1019 shape, or re-hidden later) and no plain 1:1
  exists → create a plain 1:1 (normal path). Either way at most one channel of
  each type exists, so routing stays unambiguous.

**Why this is the only coherent shape**: the peer has their own thread(s) and
decides where their messages go. Splitting one peer channel across two local
threads is arbitrary and leaks: if a fresh *plain* 1:1 were created next to a
hidden plain 1:1, rule R would steer the peer's replies-to-the-secret-conversation
into the **visible** thread — a catastrophic content leak. Coexistence inherently
requires two wire channels, which means the peer necessarily sees two
conversations once the user starts the fresh visible one. That is accepted and
stated in the spec's ZK section (to the server both are opaque; to the peer a new
conversation appearing is a normal event).

**Alternatives considered**:
- *Migrate history into a group-modeled hidden thread at hide time*: sends a group
  create card at the moment of hiding — leaks the hide action to the peer; also
  heavyweight (history move, session teardown). Rejected.
- *Tag messages with a hidden-channel marker inside the sealed payload*: requires
  peer-side understanding, doesn't survive the peer replying from their single
  thread, adds protocol surface. Rejected.
- *One thread only (hide = pure visibility flag, no coexistence)*: contradicts the
  explicitly requested one-hidden-one-visible model. Rejected.

## R4. Decision — peer-keyed reset block

**Decision**: `resetHiddenChats` additionally records a localOnly tombstone per
hidden **1:1 peer** under a dedicated key (`hiddenPeer:<peerId>`, reusing the
existing `tombstones` store and `recordTombstone(…, localOnly=true)`), alongside
today's chat-id tombstones (which keep blocking own-data re-download) and group-id
tombstones (ids are stable for groups, so id-keyed works there — `ensureGroupChat`
and `handleGroupCard` must consult them). Rule R step 4 consults the peer block:
inbound 1:1 content from a blocked peer is **acked and dropped** with no rekey
request, no contact/chat creation, no notification (mirror of the friends-only
"leave no trace" path already in `receiveIncomingInner`). An explicit user action
(`startDirectChat` from the contact) lifts the block via `clearTombstone` —
deliberate re-engagement, same pattern as contact re-add.

**Alternative considered**: dropping frames only until the next app restart —
rejected; FR-018 requires the block to hold indefinitely until deliberate user
action.

## R5. Decision — badge correctness without collateral suppression

**Decision**: cache the last successfully computed badge number.
- Page: `countUnread` persists its result to a device-local plain setting
  (`badge.lastCount`) on every successful computation. When mode is
  `never`/`revealed` and the hidden set is unknown (locked at cold open), return
  the cached number instead of 0. The cached value is already hidden-filtered (it
  was computed under the preference) and is exactly what the OS badge showed a
  moment ago — it leaks nothing new and keeps visible-chat badges correct.
- SW: `unreadCount()` applies the same preference: read
  `privacy.hiddenChatsBadge`; for `never` (and `revealed`, which in the SW is
  always "not revealed" — reveal is page-memory-only) exclude chats in
  `readHiddenSet()` from the stored-unread sum, and do not count **pending
  frames** attributable to hidden chats. If the hidden set cannot be decrypted
  (locked), fail closed *for the hidden contribution only*: fall back to
  `badge.lastCount` for the stored part and count only pending frames that are
  provably not hidden (an unclassifiable frame is not counted — privacy beats
  accuracy on the badge, matching the user's explicit `never` choice).
- Mode `always` (default) is unchanged: count everything, no fail-closed needed.

**Alternative considered**: a cleartext list of hidden ids for the badge path —
rejected outright (leaks hidden ids at rest, defeating the sealed set).

## R6. Decision — relock kick-out and navigation guard

**Decision**: two layers.
1. `setRevealed(false)`/`clearHiddenState` gains a registered navigation hook
   (injected from the router module to keep `hidden-state.ts` a leaf): when a
   reveal session ends and the current route is `/chat/:id` (or a detail page of)
   a hidden conversation, `router.replace('/tabs/chats')` immediately.
2. A router guard on chat detail routes: navigating to a hidden conversation while
   not revealed redirects to `/tabs/chats` (defense in depth against deep links,
   stale notification taps, and back-stack restoration).

## R7. Decision — notification paths (clarified FR-012)

- **SW path**: keep the existing generic note (sw-inbox L211-216) — verify it is
  byte-identical to the previews-off generic (title `Ring`, body `New message`,
  url `/tabs/chats`) and keeps the internal coalescing tag. It already runs before
  mention/mute/content branches (hidden wins) — add a regression test pinning the
  ordering and the byte-identity.
- **Page path**: foreground stays fully silent + claims the banner (unchanged).
  The backgrounded-but-connected generic bridge (`notify.ts` L389) is **removed**
  — that path becomes badge-only (B6). If a co-arriving push wakes the SW anyway,
  the SW's generic note covers the platform requirement.
- **Calls**: no change to the live ring (full identity — knock-knock). The 1019
  FR-019 "pre-answer no-preview" idea was never built; nothing to remove. 1027
  documents full-identity as intended and adds an e2e asserting it.

## R8. Decision — enforcement predicate and state machine

**Decision**: a small pure module (`src/services/hidden-pair.ts`, unit-testable
without IndexedDB) defines:
- `chatsWithPeer(chats, peerId)`: plain 1:1s (`!isGroup && participantIds ===
  [peerId]`) plus pair conversations (`isGroup && participantIds === [peerId]`).
  Multi-member groups never count.
- `canHide(chats, hidden, chatId)` → `{ ok } | { ok:false, reason }`: false when
  another chat with the same peer is already hidden (per-person one-hidden rule);
  groups (multi-member) are always hideable individually.
- `canUnhide(chats, hidden, chatId)` → false when a visible chat with the same
  peer exists (per-person one-visible rule).
- `resolveInboundDirectChat(chats, hidden, peerId)` → rule R steps 2-3 as a pure
  function (the impure wrapper in `queries.ts` adds tombstone check + creation).
`ChatActionsSheet` consumes `canHide`/`canUnhide` to disable the action with the
reason as a caption (stock Ionic, Principle XI). Legacy broken states (e.g. a
hidden **and** a visible plain 1:1 for the same peer, produced by B1 before the
fix) are tolerated read-only: rule R routes to the visible one (where the live
session is), unhide stays blocked until the user deletes one — no data loss, no
migration pass needed; covered by a drive scenario.

## R9. Decision — biometric leftovers (1019 US6)

**Decision**: stays deferred. Remove the dangling references so the codebase is
consistent: the `privacy.hiddenChatsBiometric` mentions in
`hidden-chats.zk.test.ts` and `specs/1019-…/contracts/internal-api.md` /
`quickstart.md` remain historical spec artifacts (not code); the only *code*
reference is the zk test asserting the key never syncs — keep that assertion (it
is future-proofing, not dead code) but drop any test/contract text implying the
feature exists. No settings toggle is added.

## R10. Testing approach (FR-022/FR-023)

- **e2e (`e2e/`)**: extend `hidden-chats.spec.ts` + new specs for: hide-moves +
  inbound-lands-hidden-silently (B1 regression), coexistence via fresh visible
  pair chat with cross-thread isolation, Hide/Unhide blocking with reasons,
  knock-knock call full identity (2-person call, per e2e CI constraints), badge
  modes, reset + live-inbound re-materialization block (B3 regression), relock
  kick-out + route guard, cold-open no-flash with correct visible badge (B4
  regression). Real multi-context WebRTC is already proven in this suite.
- **drive (`drive/scenarios/`)**: keep/extend the six existing hidden-chat
  scenarios and add: `hidden-coexist.mjs` (full user journey), `hidden-reset-relay.mjs`
  (reset then live message), `hidden-kickout.mjs` (grace expiry inside the chat).
- **vitest**: new `hidden-pair.test.ts` (pure predicate/state machine),
  routing-rule unit tests against the fake idb, badge-cache tests, SW
  `unreadCount` preference tests, tombstone peer-block tests; keep + extend the
  existing hidden suites.

All decisions above resolve the spec's deferred design point; no NEEDS
CLARIFICATION remain.
