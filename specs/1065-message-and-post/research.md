# Phase 0 Research: Message and Post Audience Insight (spec 1065)

Everything below was read out of the working tree, not assumed. Each decision
names the code it has to live with.

## R1. The audience list needs no virtualization library

**Decision**: Page the list with `PAGE`/`visible` + `ion-infinite-scroll`,
following `src/views/tabs/ContactsPage.vue`.

**Rationale**: `@ionic/vue` is 8.8.8 (`package.json:22`). `ion-virtual-scroll`
was dropped in Ionic 7 and does not exist in 8, and the repo carries no
third-party virtual-list dependency. The codebase already solves this problem
three different ways, and the cheapest one fits: `ContactsPage.vue:226,271,437,448`
renders `friends.slice(0, visible)` and grows `visible` by 15 on
`ion-infinite-scroll`. `CallsPage.vue:93-98` does the same. This satisfies
FR-004 with no new dependency and no height measurement inside a breakpoint
modal.

**Alternatives considered**: the chat windowing module (`src/utils/chat-window.ts`,
`ROW_CAP` 100 / `BATCH_SIZE` 50) is far more machinery than a flat people list
needs, and it exists to handle bidirectional scroll through history. Adding a
virtualizer would be a new dependency for a list that is at most a few hundred
short rows.

## R2. The sheet is a stock Ionic breakpoint modal

**Decision**: `ion-modal` with `:initial-breakpoint="0.6"` and
`:breakpoints="[0, 0.6, 1]"`, copying `src/components/ChatListsSheet.vue:7-8`.

**Rationale**: Constitution Principle XI (Ionic-First UI). The repo has a
settled sheet idiom in `ChatListsSheet.vue`, `ChatActionsSheet.vue:7`, and
`ChatDetailPage.vue:1131-1141`. Nothing bespoke is needed.

**Note on theme tokens**: the constitution says `--ring-*`, but the codebase
convention is actually `--app-*`, defined in `src/theme/variables.css`
(`--app-text`, `--app-text-muted`, `--app-text-secondary`, `--app-surface`,
`--app-border`). Only three orphaned `--ring-*` references exist repo-wide and
none is defined anywhere. New work uses `--app-*`. This mismatch is worth a
constitution erratum later; it is not a licence to invent new tokens here.

## R3. `ReactionDetails.vue` becomes the audience row

**Decision**: Generalize `src/components/ReactionDetails.vue` into the shared
audience list rather than writing a new component, satisfying FR-001.

**Rationale**: it is already a dumb presentational list over
`{name, emoji, when}` (`ReactionDetails.vue:18`), with the formatting boundary in
the right place (the caller formats `when`; the component just prints it). It
needs an optional `avatar`, an optional `emoji`, and a stable key (it currently
keys by array index, `:4`). Its only caller is
`ChatDetailPage.vue:2747-2764`, so the prop change is low-risk. It is opened as
a popover today; the sheet host is new, the row is not.

## R4. Group receipt timestamps already exist, and one of them is untrusted

**Decision**: Show `Receipt.deliveredAt` and `Receipt.seenAt` per member
(`src/db/types.ts:264-270`), and sanity-check `seenAt` before display.

**Rationale**: the three tier computeds in `MessageInfoPage.vue:399-424` already
sort by these timestamps and then throw them away with `.map(r => r.contactId)`.
The fix for FR-007 is to stop discarding them.

**The trust asymmetry that FR-034 exists for**:

| receipt | timestamp source | trusted |
|---|---|---|
| `sent` | `server/internal/ws/hub.go:1380` server clock | yes |
| `delivered` live | `hub.go:1402` server clock on the recipient's ack | yes |
| `delivered` reconciled | `deliveries.delivered_at` server DB | yes |
| **`seen` live** | **the viewer's own `Date.now()`**, forwarded verbatim (`src/composables/useSync.ts:628,685`; re-emitted unchanged at `hub.go:1420`) | **no** |
| `seen` reconciled | `seen.seen_at` server DB (`0020_seen.sql:17`) | yes |

So `deliveredAt` is always a server clock and `seenAt` on the live path is a
member's local clock. `ReceiptFrame` (`src/services/transport.ts:41-55`) carries
no `relayedAt`, unlike `MsgFrame` (`:29`).

**Approach**: rather than add a `relayedAt` to receipt frames (a wire change for
a display concern), clamp at display time using references we already hold:
a member's `seenAt` may not precede their own `deliveredAt`, and neither may
precede the message's `sentAt` (server clock, `hub.go:1380`), nor sit in the
future. The existing skew tolerance constant `CLOCK_SKEW_TOLERANCE_MS = 90_000`
(`src/utils/message-time.ts:29`) is the precedent and should be reused. This is
pure and unit-testable, which suits the TDD mandate.

## R5. Two existing bugs sit directly under this feature

Both are in `MessageInfoPage.vue:417-424` and both are fixed by touching the
same lines FR-007 already requires touching.

1. **`notDeliveredIds` reads the live roster, not the send-time roster.** It
   filters `chat.participantIds`, so a member who joined *after* the message was
   sent shows as "Not yet delivered" forever. Spec 1065's edge case says the
   denominator is the roster at send time, which is exactly what
   `message.receipts` is (a snapshot written at send: `queries.ts:467-469`,
   `:867`, `:2384-2386`, and never re-synced). Derive the tier from `receipts`.
2. **"Left the group" is not representable** — `leaveGroup`
   (`queries.ts:2261-2276`) and the receive side (`queries.ts:6094-6105`) simply
   splice the member out of `participantIds`. No storage change is needed for
   FR-011: a member present in `message.receipts` but absent from
   `chat.participantIds` has left. That is a derived predicate, not a new field.

## R6. Engagement paging needs a cursor and one index widening

**Decision**: Add `?limit=&before=` keyset paging to
`GET /v1/posts/{id}/engagement`, returning `{items, cursor, hasMore}`, and widen
the index to `(post_id, created_at, id)`.

**Rationale**: today `ListEngagement` (`store/posts.go:512-529`) is
`ORDER BY created_at ASC` with no LIMIT, and `syncEngagement`
(`queries.ts:4234`) refetches the entire history of a post on every
`post-engagement` WS frame. FR-035 and FR-036 forbid making that worse, and a
post with 500 reactions makes it bad. The existing index
`post_engagement_post_idx (post_id, created_at)` (`0021_posts.sql:41`) already
supports a forward page, but `created_at` is not unique, so a keyset cursor
needs `(created_at, id)` as the tiebreak and the index must carry `id` to stay a
pure index scan. That is a new forward-only migration, per Principle VI.

**Compatibility**: the change is additive. Existing clients that ignore `cursor`
still work, and the client dedupe is idempotent (comments and games key on the
server engagement id, `queries.ts:4257-4287`), so partial pages are safe to
apply.

**Ordering caution**: the API pages newest-first for the UI, but
`syncEngagement`'s reaction LWW (`queries.ts:4237-4256`) is order-independent
(it compares sealed `at`), so reversing page order does not corrupt state.

## R7. The parent reference rides sealed, and the row `kind` must not change

**Decision**: `parent` goes inside the sealed payload. Replies keep
`kind = "comment"`; comment reactions keep `kind = "reaction"`. No new `kind`
value, and the existing cleartext `target` field is deliberately **not** reused.

**Rationale**: `kind` is cleartext (`0021_posts.sql:36`), so a new
`kind = "commentreaction"` would tell the server that a reaction targets a
comment, breaking FR-031. Keeping the existing kinds means the server sees
exactly the row shape it sees today. The `target` field is cleartext by design
for tombstones (`posts_handlers.go:314-318`) and reusing it would publish the
whole reply graph at comment granularity.

**No leak from the local id scheme**: local reaction rows are keyed
`${postId}:reaction:${actor}:${emoji}` (`queries.ts:4179`), which does embed the
emoji, but the *server* row id is a fresh `uid()` (`queries.ts:4185`). The
emoji-bearing id never leaves the device. Comment reactions extend the local key
to include the parent comment id and stay equally local.

**Length side-channel, and the mitigation**: a sealed reaction payload is tiny
and uniform (`{emoji, at, remove}`), so adding a ~40-byte `parent` would make
comment reactions visibly longer than post reactions on the wire, leaking the
distinction that FR-031 forbids. Reaction payloads MUST therefore be padded to a
constant size before sealing. Ring has precedent for exactly this: spec 1055
pads push previews to a constant size for the same reason. Comment bodies
already vary in length by orders of magnitude, so a parent field adds no
distinguishable signal there and no padding is required for comments.

## R8. The wake hint is the one deliberate metadata addition

**Decision**: `engagementReq` gains an optional `notify: []string` naming the
users to wake. The server validates every entry against `PostAudience` and
pushes only to those, using the existing `activity` class.

**Rationale**: this is spec FR-031b, chosen by the requester with the cost shown.
It exists because the push recipient set is derived entirely server-side today
(`posts_handlers.go:359-393`: the `default` branch pushes to `PostAuthor` only)
and the server cannot read a sealed parent. The alternative of waking every
prior commenter adds zero metadata (the server already stores `actor` and
`kind`, exactly as `GameParticipants` exploits at `store/posts.go:404-419`) but
wakes people the notification rules do not name.

**What the server gains**: per reply, the tuple `(post, actor, recipient)` — who
a reply is addressed to. **What it still cannot see**: which comment was
answered, any text or emoji, and the size or shape of any thread.

**Mandatory guards**:
- Every `notify` entry is checked against `PostAudience`
  (`store/posts.go:345-362`) so the field cannot be used to wake a stranger.
- The list is capped (2 is all the rules ever need: post owner and the person
  answered) so it cannot become a broadcast primitive.
- It is used for routing and not persisted on the engagement row.
- It rides the existing `activity` class, so `AllowPush("activity", …)`
  (`push.go:413`) means a recipient's existing "Activity on your posts" opt-out
  keeps working for free (`push-prefs.ts:57`).

**Precedent for the shape**: chat already escalates a reply to the `mention`
class for the person quoted (`src/utils/frame-class.ts:34`,
`payload.reply?.senderId === member`), so "this frame personally addresses this
recipient" is metadata Ring already accepts in the messaging domain. The Wall
could not borrow the trick directly, because a group message is fanned out as N
individually-addressed sealed frames (`queries.ts:631-654`) while an engagement
is a single row with no `to` field.

## R9. Every push wake must end visibly, which bounds the design

**Constraint, not a decision**: `runGuardedWake` (`src/services/sw-inbox.ts:220-252`)
enforces that every service-worker wake ends shown or with licensed silence, and
`mayEndWakeSilently` (`:868-876`) returns false for every iOS browser. A wake
that previews to zero notes therefore shows the generic "Ring / New activity"
banner (`sw.ts:1244-1266`, `showQuietUnlessVisible`). The stakes are recorded at
`sw.ts:1294-1302`: about four silent pushes and iOS revokes the subscription.

**Consequence**: any design that wakes N devices so that one of them shows
something costs N-1 content-free banners. This is the concrete reason the
recipient set must be narrowed *before* `NotifyPostActivity`, and it is why R8's
`notify` hint is capped rather than generous.

## R10. Feed impressions use one shared observer

**Decision**: a single module-level `IntersectionObserver` at `threshold: 0.5`,
plus a 1000 ms dwell timer per post, unobserving a post once it has been
reported.

**Rationale**: FR-014. The repo's own precedent for a shared observer over many
rows is `src/directives/autoplay-visible.ts:52,118-120` (one module-level
observer behind a directive, rather than one per row). The one-shot
"count each row once, then unobserve" pattern is
`AllMediaPage.vue:279-297`. `ChatDetailPage.vue:3359-3380` already runs a
≥50%-visible observer over bubbles, so the threshold is consistent with how Ring
already decides something was seen. `AnimatedEmoji.vue:124-135` shows the
required capability guard (`'IntersectionObserver' in window`).

**Why per-post immediate reporting is affordable** (the requester's choice over
batching): FR-013 makes the first view the only one that counts, so a post is
reported at most once per person for all time. The device keeps a local
"already reported" set, so re-scrolling a feed costs nothing and only genuinely
new posts cost a request. `POST /v1/posts/{id}/view` is already idempotent
(`ON CONFLICT (post_id, viewer) DO NOTHING`, `store/posts.go:477-482`).

**WallPage is the risk**: it renders every post with no windowing at all,
including a live `ion-textarea` per post (`WallPage.vue:103,288`, `filteredWall`
at `:457-471`). FR-036 says do not make it worse. A count-first summary row that
defers the full list to a sheet is therefore the right shape, and the shared
observer must not add a per-post observer instance.

## R11. First-view-wins is already true server-side, and the client must stop discarding the time

**Decision**: no server change for FR-013. Fix the client.

**Rationale**: `RecordView` is `INSERT … ON CONFLICT (post_id, viewer) DO NOTHING`
(`store/posts.go:477-482`) against a table whose PK is `(post_id, viewer)` with
`viewed_at timestamptz DEFAULT now()` (`0021_posts.sql:44-49`). The first insert
wins and later views never overwrite, which is exactly FR-013, including across
a person's devices. `GET /v1/posts/{id}/views` already returns
`{viewer, viewedAt}` and is already author-gated server-side with a strict
equality check, not the looser audience check (`posts_handlers.go:486-494`) —
FR-033 is already satisfied. The client is the only broken part:
`listPostViews` (`queries.ts:4526-4534`) maps away `viewedAt`.

**Consequence for FR-017b**: `recordPostView` already returns early on
`post.outgoing` (`queries.ts:4515`), so the author never views their own post.
That behaviour must be preserved when the call site moves to the feed.

## R12. Where the notification decision actually lives

**Decision**: extend the existing pure predicate rather than adding a
notification path.

**Rationale**: `src/services/wall-activity-policy.ts:48-58` (`wallActivityAlert`)
is a pure, unit-tested function whose first line is `if (!i.isOwnPost) return 'skip'`.
FR-029a requires alerting a non-owner (the person answered), so that predicate
gains a "this reply answers my comment" input. Keeping the decision in that pure
function preserves its testability and keeps the closed-app classifier
(`sw-inbox.ts:1774-1802`) and the live path (`queries.ts:3808-3852`) agreeing.

**Note**: the closed-app classifier never decrypts comment payloads today
(`buildPostActivityNotes` uses the static string "commented on your post",
`sw-inbox.ts:1897-1912`). Deciding "did this reply answer *my* comment" requires
opening the sealed parent, so the SW must now decrypt comment payloads too. It
already decrypts reaction payloads to read the `remove` flag (`:1789-1790`) and
already calls `sodiumReady()` on this path (`:1921-1993`), so the machinery
exists. Cost is one more decrypt per candidate row inside an already
deadline-guarded wake (`PUSH_DEADLINE_MS = 20000`, `sw.ts:1346`), which the
bounded page from R6 keeps small.

## R13. Test surfaces that already exist

- `e2e/group-seen-receipts.spec.ts` covers spec 1010 by asserting on the
  sender's `receipts[]` through the `messageReceipts` test hook
  (`src/services/testhook.ts:641`). No test renders `MessageInfoPage.vue` today,
  so US1 needs the first one.
- `src/services/message-status.test.ts` unit-tests the receipt reducers, which
  is where the FR-034 clamp belongs.
- `src/utils/chat-window.test.ts` is the model for testing a pure paging helper.
- Server handlers each have a sibling `_test.go` against the in-memory fake
  store, so the cursor paging and the `notify` audience validation get unit
  tests with no database.

## Open items carried into the plan

- The constitution's `--ring-*` token naming does not match the codebase's
  `--app-*`. Noted, not fixed here.
- `PostDetailPage.vue:416-422` carries a divergent local copy of `ago()` that
  never falls back to a date. Worth collapsing onto `src/utils/post-time.ts:33`
  while the file is open, since this feature adds more relative times to it.
