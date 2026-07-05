# Research: Game Challenges in Groups and on the Wall

**Spec**: [spec.md](spec.md) | **Date**: 2026-07-05

Decisions grounded in the shipped 0008 platform and verified against the code
(file:line evidence checked before each decision).

## D1. Group roles: explicit `players` seats, 1:1 stays direction-derived

- **Decision**: additive `GameSession.players?: [string] | [string, string]`
  (challenger first, acceptor second). Sessions WITHOUT `players` keep 0008's
  direction-derived roles untouched.
- **Rationale**: `gameSelfPlayer = m.outgoing ? 0 : 1` (`queries.ts:806`) is
  meaningless in groups (every non-sender has `outgoing:false`) but load-bearing
  in four shipped 1:1 places. One new helper (`gameSelfIndex`) branches on
  `players` presence; the shipped path stays byte-identical.
- **Rejected**: migrating 1:1 to explicit players — rewrites shipped code for
  zero user value.

## D2. Accept race: pure data ordering + a seq-1 seat lock

- **Decision** (in new pure `src/games/challenge.ts`): every device appends every
  accept (`{userId, at}`, dedup by user, creator/non-member dropped); the derived
  seat is `min(accepts)` by `(at asc, userId asc)`; the seat LOCKS when the
  challenger plays seq 1, whose `GameMoveSignal.opponent` stamps the resolved
  seat as wire data. After lock, further accepts drop.
- **Rationale**: pure ordering makes pre-lock convergence arrival-order-free;
  the lock makes the final answer identical everywhere even if an earlier-`at`
  accept is still in flight when play starts — the only closure that never
  invalidates already-played moves. Race losers see "{Name} got there first".
- **Caveat (documented in the contract)**: an accept still in transit at lock
  time loses despite an earlier stamp; sender-claimed clocks can win the seat
  (contained: wrong friend gets the seat, everyone still converges — same
  tamper-containment stance as 0008).

## D3. Cancel: deterministic and race-safe without coordination

- **Decision**: `cancelledAt` set AND `moves.length === 0` ⇒ withdrawn. Accepts
  never override a cancel; only the challenger can start play, and a cancelling
  challenger never moves.
- **Rationale**: a cancel/accept crossing in flight converges (briefly
  "accepted" on some devices, then withdrawn everywhere) with no extra signals.

## D4. Group wire: new kind + separate side-effect fields

- **Decision**: challenge start = new kind `'gamechallenge'` + payload field
  `gameChallenge: {gameType, theme?}`; accept = `gameAccept: {messageId, at}`;
  cancel = `gameCancel: {messageId, at}`; existing `gameMove` gains additive
  `opponent?` (seq 1 of explicit-players sessions only).
- **Rationale**: reusing `kind:'game'` would make 0008-era group members render
  a PLAYABLE board with garbage direction-derived roles (`queries.ts:4952`); a
  new kind gets the safe unknown-kind fallback. Accepts must not be `gameMove`
  actions: the engine's seq-slot rules (dedupe/conflict/gap) would out-of-sync
  honest racers — accepts are seq-less by nature.
- **Version-skew note**: pre-0009 members receiving `gameAccept`/`gameCancel`
  store one stray unknown-kind fallback bubble each (`queries.ts:4928` falls
  through). Bounded, consistent with the spec's skew assumption, documented.

## D5. Non-player signals: drop, never out-of-sync

Signals from users not in `players` (racing acceptors, skewed clients) are
dropped silently — extends contract §3 tolerance so the honest board can't be
poisoned into 😵 by a third party.

## D6. Player leaves the group: local synthetic resignation

On the roster card that removes a player (`handleGroupCard 'leave'`,
`queries.ts:4558`), every member locally applies a resign with `at = card.at` —
no wire signal needed; identical inputs ⇒ identical derived outcome everywhere.

## D7. Follow: one device-local settings key

- **Decision**: `games.follows: Record<gameId /* messageId|postId */, followedAt>`
  via settings; explicitly NOT in `SYNCED_PREF_KEYS` (spec: device-local,
  private). Pruned when the target disappears.
- **Rationale**: uniform for bubbles and posts; survives message-row rewrites;
  the SW already reads the settings store, so `previewPending` can gate follower
  notes; nothing about following ever crosses the wire (FR-006).

## D8. Wall challenge = ordinary post + sealed `game` engagement records

- **Decision**: `PostPayload.game: {gameType, theme?}` additive, post kind stays
  `'text'` with fallback body copy ("🎮 Tic-tac-toe challenge — update Ring to
  play") so pre-0009 audiences see a harmless text post. Accepts and moves are
  engagement records of a NEW kind `game`, sealed under K_post like
  reactions/comments: `{t:'accept',at}` / `{t:'move',seq,action,move?,at,opponent?}`.
  Actor identity = the server-attested `actor` (same trust anchor as reactions).
- **Server verdict (verified in Go)**: `validEngagementKind` allows only
  `reaction|comment|tombstone` (`posts_handlers.go:222-224`) → ONE line adds
  `game`; the `post_engagement.kind` column is free text
  (`0021_posts.sql:37`) → NO SQL migration; store code passes kind through
  opaquely. Smuggling under existing kinds was rejected: it renders as blank
  comments / garbage reactions on pre-0009 clients (visible corruption).
- **Rate/lifetime**: the 60/min actor cap dwarfs a ≤10-record game; game `at`s
  feed the existing keep-alive bump so an active game keeps its post alive; post
  expiry/prune deletes the whole game (SC on lifetime holds).

## D9. Wall convergence: full deterministic replay from the pulled set

`buildWallSession(authorId, gameInfo, rows)` (pure): dedupe rows by engagement
id; accepts → D2's seat rule; moves sorted `(seq, at, actorId, id)` through the
0008 engine with `playerIndexOf` mapping. Every device eventually pulls the same
full set ⇒ same session. Local moves: sync-first, validate, optimistic row,
submit. Forks render 0008's terminal 😵.

## D10. Wall freshness: WS nudge online + audience-wide content-free push (user decision)

The existing `post-engagement` WS nudge already fans to the whole ONLINE
audience (`posts_handlers.go:306`) → live boards while the app is open. For
closed apps, the author-only web push (spec 1031, `posts_handlers.go:326`)
EXTENDS for `kind=='game'` engagement to the full audience — still content-free
(the device pulls, decrypts, and decides locally from its turn/follow settings
whether to surface anything). Chosen over on-open-only freshness by the product
decision 2026-07-05: a turn-based game must be able to tell its player "your
move" while the app is closed.

## D11. Announcement animation + cues (from docs/ANIMATED-EMOJI.md, all verified)

Challenge hero: 🫵 `1faf5` + 🎲 `1f3b2` (call-to-action genre), entrance-animated
like the result overlay; accept moment: 💪 `1f4aa`; race-lost: 😅 `1f605`;
withdrawn: 🫠 `1fae0`. New synthesized cues `gamechallenge` (inviting triple) and
`gameaccept` (bright confirmation) in `sound.ts`. Usage table updated.

## D12. Notification prefs

`notifications.games.turn / .challenges / .followMoves / .followResults`, all
default on, in a "Game notifications" schema group; the four keys join
`SYNCED_PREF_KEYS` (like other `notifications.*`), `games.follows` does not.
Existing `notifications.gameSounds` moves beside the group.
