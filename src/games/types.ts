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
}
