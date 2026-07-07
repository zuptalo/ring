// Core types for the in-chat games plugin system (spec 0008).
//
// Every game ships as a bundled, first-party module implementing GameModule.
// The whole directory follows the crypto core's discipline: pure functions,
// no IndexedDB, no Vue — so the rules engine is unit-testable in isolation and
// `queries.ts` never drags component code into the data layer. The one
// deliberate exception is `boards.ts` (the id → board-component map), which is
// the ONLY file under src/games/ allowed to import Vue components.

/** Outcome of a game as judged by its rules (resignation is session-level). */
export interface GameStatusResult {
  state: 'ongoing' | 'won' | 'draw'
  /** Present iff state === 'won'. */
  winner?: 0 | 1
}

/**
 * A bundled game. `id` is serialized into sealed payloads, so it is frozen
 * once shipped — evolving a game's rules means shipping a NEW id, never
 * changing the behavior behind an existing one (mixed-version replay would
 * silently diverge otherwise; see contracts/game-payload.md).
 *
 * applyMove/turn/status MUST be pure and deterministic: both devices replay
 * the same move log and must derive the identical board. applyMove returns
 * null for an illegal move and never throws.
 */
export interface GameModule<S = unknown, M = unknown> {
  id: string
  displayName: string
  /** An Ionicon (import from 'ionicons/icons' — icon data, not a name string,
   *  so only the icons actually registered get bundled). */
  icon: string
  players: 2
  createInitialState(): S
  applyMove(state: S, move: M, player: 0 | 1): S | null
  turn(state: S): 0 | 1
  status(state: S): GameStatusResult
  /** Bundled visual themes; the first entry is the default (FR-022). */
  /** Optional finer-grained acting gate (spec 1033): when defined, it replaces
   *  the strict `turn(state) === player` check in BOTH the local-send gate and
   *  inbound validation — e.g. Battleship's parallel fleet placement, where
   *  each player owes their own commit in any order. `turn()` still names who
   *  is being waited on (nudges, previews). */
  mayMove?: (state: unknown, player: 0 | 1) => boolean
  /** Optional per-move FOLEY (spec 1033): the game may name the cue a just-
   *  applied move deserves (e.g. Battleship's splash vs impact); null/absent
   *  falls back to the platform's generic status cues. */
  moveCue?: (move: unknown, status: GameSessionStatus, me: 0 | 1) => string | null
  /** Optional presentation mode (spec 1038): 'fullscreen' games render as a
   *  compact challenge card in the chat/wall and their board lives in the
   *  app-global game overlay instead. Absent = the classic inline bubble.
   *  Purely a rendering concern — the wire and the engine never see it. */
  presentation?: 'fullscreen'
  /** Retired games (spec 1038) are hidden from the picker but keep rendering
   *  and replaying existing sessions forever — the id contract stays honored;
   *  only NEW games of this type can no longer start. */
  retired?: true
  /** Rematch redirect for retired games (spec 1038): a rematch on a finished
   *  session of this game starts the successor id instead (e.g. battleship's
   *  rematch starts armada). Absent = rematch keeps the same id. */
  successor?: string
  themes: GameTheme[]
}

/**
 * A visual theme for a game: the two players' marks and a soft board accent
 * (FR-022). `marks` are emoji characters (pick pairs from the ANIMATED set in
 * docs/ANIMATED-EMOJI.md so the last-move pulse plays); a theme WITHOUT marks
 * renders the game's built-in classic look (tic-tac-toe: color-coded SVG X/O).
 * Theme ids ride the sealed payload and are frozen once shipped, like game ids.
 */
export interface GameTheme {
  id: string
  name: string
  /** [player 0 mark, player 1 mark] as emoji; absent = the classic built-in look. */
  marks?: [string, string]
  /** Soft board tint as an "r, g, b" triplet for rgba() (absent = default). */
  accent?: string
}

/** One accepted move in a session's append-only log. */
export interface GameMoveRec {
  /** 1-based, contiguous. */
  seq: number
  player: 0 | 1
  move: unknown
  /** Sender's clock, display only — never used for ordering. */
  at: number
}

/**
 * One playthrough, stored on the game bubble's Message row (like `poll`).
 * Board, turn, and outcome are always DERIVED by replaying `moves` — never
 * stored — so a tampering peer can only produce a labeled out-of-sync state,
 * never a corrupted board (spec FR-004/FR-007).
 */
export interface GameSession {
  gameType: string
  /** Visual theme id (FR-022); unknown/absent renders as the classic theme. */
  theme?: string
  /**
   * Explicit seats by userId (spec 0009: group/wall sessions). `[challenger]`
   * while the challenge is open, `[challenger, acceptor]` once the seat locks.
   * ABSENT ⇒ a 1:1 session with spec-0008 direction-derived roles, untouched.
   */
  players?: [string] | [string, string]
  /** Open-challenge state (spec 0009). Present ⇒ this began as a challenge. */
  challenge?: {
    /** Every accept seen, deduped by userId. Ordering-bearing `at`s. */
    accepts: { userId: string; at: number }[]
    /** Creator withdrew (the cancel signal's own `at`). Withdrawn iff no moves. */
    cancelledAt?: number
  }
  /** The bubble's original compose time — kept here because Message.timestamp
   *  becomes last-activity time once moves re-surface the bubble (FR-021). */
  startedAt?: number
  moves: GameMoveRec[]
  /** Set when a resign was accepted; terminal. */
  resignedBy?: 0 | 1
  /** The resign signal's `at` — the game's end time for stats (FR-024). */
  resignedAt?: number
  /** Set when an invalid/conflicting inbound signal was seen; terminal. */
  outOfSync?: true
}

/** Derived, user-facing status of a session (see deriveStatus in session.ts). */
export type GameSessionStatus =
  | { state: 'ongoing'; turn: 0 | 1 }
  | { state: 'won'; winner: 0 | 1 }
  | { state: 'draw' }
  | { state: 'resigned'; winner: 0 | 1 }
  | { state: 'out-of-sync' }

/** Wire shape of a move/resign signal (sealed inside MessagePayload.gameMove). */
export interface GameMoveSignalShape {
  messageId: string
  seq: number
  action: 'move' | 'resign'
  move?: unknown
  at: number
  /** Spec 0009 seat lock: on seq 1 of an explicit-players session the challenger
   *  stamps the resolved opponent, closing the accept race identically everywhere.
   *  Ignored on 1:1 sessions and by older clients (additive). */
  opponent?: string
}
