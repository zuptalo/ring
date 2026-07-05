# Tasks: In-Chat Turn-Based Games

**Input**: Design documents from `/specs/0008-chat-turn-based/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/game-payload.md

**Tests**: REQUIRED — constitution Principle III mandates failing tests before the
implementation that satisfies them (Red → Green → Refactor). Test tasks below precede
their implementation tasks and MUST be committed failing first.

**Organization**: Grouped by user story so each story is an independently testable
increment. US1 alone is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (play tic-tac-toe), US2 (resign/rematch), US3 (know it's your move)

## Phase 1: Setup

**Purpose**: The `src/games/` plugin skeleton every story builds on

- [X] T001 Create `src/games/types.ts` with the `GameModule<S, M>` interface, `GameSession`, `GameMoveRec`, and `GameStatusResult` types exactly as specified in `specs/0008-chat-turn-based/contracts/game-payload.md` and `data-model.md`; create empty-catalog `src/games/registry.ts` (`export const GAMES: Record<string, GameModule> = {}`) and empty `src/games/boards.ts` (id → component map, the only Vue-importing file in the directory — state this rule in a header comment)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure rules engine, session engine, wire types, and storage types — every
user story depends on these

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Write FAILING unit tests for tic-tac-toe rules in `src/games/tictactoe/logic.test.ts`: initial state is 9 empty cells with player 0 to move; legal move fills a cell and flips turn; occupied cell → null; all 8 win lines detected with correct winner; full board with no winner → draw; status of fresh/mid/terminal boards; determinism (same moves → same state)
- [X] T003 [P] Write FAILING unit tests for the game-agnostic session engine in `src/games/session.test.ts`: replay of a valid log derives the expected state; duplicate seq with identical content → dropped, no state change; same seq with different content → `outOfSync`; seq gap → `outOfSync`; out-of-turn sender → `outOfSync`; illegal move → `outOfSync`; any signal after terminal (won/draw/resigned/outOfSync) → dropped; resign from either player while ongoing → `resignedBy` set, terminal; validation order matches data-model.md rules 1–7
- [X] T004 Implement pure tic-tac-toe rules in `src/games/tictactoe/logic.ts` (`createInitialState`, `applyMove`, `turn`, `status` — pure, never throws) and the module in `src/games/tictactoe/index.ts` (id `'tictactoe'`, displayName, ionicon, players: 2); register it in `src/games/registry.ts`. T002 must pass
- [X] T005 Implement the session engine in `src/games/session.ts`: `applySignal(session, module, signal, senderPlayer)` implementing data-model.md validation rules 1–7 plus `deriveStatus(session, module)`; pure functions over `GameSession`, no IndexedDB imports. T003 must pass
- [X] T006 [P] Add wire types to `src/services/crypto/message.ts`: `GameStart` (`{ gameType }`) and `GameMoveSignal` (`{ messageId, seq, action: 'move' | 'resign', move?, at }`) interfaces, `game?: GameStart` and `gameMove?: GameMoveSignal` optional fields on `MessagePayload`, `'game'` added to the payload kind docs — additive only, per `contracts/game-payload.md`
- [X] T007 [P] Add storage types to `src/db/types.ts`: `GameSession`/`GameMoveRec` (import or re-declare per file conventions), `'game'` in the `MessageKind` union (~line 157) and the `lastKind` union (~line 59), and optional `game?: GameSession` on the `Message` row (like `poll?: Poll` at ~line 210). No `DB_VERSION` change

**Checkpoint**: `npm run test:unit -- src/games` green; `npm run build` typechecks

---

## Phase 3: User Story 1 - Play tic-tac-toe inside a 1:1 chat (Priority: P1) 🎯 MVP

**Goal**: Start a game from the attach menu; interactive bubble on both devices; strict
validated turn alternation; win/draw shown identically on both sides; one game per chat

**Independent Test**: Two paired accounts play to a win and to a draw; both sides show
identical boards and results; Game entry disabled while a game is ongoing

### Tests for User Story 1 (write first, commit failing)

- [X] T008 [US1] Extend `src/services/testhook.ts` with dev-only `sendGame(chatId, gameType)` and `playGameMove(chatId, messageId, move)` hooks (pattern: existing poll hooks; stripped from production builds), then write FAILING e2e `e2e/games.spec.ts` (model on `e2e/reactions.spec.ts`): A starts tic-tac-toe → bubble visible on both sides; B cannot move first / cannot move out of turn; alternate moves to a win → both sides show winner; separate game to a draw → both show draw; while a game is ongoing the attach sheet's Game entry is disabled (FR-001a); an offline gap converges — close B's page mid-game, A plays a move, B reopens and the board catches up identically (FR-018/SC-003); the message action menu on a game bubble offers no Forward (FR-014)

### Implementation for User Story 1

- [X] T009 [US1] Implement send path in `src/db/queries.ts`: `sendGame(chatId, gameType)` mirroring `sendPoll()` (~line 709: `newOutgoing` → `put('messages')` → `bumpOutgoing` → `enqueueMessage`) with `kind: 'game'`, payload `game: { gameType }`, and `Message.game` initialized to `{ gameType, moves: [] }`; plus `hasOngoingGame(chatId)` helper that scans the chat's messages for a session whose derived status is ongoing (FR-001a gate)
- [X] T010 [US1] Implement move path in `src/db/queries.ts`: `playGameMove(chatId, messageId, move)` mirroring `votePoll()` (~line 786) — pre-validate locally via the session engine (refuse silently if not your turn / not ongoing), append via shared `applyGameMove()` (like `applyPollVote()` ~line 770), send `gameMove` signal; and inbound `handleGameMove()` dispatched from `receiveIncoming` beside `handlePollVote` (~lines 4647-4651), resolving `messageId` via the sender's `remoteId` mapping (~line 4745) and applying through the session engine; persist inbound bubbles' `game: { gameType, moves: [] }` beside `poll` (~line 4761)
- [X] T011 [US1] Exclusions in `src/db/queries.ts`: game bubbles excluded from forwarding (kind check in the forward path, ~line 1041, FR-014) and `gameMove` signals re-sealed correctly on send retry (~lines 1778-1803, pattern: pollVote retry)
- [X] T012 [P] [US1] Create `src/games/tictactoe/TicTacToeBoard.vue`: 3×3 board composed from `ion-grid`/`ion-row`/`ion-col` with themed cell buttons (`--ring-*` tokens only), props `{ state, myPlayer, canMove }`, emits `move(cell)`; cells carry aria-labels (row/column/contents); register in `src/games/boards.ts`
- [X] T013 [US1] Create `src/components/GameBubble.vue`: renders the board component from `boards.ts` by `gameType` (unknown type → "update Ring to play" fallback), shows game name, status line ("Your turn" / "Their turn" / winner / draw / "Game out of sync"), derives everything via the session engine from `message.game`; emits `move`; stock Ionic chrome, PollBubble-sized
- [X] T014 [P] [US1] Create `src/components/GamePicker.vue`: `ion-modal` with an `ion-list` of the registry (`GAMES`) entries (icon + name), emits the chosen `gameType`
- [X] T015 [US1] Wire up `src/views/detail/ChatDetailPage.vue`: "Game" entry in the `openAttach()` action sheet (~lines 3790-3803) shown only in 1:1 chats and disabled with a brief note while `hasOngoingGame(chatId)` (FR-001a); opens GamePicker → `sendGame`; render `GameBubble` beside the `PollBubble` branch (~line 380) with a `move` handler calling `playGameMove`

**Checkpoint**: `e2e/games.spec.ts` US1 cases green — a complete, shippable MVP

---

## Phase 4: User Story 2 - Resign and play again (Priority: P2)

**Goal**: Graceful exit from an ongoing game; one-tap rematch from any finished game

**Independent Test**: Resign an ongoing game → both sides show conceded result; "Play
again" from a finished bubble starts a fresh playable game; old bubble unchanged

### Tests for User Story 2 (write first, commit failing)

- [X] T016 [US2] Add dev-only `resignGame(chatId, messageId)` to `src/services/testhook.ts`, then extend `e2e/games.spec.ts` with FAILING cases: B resigns mid-game → both sides show A won by concession and board is locked; "Play again" from the finished bubble creates a new playable bubble (chooser moves first) while the finished bubble keeps its final board

### Implementation for User Story 2

- [X] T017 [US2] Implement `resignGame(chatId, messageId)` in `src/db/queries.ts`: session-engine pre-validation (only while ongoing), sends `gameMove` with `action: 'resign'` at the next seq, applies locally via `applyGameMove()`; inbound resign already flows through T010's `handleGameMove`
- [X] T018 [US2] Extend `src/components/GameBubble.vue`: "Resign" affordance while ongoing (confirm via `ion-alert`), "Play again" button on every terminal state (won/draw/resigned/out-of-sync) that emits `rematch` → `ChatDetailPage.vue` calls `sendGame` with the same `gameType` (respecting the FR-001a gate; new bubble, chooser = player 0)

**Checkpoint**: US1 + US2 e2e green

---

## Phase 5: User Story 3 - Know when it's your move (Priority: P3)

**Goal**: Chat-list previews and privacy-gated "Your move" notifications keep slow games
alive

**Independent Test**: Opponent's move with app backgrounded/closed produces a "Your move"
notification (none when muted; content-free in generic/hidden modes); chat list preview
shows game activity

### Tests for User Story 3 (write first, commit failing)

- [X] T019 [P] [US3] Write FAILING unit tests for preview strings: game-start and game-move preview lines in the existing test homes of `src/utils/message-preview.ts` and `src/services/notify-preview.ts` (colocated `.test.ts`, following each file's existing test pattern); cases: new game bubble → "Tic-tac-toe", incoming move → "Your move", unknown gameType → generic "Game"; plus gate assertions against the notification-decision path: muted chat → no notification for game signals, generic/private mode and hidden chats → content-free output identical to an ordinary message's (SC-007; unit-level — full push e2e is known-flaky in CI)
- [X] T020 [US3] Extend `e2e/games.spec.ts` with FAILING assertions: after a game starts / a move arrives, the recipient's chat-list preview line reflects the game (`lastKind: 'game'` icon + text)

### Implementation for User Story 3

- [X] T021 [P] [US3] Implement preview strings: `kind: 'game'` case in `src/utils/message-preview.ts` (~lines 27-49), `src/services/notify-preview.ts` (~line 13), and the `PREVIEW_ICONS` map in `src/components/ChatListItem.vue` (~line 109); game-move activity bumps the chat preview like `handleReaction` does (~`src/db/queries.ts:630-635`)
- [X] T022 [US3] Page-path notification: in the `notifyIncoming` flow, incoming `gameMove` in a chat that is not open notifies "Your move"; incoming game bubble notifies via the normal new-message path with the game preview — both strictly behind the existing mute/generic/hidden gates (FR-011/FR-012)
- [X] T023 [US3] SW path: `src/services/sw-drain.ts` defers `gameMove` signals to the page (~line 123, beside `pollVote`) and persists `game` on eligible full-persist rows (~line 241); `src/services/sw-inbox.ts` adds the "Your move" / "Wants to play Tic-tac-toe" notification branch (~lines 259-266) — the deliberate divergence from silent poll votes — reusing the existing hidden/generic/mute gating exactly

**Checkpoint**: All three stories independently functional; SC-007 privacy behavior verified

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T024 [P] Add `drive/scenarios/tictactoe.mjs` using `drive/driver.mjs` (createAccount/pair/say/shot/sweep): two users play to a win, screenshots of the bubble states land in `.tmp/drive/`
- [X] T025 [P] Accessibility + i18n pass over `GameBubble.vue`, `GamePicker.vue`, `TicTacToeBoard.vue`: aria-labels on cells and actions, focus order, RTL-neutral layout check, all user-visible strings through the app's existing copy conventions (warm, plain, "you"; no em-dashes/semicolons)
- [X] T026 Update `specs/0008-chat-turn-based/spec.md` `**Status**:` to `in-progress` at implementation start (already due) → `in-review` at PR time, and run `make roadmap` so the CI roadmap guard stays green
- [X] T027 Run the full gate suite and the zero-knowledge proof point: `npm run build`, `npm run test:unit` (coverage floors), `npm run test:e2e`, and verify `git diff --stat develop -- server/` is empty; validate `specs/0008-chat-turn-based/quickstart.md` steps as written

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: needs T001. T002/T003 (tests) first and in parallel; T004 needs T002, T005 needs T003+T004 (engine calls the module in tests); T006/T007 parallel with T002-T005
- **US1 (Phase 3)**: needs Phase 2 complete. T008 (e2e, failing) first; T009 → T010 → T011 sequential (same file `queries.ts`); T012/T014 parallel; T013 needs T012; T015 last (wires everything)
- **US2 (Phase 4)**: needs US1 (extends its flows). T016 first, then T017 → T018
- **US3 (Phase 5)**: needs US1 only (notification/preview of US1's signals). T019/T020 first; T021 parallel with T022; T023 last (touches SW paths)
- **Polish (Phase 6)**: T024/T025 parallel anytime after US1; T026/T027 last

### Parallel Opportunities

- T002 ∥ T003 (different test files); T006 ∥ T007 ∥ (T002-T005)
- Within US1: T012 ∥ T014 while T009-T011 proceed in `queries.ts`
- US3 can start in parallel with US2 once US1 is green (different files except `games.spec.ts` — coordinate e2e additions)

---

## Implementation Strategy

## Phase 7: Follow-up UX (user feedback, 2026-07-05)

**Purpose**: FR-019/FR-020/FR-021 (added post-implementation) + an iOS rendering bug:
glanceable turn state via existing animated emoji, a "you play ✕" legend, accepted
activity re-surfacing the bubble, and SVG marks (the ✕/◯ text glyphs render at
mismatched sizes on iOS — font metrics differ per platform).

- [X] T028 [P] Write FAILING e2e in `e2e/games.spec.ts`: a text message buries the game bubble (bubble is no longer last in `messages()` order), then an accepted move re-surfaces it as the NEWEST message on both devices (FR-021)
- [X] T029 Implement the activity bump in `src/db/queries.ts` `applyGameMove()`: on outcome `'applied'` only, `message.timestamp = max(timestamp, signal.at)` — derived from the signal so both devices reorder identically; dropped/out-of-sync signals never bump
- [X] T030 `src/games/tictactoe/TicTacToeBoard.vue` + `src/components/GameBubble.vue`: draw ✕/◯ as stroke SVGs (identical geometry on every platform, fixes the iOS glyph-size mismatch) and add a "You play ✕" legend with the viewer's mark colored to match the board (FR-019); status row gains an `AnimatedEmoji` cue — 🎲 your turn, ⏳ their turn, 🎉 you won — all verified present in the Noto set, native-glyph fallback otherwise (FR-020)
- [X] T031 Update `drive/scenarios/tictactoe.mjs` screenshots for the new bubble; re-run gates (`npm run build`, `npm run test:unit`, `npx playwright test games.spec.ts`)

---

## Phase 8: Visual polish — game vibe, themes, stats (user feedback, 2026-07-05)

**Purpose**: FR-022/FR-023/FR-024 + the animated-emoji design-language doc

- [X] T032 Generate `docs/ANIMATED-EMOJI.md`: the full Noto animated inventory (from the official manifest, 881 emoji), a curated game-genre palette (winner, loser, tie, waiting, call-to-action, thinking, taunt, love, surprise, game objects), the current game usage table, and the tic-tac-toe theme table — the single source of truth for future animation design
- [X] T033 [P] Write FAILING unit tests `src/games/stats.test.ts` for pure `computeGameStats()`: startedAt/endedAt/duration for win, resign (uses `resignedAt`), and ongoing; move count; per-player average and fastest reply times from move timestamps (first move measured from `startedAt`); graceful partial data (no `startedAt` on legacy sessions)
- [X] T034 [P] Extend `e2e/games.spec.ts` with a FAILING theme round-trip: a game started with theme `space` reports the same theme on both devices via `gameInfo` (FR-022 wire check)
- [X] T035 Types + wire + storage for themes and stats: `GameTheme` (`{ id, name, marks?, accent? }`) and `themes` on `GameModule`; `theme`/`startedAt`/`resignedAt` on `GameSession`; `theme` on the `GameStart` payload; `sendGame(chatId, gameType, theme?)` + inbound + retry carry it; the session engine stamps `resignedAt`; implement `src/games/stats.ts`
- [X] T036 Board + bubble game feel: theme mark pairs render as emoji (classic keeps the color-coded SVG marks), the most recently played cell animates via `AnimatedEmoji`, soft per-theme board accent, a matchup header (`[your mark] You vs Name [their mark]`) replacing the legend, and minimal-word statuses with the FR-023 emoji palette (🎲/⏳/🎉/😅/🤝/😵)
- [X] T037 `src/components/GamePicker.vue` gains theme selection (theme chips with mark pairs under the chosen game); `src/views/detail/MessageInfoPage.vue` gains the Game section (matchup, started, result, game time, moves, average reply per player, fastest move) and `ChatDetailPage` enables Message info for game bubbles in both directions
- [X] T038 Refresh `drive/scenarios/tictactoe.mjs` (theme showcase + info-page screenshot); re-run gates (`npm run build`, `npm run test:unit`, `npx playwright test games.spec.ts`)

---

## Phase 9: Result overlay (user feedback, 2026-07-05)

- [X] T039 FR-025 result overlay: `GameBubble.vue` covers a finished board with a half-transparent dark overlay carrying a LARGE animated result (🏆 winner, 🥈 other player, 🤝 draw — all verified animated) and a 🐦‍🔥 Play again; tap-to-peek reveals the final board with the compact result line. Promote 🏆/🥈/🤝 to THE result emoji across bubble, Message info, and the page-path preview strings; update `docs/ANIMATED-EMOJI.md` usage table; refresh drive screenshots; re-run gates

---

## Phase 10: Game audio (user feedback, 2026-07-05)

- [X] T040 FR-026 game sound cues, tests first: extend `src/services/sound.ts` RECIPES with `gamestart`/`gamemove`/`gamewin`/`gamelose`/`gamedraw` (sound.test.ts completeness check goes red first); new `src/services/game-sounds.ts` with pure `gameCueFor(status, me)` (unit-tested) + a `notifications.gameSounds`-gated player (no import cycle: reads the setting via idb directly); hooks in `queries.ts` (sendGame + inbound bubble while chat active → match call; applied moves → tick or result cue; self resign → lose cue; inbound only while `isChatActive`); "Game sounds" toggle beside "In-call sounds" in `settings/schema.ts`; e2e asserts fired cues via the existing `recordCues`/`cuesFired` hook

---

## Phase 11: Personal copy (user feedback, 2026-07-05)

- [X] T041 Name-first game copy: matchup header keeps "vs" centered (grid, sides ellipsize long names); bubble results name the opponent ("Alice won", "Alice gave up. You win!"); move notifications say "Alice made a move, your turn 😏" and game-ending ones name the winner on BOTH the page path and the SW web-push path (the SW prefetches the game row and derives the post-move result with the pure session engine); tests updated first (sw-inbox.games, notify-preview, e2e preview assert)

---

## Phase 12: Banner polish (user feedback, 2026-07-05)

- [X] T042 Breathing room between each name and its mark in the matchup header (and Message info players row); in-app banner bodies render through EmojiText so notification emoji (😏/🏆/🤝) animate when available, honoring the animation preference

---

## GitHub Issues

One issue per task (created 2026-07-05; the feature → develop PR must list `Closes #N`
for each): T001 #761 · T002 #762 · T003 #763 · T004 #764 · T005 #765 · T006 #766 ·
T007 #767 · T008 #768 · T009 #769 · T010 #770 · T011 #771 · T012 #772 · T013 #773 ·
T014 #774 · T015 #775 · T016 #776 · T017 #777 · T018 #778 · T019 #779 · T020 #780 ·
T021 #781 · T022 #782 · T023 #783 · T024 #784 · T025 #785 · T026 #786 · T027 #787 ·
T028 #788 · T029 #789 · T030 #790 · T031 #791 ·
T032 #792 · T033 #793 · T034 #794 · T035 #795 · T036 #796 · T037 #797 · T038 #798 · T039 #799 · T040 #800 · T041 #801 · T042 #802

---

**MVP first**: Phases 1-3 alone ship a complete playable feature (start, play, win/draw,
one-game gate). Stop at the Phase 3 checkpoint, run the full gates, and the feature is
demoable. US2 (resign/rematch) and US3 (notifications/previews) layer on without touching
US1's semantics. Commit after each task or logical group; every test task is committed
failing before its implementation task (constitution III).
