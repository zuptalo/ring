# Implementation Plan: In-Chat Turn-Based Games

**Branch**: `feat/0008-chat-turn-based` | **Date**: 2026-07-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/0008-chat-turn-based/spec.md`

## Summary

Turn-based games (tic-tac-toe first) playable inside 1:1 chats. A game is started from
the composer's attach sheet and appears as an interactive bubble — the exact poll pattern:
a new `game` message kind carries the game start, and a `gameMove` side-effect signal
(move/resign) rides subsequent sealed payloads and mutates the bubble's stored session.
Game state is an append-only move log on the `Message` row, replayed deterministically;
both clients validate every move with a pure rules engine, so a tampering peer can only
force a labeled "out of sync" state, never a corrupted board. Games live in a new
`src/games/` internal plugin registry — bundled, first-party modules behind one
`GameModule` interface — so game #2 is a new directory plus registration, with zero
changes to transport, storage, or the server. Server diff: empty (the zero-knowledge
proof point).

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 `<script setup>` + Ionic, Vite); no
service-worker-only context beyond a small preview/notification branch in the existing
SW receive path

**Primary Dependencies**: existing E2EE messaging stack (`src/services/crypto/message.ts`
seal/open, `src/db/queries.ts` orchestration, opaque `msg` WS relay); IndexedDB via
`src/db/idb.ts` + `useLiveQuery`; stock Ionic components for all UI

**Storage**: IndexedDB — new optional `game` field on the existing `Message` row (exactly
like `poll`); **no new object store, no `DB_VERSION` bump**; server Postgres untouched

**Testing**: vitest unit tests for the pure rules engine and session replay
(`src/games/**/*.test.ts`, no IndexedDB); Playwright e2e (`e2e/games.spec.ts`) driving two
accounts through start → moves → win/draw/resign via `window.__ringTest`

**Target Platform**: installable PWA — Chrome/Edge/Firefox desktop + Android, iOS Safari
home-screen PWA (same as the rest of the app)

**Project Type**: web app, client-only change; Go server: zero changes

**Performance Goals**: a move renders locally instantly (optimistic, it is already
validated) and appears on the online opponent's board within 2 s (SC-002); replaying a
full tic-tac-toe move log (≤9 moves) is trivially sub-millisecond

**Constraints**: zero-knowledge boundary untouched (game traffic = ordinary sealed
envelopes, FR-010/SC-004); deterministic replay — same moves in, same board out, on both
devices; duplicate-safe (relay redelivery); one-game-per-chat gate is local/UX-level, not
a protocol invariant (FR-001a); no dynamic code — all games ship in the reviewed build
(FR-017)

**Scale/Scope**: 1 new source directory (`src/games/`), 2 new components, ~8 existing
client files touched + tests; tic-tac-toe state is a 9-cell array — no scale concerns

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary**: PASS — game start/move/resign are fields inside the
  already-sealed `MessagePayload`; the server relays the same opaque `msg` frames it
  relays today. No new endpoint, field, or metadata. Spec carries the required
  Zero-Knowledge Impact section. Proof point: `git diff --stat server/` is empty.
- **II. Spec-Driven Development**: PASS — spec 0008 (planned band), pipeline followed in
  order; this plan is stage 3.
- **III. Test-Driven Development**: PASS — tasks.md will order failing unit tests (rules:
  legal/illegal moves, win/draw detection; session: replay, duplicate seq, out-of-turn →
  out-of-sync) and the e2e spec before the implementation tasks that satisfy them.
- **IV. Crypto Discipline**: PASS — no crypto change at all. New payload fields are
  plaintext-side additions serialized before the existing `sealMessage`/`openMessage`;
  no new primitives, no ratchet change, `messaging.ts` untouched, the
  `queries.ts → messaging.ts` direction is preserved. `/speckit-checklist` is still
  REQUIRED because the sealed wire payload shape changes (Principle I territory).
- **V. Offline-First Data Integrity**: PASS — all writes via `idb.ts` + change bus; a new
  *optional* field on `Message` rows needs no `DB_VERSION` bump or migration (same as
  `poll`); old rows without `game` are untouched.
- **VI. Stateless Server & Migrations**: PASS — zero server changes.
- **VII. Quality Gates**: PASS — `npm run build`, vitest + coverage floors, e2e where
  behavior changed; commit subjects written as release-note copy (e.g. `feat(chat): play
  tic-tac-toe with your friends right inside a chat`).
- **VIII. Traceable Delivery**: PASS — `/speckit-taskstoissues` + `Closes #N` list on the
  feature → develop PR.
- **IX. Privacy & Data Minimization**: PASS — no telemetry, no new data collection; game
  history is device-local message content.
- **X. Accessibility & i18n**: PASS — board cells are buttons with aria-labels
  (row/column/state), status text uses existing i18n plumbing, layout is
  direction-neutral (a 3×3 grid), theme via `--ring-*` tokens.
- **XI. Ionic-First UI**: PASS with one justified custom component — the bubble chrome,
  picker modal, action buttons are stock Ionic (`ion-modal`, `ion-list`, `ion-item`,
  `ion-button`, `ion-icon`). The 3×3 **board grid itself** has no Ionic primitive
  (closest is `ion-grid`, which is a layout helper, and it *is* what we compose the
  board from); cells are plain buttons styled with existing theme tokens. This is the
  "no Ionic component covers the need, composed from Ionic with minimum customization"
  carve-out.

**Post-Phase-1 re-check**: design artifacts (research.md, data-model.md, contracts/)
introduce no new violations; storage stays on the Message row, wire stays inside the
sealed payload, no server involvement anywhere.

## Project Structure

### Documentation (this feature)

```text
specs/0008-chat-turn-based/
├── spec.md              # Feature specification (with Zero-Knowledge Impact)
├── plan.md              # This file
├── research.md          # Phase 0: decisions + rationale
├── data-model.md        # Phase 1: entities, wire signals, state machine
├── quickstart.md        # Phase 1: dev loop for this feature
├── contracts/
│   └── game-payload.md  # Phase 1: sealed-payload wire contract + GameModule interface
├── checklists/
│   └── requirements.md  # Spec quality checklist (done)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── games/                          # NEW — internal plugin registry (pure logic, no Vue imports)
│   ├── types.ts                    # GameModule interface, GameSession/GameMoveRec types
│   ├── registry.ts                 # GAMES: Record<string, GameModule> — declarative catalog
│   ├── session.ts                  # game-agnostic replay/dedupe/validation engine
│   ├── boards.ts                   # game id → board component map (the ONLY Vue-importing file)
│   └── tictactoe/
│       ├── logic.ts                # pure rules: createInitialState/applyMove/status/turn
│       ├── logic.test.ts           # vitest, colocated
│       ├── index.ts                # the GameModule (id 'tictactoe', wires logic + metadata)
│       └── TicTacToeBoard.vue      # 3×3 board, composed from ion-grid + themed buttons
├── components/
│   ├── GameBubble.vue              # NEW — bubble chrome: board + status + turn + actions
│   └── GamePicker.vue              # NEW — ion-modal listing the registry
├── services/
│   ├── crypto/message.ts           # + GameStart, GameMoveSignal, payload fields (kind 'game')
│   ├── sw-drain.ts                 # + defer gameMove to page; persist game on eligible rows
│   ├── sw-inbox.ts                 # + "Your move" notification branch (behind existing gates)
│   ├── notify-preview.ts           # + preview strings for kind 'game'
│   └── testhook.ts                 # + sendGame/playGameMove/resignGame for e2e
├── db/
│   ├── types.ts                    # + GameSession/GameMoveRec, MessageKind/lastKind 'game', Message.game
│   └── queries.ts                  # + sendGame/playGameMove/resignGame/applyGameMove/handleGameMove,
│                                   #   receive dispatch, previews, forward exclusion, retry re-seal
├── utils/message-preview.ts        # + preview line for game kind
└── views/detail/ChatDetailPage.vue # + attach-sheet "Game" entry (1:1 only, gated), GameBubble branch

src/games/session.test.ts           # vitest: replay, dedupe, conflict → out-of-sync
e2e/games.spec.ts                   # NEW — two-account start/move/win/draw/resign flows
```

**Structure Decision**: single web-app project (existing layout). The one new directory,
`src/games/`, isolates all game logic behind the `GameModule` interface with a hard rule:
only `boards.ts` may import Vue components, so `queries.ts` and vitest touch pure logic
only — mirroring the crypto core's pure-function discipline.

## Complexity Tracking

No constitution violations to justify. The single Ionic-first deviation (custom board
grid composed from `ion-grid` + themed buttons) is reasoned under Principle XI in the
Constitution Check above.
