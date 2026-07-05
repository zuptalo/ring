# Tasks: Game Challenges in Groups and on the Wall

**Input**: Design documents from `/specs/0009-game-challenges-groups/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED — constitution Principle III: failing tests precede the
implementation that satisfies them, committed failing first.

## Format: `[ID] [P?] [Story] Description`

- **[Story]**: US1 (group challenge core), US2 (observers/follow/notifications), US3 (wall)

## Phase 1: Foundational (Blocking Prerequisites)

- [X] T001 [P] Write FAILING unit tests `src/games/challenge.test.ts`: seat = min(accepts) by (at, userId) with tie-break; permutation invariance (any apply order → same seat); seq-1 `opponent` lock beats a later-arriving earlier-`at` accept; cancel-vs-accept race (cancel wins iff no moves); creator self-accept and non-member accepts dropped; signals from non-players DROPPED (never out-of-sync); `playerIndexOf` mapping incl. null; `challengePhase` transitions
- [X] T002 [P] Write FAILING unit tests for `buildWallSession` (same suite): replay from engagement rows — permutations, duplicates by engagement id, accepts→seat, moves sorted (seq, at, actorId, id) through the 0008 engine, fork → out-of-sync terminal, non-player rows dropped
- [X] T003 Implement pure `src/games/challenge.ts` (accept-race resolution, phases, applyAccept/applyCancel, playerIndexOf, buildWallSession). T001+T002 green
- [X] T004 [P] Wire + storage types: `GameSession.players`/`challenge` and `GameMoveSignalShape.opponent` in `src/games/types.ts`; `gameChallenge`/`gameAccept`/`gameCancel` fields + `GameMoveSignal.opponent` in `src/services/crypto/message.ts`; `'gamechallenge'` in `MessageKind` (`src/db/types.ts`)
- [X] T005 [P] Extend `src/games/session.test.ts` with a 1:1-unchanged regression block (direction-derived sessions behave byte-identically with the new fields absent)

## Phase 2: US1 — group challenge core

- [X] T006 [US1] Testhooks (`sendGameChallenge`/`acceptGameChallenge`/`cancelGameChallenge`; `gameInfo` gains `players`/`phase`) + FAILING e2e `e2e/games-group.spec.ts` (3 accounts, precedent games.spec + groups e2e): challenge visible to all with challenger named; first accept seats the acceptor everywhere; observer moves refused; creator cannot self-accept; win → result overlay on all three; accept race across an offline gap converges (both accepters, one seat, same on all devices); cancel → withdrawn; a PLAYER leaving the group ends the game as their resignation on every remaining device; open challenge engages the one-game gate; Play again → fresh open challenge
- [X] T007 [US1] `src/db/queries.ts`: `sendGameChallenge` (kind `'gamechallenge'`, session `{players:[self], challenge:{accepts:[]}}`, group fan-out), `acceptGameChallenge`/`cancelGameChallenge` (+local apply via challenge.ts), `handleGameAccept`/`handleGameCancel` dispatch beside `payload.gameMove`, `handleGameMove` group branch (playerIndexOf mapping, seq-1 `opponent` stamp/verify, drop non-players), `gameSelfPlayer`→`gameSelfIndex` (players+selfId when present), `hasOngoingGame` counts open challenges, group-leave → local synthetic resign at the roster card's `at`, store path builds sessions from `payload.gameChallenge`
- [X] T008 [US1] UI + cues: `ChallengeBubble.vue` (animated 🫵🎲 announcement, Accept, creator Cancel, "got there first 😅", withdrawn 🫠) wrapping an observer-capable `GameBubble` (players/selfId/memberNames props, read-only board for observers, result overlay for all); `ChatDetailPage.vue` group Game entry + `'gamechallenge'` branch + group rematch = picker; previews (`message-preview.ts`) for challenge/accept; `sound.ts` recipes `gamechallenge`/`gameaccept` (+sound.test extension red-first inside this task)

## Phase 3: US2 — quiet observers, follow, notification settings

- [X] T009 [US2] FAILING tests: SW unit (`sw-inbox.games` extension) — group gameMove notifies ONLY the next-turn player, follow-gated observer note, accept note to the challenger ("{Name} accepted your challenge 💪"), each `notifications.games.*` pref silences its lane; e2e additions — C stays silent through a full game, C follows → per-move + result cues recorded, C unfollows → silent
- [X] T010 [US2] Follow storage (`games.follows` device-local settings helpers + prune) and Settings schema "Game notifications" group (`notifications.games.turn/.challenges/.followMoves/.followResults`, all default on; `gameSounds` moves beside it); the four pref keys join `SYNCED_PREF_KEYS` (`ownsync-keys.ts`) — `games.follows` deliberately does NOT
- [X] T011 [US2] Routing implementation: page path (`handleGameMove` group branch + accept/cancel handlers decide player-turn vs follower vs silent, behind prefs + existing mute/content gates) and SW path (`sw-inbox.ts` group gameMove/gameAccept branches using the prefetched game row, `players`, selfId, follow set + prefs passed from `previewPending`)

## Phase 4: US3 — the Wall

- [X] T012 [US3] Server (test-first): failing cases in `server/internal/api/posts_handlers_test.go` — engagement kind `game` accepted + stored opaquely; game engagement push fans to the FULL audience (author-only for other kinds, spec-1031 behavior preserved); then implement both in `posts_handlers.go` (`validEngagementKind` + push fan-out). `go build/vet/test` green
- [X] T013 [US3] FAILING e2e `e2e/games-wall.spec.ts` (precedent wall.spec): audience-scoped challenge post (outside-audience account sees nothing), first accept seats, play a full game over engagement records with both players converging, observer board updates on wall open, post deletion prunes the game everywhere
- [X] T014 [US3] Client wall plumbing: `PostPayload.game` + fallback body copy (`crypto/post.ts`), `Post.game` (`db/types.ts` + create/receive in `queries.ts`), `PostEngagement` type `'game'` + `syncEngagement` branch + keep-alive bump, `acceptWallChallenge`/`playWallGameMove`/`resignWallGame` (sync-first, validate via `buildWallSession`, optimistic row, submit), testhooks
- [X] T015 [US3] Wall UI: PostComposer "Challenge" option → GamePicker; Wall feed + PostDetail game card (challenge face → live board via `buildWallSession`, Follow toggle, result overlay); wall-game alert policy while online (WS `post-engagement` nudge → banner for turn/followed, mirroring `wall-activity-policy` precedent) and SW push path (woken device pulls, derives, decides from prefs + follows)

## Phase 5: Polish

- [X] T016 [P] Drive scenarios: 3-user group challenge (announcement, accept, observer board, race-lost line) + wall challenge; screenshots reviewed
- [X] T017 Docs + gates: `docs/ANIMATED-EMOJI.md` usage rows (🫵 challenge, 💪 accept, 🫠 withdrawn); spec Status lifecycle + `make roadmap`; full gate suite (`npm run build`, unit+coverage, both new e2e specs, `go build/vet/test`); verify the server diff is EXACTLY the two posts_handlers behaviors

## Dependencies

Foundational (T001-T005) blocks everything. US1 (T006-T008) blocks US2/US3.
T012 (server) is independent after Foundational and can run parallel to US1.
US2 needs T007/T008; US3 client work (T013-T015) needs T003+T012.

## GitHub Issues

One issue per task (created 2026-07-05; the feature → develop PR must list Closes #N for each):
T001 #812 · T002 #813 · T003 #814 · T004 #815 · T005 #816 · T006 #817 · T007 #818 · T008 #819 · T009 #820 · T010 #821 · T011 #822 · T012 #823 · T013 #824 · T014 #825 · T015 #826 · T016 #827 · T017 #828
