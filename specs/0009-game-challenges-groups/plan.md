# Implementation Plan: Game Challenges in Groups and on the Wall

**Branch**: `feat/0009-game-challenges-groups` | **Date**: 2026-07-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/0009-game-challenges-groups/spec.md`

## Summary

Group chats and the Wall gain open game challenges: the first member (or audience
member) to accept becomes the opponent; everyone else observes quietly, with a
device-local Follow for opt-in move/result alerts. Groups reuse the shipped 0008
engine end-to-end — challenge/accept/cancel/move signals ride the existing sealed
sender-key fan-out, roles move from direction-derived to explicit `players` seats
(1:1 sessions stay untouched), and a new pure `src/games/challenge.ts` resolves
accept races deterministically. Wall challenges are ordinary posts whose game
plays out ON the post: accepts and moves are sealed engagement records of a new
kind `game`, replayed deterministically from the pulled set. Group story: zero
server changes. Wall story: two minimal server behaviors — the engagement-kind
allowlist gains `game`, and the existing content-free wall push fans to the
whole audience for game engagement (author-only today) so turns and follows
wake closed apps. The server still stores and pushes only opaque/content-free
data.

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 + Ionic PWA); Go 1.26 for the one-line
server allowlist change

**Primary Dependencies**: spec 0008's game platform (registry, pure session
engine, GameBubble, cues, notification paths); group sender keys
(`sealAndEnqueueGroup`, `queries.ts:503`); Wall stack (`posts.ts` K_post sealing,
engagement submit/sync, `posts_handlers.go`)

**Storage**: IndexedDB — additive `players`/`challenge` fields on `GameSession`
(no DB_VERSION bump); `PostEngagement` union gains `'game'`; Follow set is a
device-local settings key `games.follows` (NOT own-data-synced, by spec FR-006)

**Testing**: vitest (pure challenge/accept-race + wall replay + SW gating),
Playwright 3-account group e2e + wall e2e, drive scenarios

**Target Platform**: installable PWA, as 0008

**Project Type**: web app; client + one-line Go handler change + Go test

**Performance Goals**: tic-tac-toe ≤ 9 moves + 1 accept per game — trivial for
the 60/min engagement rate cap and the WS nudge fan-out

**Constraints**: deterministic convergence of the opponent seat on every device
(accept-race rule + seq-1 lock); observers silent by default; version skew safe
(new kinds/fields degrade to fallbacks, never corrupt)

**Scale/Scope**: 1 new pure module, ~10 client files touched, 1 server line,
2 new e2e specs

## Constitution Check

- **I. Zero-Knowledge Boundary**: PASS with one justified metadata note — all
  challenge/accept/move content is sealed everywhere. Group story adds NOTHING
  server-visible. Wall story adds the engagement kind string `game` (the server
  already distinguishes `reaction|comment|tombstone` the same way); payloads
  stay sealed under K_post. Spec's ZK section updated accordingly; the
  Complexity table below carries the justification.
- **II. Spec-Driven**: PASS — spec 0009 specified + clarified; this is stage 3.
- **III. TDD**: PASS — tasks order the pure challenge/replay suites, SW gating
  suites, and failing e2e before wiring.
- **IV. Crypto Discipline**: PASS — no new primitives; sender keys and K_post
  sealing reused as-is; `messaging.ts` untouched.
- **V. Offline-First**: PASS — additive optional fields, no migration; wall
  session is derived (replay-not-store doctrine).
- **VI. Stateless Server & Migrations**: PASS — no schema change
  (`post_engagement.kind` is free text, `0021_posts.sql:37`); the allowlist
  edit and the audience push fan-out ship with handler tests.
- **VII. Gates**: PASS — build/vet/test/e2e; release-note commit subjects.
- **VIII. Traceability**: PASS — taskstoissues + Closes list.
- **IX–XI**: PASS — no telemetry; Ionic-first bubble faces; copy voice.

## Project Structure

### Documentation (this feature)

```text
specs/0009-game-challenges-groups/
├── spec.md, plan.md, research.md, data-model.md
├── contracts/
│   ├── challenge-payload.md       # sealed message-channel signals (groups)
│   └── wall-game-engagement.md    # sealed engagement records (wall)
├── checklists/                    # zero-knowledge checklist (required)
└── tasks.md
```

### Source Code

```text
src/games/challenge.ts                 # NEW — pure: accept-race resolution, phases,
                                       #   playerIndexOf, buildWallSession replay
src/games/types.ts                     # GameSession.players/.challenge (additive)
src/services/crypto/message.ts         # gameChallenge / gameAccept / gameCancel fields;
                                       #   GameMoveSignal.opponent (seq-1 seat lock)
src/services/crypto/post.ts            # PostPayload.game (additive)
src/db/types.ts                        # MessageKind 'gamechallenge'; Post.game;
                                       #   PostEngagement 'game'
src/db/queries.ts                      # sendGameChallenge/accept/cancel + dispatch;
                                       #   handleGameMove group branch (playerIndexOf);
                                       #   gameSelfIndex; leave→synthetic resign;
                                       #   hasOngoingGame counts open challenges;
                                       #   wall: createPost game, syncEngagement 'game'
                                       #   branch, playWallGameMove
src/components/ChallengeBubble.vue     # NEW — challenge face wrapping GameBubble
src/components/GameBubble.vue          # players/observer mode; Follow toggle
src/views/detail/ChatDetailPage.vue    # group Game entry, gamechallenge branch
src/views/detail/PostComposerPage.vue  # Challenge attachment → GamePicker
src/views/tabs/WallPage.vue + PostDetailPage.vue  # wall game card
src/services/sw-inbox.ts               # group gameMove players-only + follow gating
src/services/game-sounds.ts            # 'gamechallenge' / 'gameaccept' cues
src/settings/schema.ts                 # Notifications → Game notifications group
src/services/ownsync-keys.ts           # sync the 4 pref keys (NOT games.follows)
server/internal/api/posts_handlers.go  # validEngagementKind += 'game'; audience-wide
                                       #   content-free push for kind=='game' engagement
server/internal/api/posts_handlers_test.go  # tests for both behaviors
```

**Structure Decision**: existing single web app + the minimal server allowlist
edit. All new game logic stays pure under `src/games/` per 0008's discipline.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|-----------|------------|--------------------------------------|
| Server learns the engagement kind string `game` (one allowlist line) | Wall moves must ride the sealed engagement channel so the post IS the board (user decision) | Smuggling game payloads as `comment`/`reaction` kinds corrupts pre-0009 clients' feeds (blank comments / garbage reactions) — visible data corruption vs. one metadata word the server already has for reactions vs comments |
| Content-free wall push fans to the audience for `game` engagement (author-only today) | Offline turn/follow alerts for Wall games (user decision 2026-07-05) | On-open-only freshness was offered and declined — a turn-based game whose players never learn it is their turn while the app is closed defeats the feature |
