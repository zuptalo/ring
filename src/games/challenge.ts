// The pure challenge engine (spec 0009): open-challenge phases, the
// deterministic accept race, and the wall-engagement replay. Same discipline
// as session.ts — no IndexedDB, no Vue, identical inputs ⇒ identical outputs
// on every device, which is the whole convergence story:
//
//  - the derived seat is min(accepts) ordered by (at asc, userId asc) — pure
//    data ordering, never arrival order;
//  - the seat LOCKS when the challenger plays seq 1 (the move's `opponent`
//    stamp is wire data), so a straggling earlier accept can never reopen a
//    game in progress;
//  - signals from non-players are DROPPED, never out-of-sync — third parties
//    cannot poison an honest board;
//  - a cancel wins iff no moves were played; accepts never override a cancel.
//
// Membership checks (is the accepter actually in the group / audience?) live
// with the callers, who know the roster; this module is deliberately blind to
// everything but the session data.

import { applySignal } from './session'
import type { GameModule, GameSession } from './types'

export type ChallengePhase = 'open' | 'accepted' | 'cancelled'

/** One pulled wall engagement row of kind `game` (payload already unsealed). */
export interface WallGameRow {
  /** Server engagement id — the dedupe key. */
  id: string
  /** Server-attested actor userId (the same trust anchor reactions use). */
  actor: string
  payload:
    | { t: 'accept'; at: number }
    | { t: 'move'; seq: number; action: 'move' | 'resign'; move?: unknown; at: number; opponent?: string }
}

const isCancelled = (s: GameSession): boolean =>
  s.challenge?.cancelledAt !== undefined && s.moves.length === 0

/** The challenge's derived phase. Sessions without a challenge are 'accepted'
 *  by construction (a 1:1 game never had an open seat). */
export function challengePhase(s: GameSession): ChallengePhase {
  if (!s.challenge) return 'accepted'
  if (isCancelled(s)) return 'cancelled'
  if ((s.players?.length ?? 0) === 2 || s.challenge.accepts.length > 0) return 'accepted'
  return 'open'
}

/** The resolved opponent: the locked seat when play started, else the derived
 *  min(accepts) by (at asc, userId asc), else null while nobody accepted. */
export function resolveOpponent(s: GameSession): string | null {
  if (s.players && s.players.length === 2) return s.players[1]
  const accepts = s.challenge?.accepts ?? []
  if (!accepts.length) return null
  let best = accepts[0]
  for (const a of accepts) {
    if (a.at < best.at || (a.at === best.at && a.userId < best.userId)) best = a
  }
  return best.userId
}

/** Record an accept. Drops: no challenge, the creator, duplicates, a locked
 *  seat, or a clean cancel — everything else appends (pure, order-free). */
export function applyAccept(
  s: GameSession,
  userId: string,
  at: number,
): { session: GameSession; outcome: 'applied' | 'dropped' } {
  if (!s.challenge || isCancelled(s)) return { session: s, outcome: 'dropped' }
  if ((s.players?.length ?? 0) === 2) return { session: s, outcome: 'dropped' } // locked
  if (s.players?.[0] === userId) return { session: s, outcome: 'dropped' } // creator
  if (s.challenge.accepts.some((a) => a.userId === userId)) return { session: s, outcome: 'dropped' }
  return {
    session: {
      ...s,
      challenge: { ...s.challenge, accepts: [...s.challenge.accepts, { userId, at }] },
    },
    outcome: 'applied',
  }
}

/** Withdraw an open challenge. Creator-only, and meaningless once the
 *  challenger has started play (they would never cancel-and-move). */
export function applyCancel(
  s: GameSession,
  senderId: string,
  at: number,
): { session: GameSession; outcome: 'applied' | 'dropped' } {
  if (!s.challenge || s.players?.[0] !== senderId) return { session: s, outcome: 'dropped' }
  if (s.moves.length > 0) return { session: s, outcome: 'dropped' }
  if (s.challenge.cancelledAt !== undefined) return { session: s, outcome: 'dropped' }
  return {
    session: { ...s, challenge: { ...s.challenge, cancelledAt: at } },
    outcome: 'applied',
  }
}

/** Pin the second seat (the challenger's seq-1 `opponent` stamp landing). */
export function lockOpponent(s: GameSession, userId: string): GameSession {
  const challenger = s.players?.[0]
  if (!challenger || s.players?.length === 2) return s
  return { ...s, players: [challenger, userId] }
}

/** Map a userId to its seat. Pre-lock, the derived opponent counts as seat 1
 *  (the matchup renders before the first move). Null = not a player → the
 *  caller DROPS the signal, never marks out-of-sync. */
export function playerIndexOf(s: GameSession, userId: string): 0 | 1 | null {
  if (s.players?.[0] === userId) return 0
  if (s.players && s.players.length === 2) return s.players[1] === userId ? 1 : null
  return resolveOpponent(s) === userId ? 1 : null
}

/**
 * Deterministic replay of a wall game from its pulled engagement rows
 * (spec 0009 FR-008/D9): dedupe by engagement id, accepts through the seat
 * rule, moves sorted (seq, at, actorId, id) through the 0008 engine with seat
 * mapping. Every device that pulls the same set derives the same session; a
 * genuine fork lands on the engine's out-of-sync terminal.
 */
export function buildWallSession(
  module: GameModule | null,
  authorId: string,
  game: { gameType: string; theme?: string },
  rows: WallGameRow[],
): GameSession {
  let session: GameSession = {
    gameType: game.gameType,
    theme: game.theme,
    players: [authorId],
    challenge: { accepts: [] },
    moves: [],
  }

  const seen = new Set<string>()
  const accepts: Array<{ actor: string; at: number }> = []
  const moves: Array<{ id: string; actor: string; p: Extract<WallGameRow['payload'], { t: 'move' }> }> = []
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    if (r.payload.t === 'accept') accepts.push({ actor: r.actor, at: r.payload.at })
    else moves.push({ id: r.id, actor: r.actor, p: r.payload })
  }

  accepts.sort((a, b) => a.at - b.at || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0))
  for (const a of accepts) session = applyAccept(session, a.actor, a.at).session

  // The game's story starts when the seat was won (spec 0009 stats): the
  // resolved opponent's accept stamps startedAt so reply-gap stats have their
  // base. Deterministic — derived from the same ordered accept data everywhere.
  const seat = resolveOpponent(session)
  const seatAccept = seat ? accepts.find((a) => a.actor === seat) : undefined
  if (seatAccept) session = { ...session, startedAt: seatAccept.at }

  moves.sort(
    (a, b) =>
      a.p.seq - b.p.seq ||
      a.p.at - b.p.at ||
      (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  for (const m of moves) {
    // The challenger's seq-1 stamp locks the seat before the move applies.
    if (m.p.seq === 1 && m.p.opponent && session.players?.length === 1 && m.actor === session.players[0]) {
      session = lockOpponent(session, m.p.opponent)
    }
    const idx = playerIndexOf(session, m.actor)
    if (idx === null) continue // non-player rows never poison the board
    session = applySignal(module, session, { seq: m.p.seq, action: m.p.action, move: m.p.move, at: m.p.at }, idx).session
  }
  return session
}
