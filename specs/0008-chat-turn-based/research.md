# Research: In-Chat Turn-Based Games

**Spec**: [spec.md](spec.md) | **Date**: 2026-07-05

All Technical Context unknowns were resolved by reading the existing poll, reaction, and
call-signal implementations — the three shipped precedents for interactive state riding
the sealed payload. No external research was required; every decision below cites the
in-repo precedent it follows.

## D1. Transport: side-effect signal inside the sealed payload (not a new frame type)

- **Decision**: game starts are a new `kind: 'game'` message; moves/resignations are a new
  optional `gameMove` field on `MessagePayload`, exactly like `pollVote`
  (`src/services/crypto/message.ts:179`, payload fields at `:231-232`).
- **Rationale**: the WS hub's frame-type switch is a closed server-side set
  (`server/internal/ws/hub.go:1236+`), but the `msg` frame's ciphertext is opaque and
  durable (queued per-recipient, `hub.go:1256`). Riding `msg` gives delivery, ordering,
  offline queuing, retries, and push for free — with zero server changes, which is the
  feature's zero-knowledge proof point (FR-010).
- **Alternatives considered**: a new WS frame type (rejected: needs a server change and
  loses durable queuing — `activity`/`call-*` frames are live-only); WebRTC data channel
  (rejected: none exists today, heavy for turn-based, and offline delivery is required
  by FR-018).

## D2. State model: append-only move log with deterministic replay (not full state per message)

- **Decision**: each `gameMove` carries only `{seq, action, move}`; both devices replay
  the accepted log through the game's pure `applyMove` to derive the board.
- **Rationale**: FR-004 forbids trusting a peer's claimed board — full-state messages
  would let a tampering peer assert an arbitrary winning position. A validated log makes
  the honest device's board provably rule-consistent. `seq` gives idempotent redelivery
  (FR-006) and deterministic conflict detection (edge case "both players race": two
  different moves with the same `seq` → out of sync, never silent divergence).
- **Alternatives considered**: full board state per message (rejected: trust problem);
  CRDT-style merge (rejected: games need turn order, not convergence — a conflict IS a
  rule violation, and "out of sync + play again" is the spec'd resolution, FR-007).

## D3. Storage: `Message.game` field, no new object store

- **Decision**: the session lives on the game bubble's `Message` row as an optional
  `game` field — the exact shape of `poll?: Poll` (`src/db/types.ts:210`,
  applied inbound at `src/db/queries.ts:4761`).
- **Rationale**: the game then inherits every message-lifecycle behavior the spec demands
  (FR-015) for free: hidden-chat concealment (the `listChats` choke point), chat/message
  deletion, erase signals, and disappearing-message sweep
  (`sweepExpiredMessages`, `queries.ts:3486`). A dedicated object store would need
  hooks at each of those choke points and is a hidden-chat leak risk. Optional fields on
  existing rows need no `DB_VERSION` bump (precedent: poll).
- **Alternatives considered**: `games` object store keyed by gameId (rejected: lifecycle
  hooks + leak risk + DB migration for no benefit at ≤9 moves per session).

## D4. Session identity: gameId = the bubble's message id

- **Decision**: `gameMove.messageId` targets the game-start bubble, resolved on the
  receiver via the sender's `remoteId` mapping — the identical correlation mechanism
  pollVote and reaction already use (`queries.ts:4745`).
- **Rationale**: no new id scheme, no registry of live games; the bubble is the session.
  Rematch = a fresh bubble (FR-009) falls out naturally.

## D5. Roles and first move: derived, not transmitted

- **Decision**: bubble sender is player 0 and moves first (FR-003); the opponent is
  player 1. Derived from message direction on each device; nothing extra on the wire.
- **Rationale**: any transmitted role claim would have to be validated anyway; message
  direction is already authenticated by the E2EE session.

## D6. One-game-per-chat gate: local query at composer time

- **Decision**: the attach-sheet "Game" entry is disabled when the chat has any message
  with `game.status === 'ongoing'` (cheap indexed scan of the chat's messages at sheet
  open). Not a protocol invariant: a start race across an offline gap yields two
  playable games and the gate stays engaged until all finish (FR-001a).
- **Rationale**: clarification session 2026-07-05 chose one-at-a-time; local best-effort
  enforcement matches the friendly-opponent threat model and needs no wire change.

## D7. Notifications: "Your move" rides the existing gate chain

- **Decision**: an incoming `gameMove` produces a "Your move" notification (game start:
  "Wants to play tic-tac-toe") in both the page path (`notifyIncoming`) and the SW path
  (`sw-inbox.ts:259-266` branch), strictly behind the existing mute / generic /
  hidden-chat gates (FR-011/FR-012). This deliberately diverges from poll votes (silent,
  `sw-inbox.ts:207`) because a move demands the opponent's attention.
- **Rationale**: SC-007 requires zero leak beyond ordinary-message behavior; reusing the
  gate chain rather than new logic is how spec 1019 (hidden chats) and 1031 kept this
  provable.

## D8. Plugin registry: declarative module map, pure logic / Vue split

- **Decision**: `src/games/registry.ts` exports `GAMES: Record<string, GameModule>`;
  `src/games/boards.ts` maps game id → board component and is the only Vue-importing
  file in the directory. Adding a game = new subdirectory + one line in each file
  (FR-016, SC-006).
- **Rationale**: precedent is the declarative settings tree (`src/settings/schema.ts`)
  and the pure-function crypto core (testable without IndexedDB, constitution IV). The
  split keeps `queries.ts` and vitest free of SFC imports.
- **Alternatives considered**: Vite `import.meta.glob` auto-discovery (rejected: implicit
  registration hides review surface; an explicit two-line registration IS the review
  point for FR-017's "first-party, reviewed" rule).

## D9. Out-of-sync handling: terminal flag on the session

- **Decision**: any invalid, out-of-turn, or seq-conflicting inbound move sets
  `game.status = 'out-of-sync'` (terminal); the bubble labels it and offers Play again.
  Local sends are pre-validated so an honest device never triggers it on itself.
- **Rationale**: FR-007 and SC-005; a repair protocol is explicitly out of scope
  (spec Assumptions, friendly-opponent threat model).

## D10. Version skew: additive payload fields, standard fallback

- **Decision**: `kind: 'game'` renders on pre-feature clients the same way every past
  new kind did (unknown-kind fallback bubble + preview); `gameMove` on an old client is
  an unrecognized optional field, ignored by `openMessage`'s JSON parse. Accepted in the
  spec's Assumptions.
- **Rationale**: identical to how `poll`, `location`, `contact` kinds rolled out;
  no capability negotiation is warranted for a v1 game.
