// The duty officer (spec 1038 FR-009) — the mount-independent protocol actor.
//
// Battleship auto-sent the defender's answers from inside the board component,
// so a defender who never had the bubble on screen never answered: the
// both-players-waiting stall. Here the duty walks EVERY ongoing fullscreen
// game this device holds a seat in — on app start, on any live change to the
// involved stores, and on overlay open — computes the owed move purely
// (src/games/duty.ts) and emits it through the normal play paths, whose
// engine-side seq dedup makes re-emission after an app kill idempotent.
//
// Also the secrets' janitor: when a session reaches a terminal state (which
// can happen while minimized — no board mounted to notice), the fleet secret
// and any staged commit are cleared here.

import { watch } from 'vue'
import { getMessage, ongoingOverlayGames, playGameMove, playWallGameMove, wallGameSession } from '@/db/queries'
import { subscribe } from '@/db/idb'
import { GAMES } from '@/games/registry'
import { replayState, deriveStatus } from '@/games/session'
import { playerIndexOf } from '@/games/challenge'
import { owedMove } from '@/games/duty'
import type { ArmadaState } from '@/games/armada/logic'
import type { GameSession } from '@/games/types'
import type { OverlayGameRef } from '@/games/overlay-games'
import {
  clearFleetSecret,
  clearStagedCommit,
  getFleetSecret,
  getStagedCommit,
} from '@/games/fleet-secret'
import { getSelfUserId } from '@/services/auth'
import { overlayOpen } from './useGameOverlay'

// One emission per (session, log-length) — the log growing re-arms the guard,
// a re-render never double-fires while a send is in flight.
const inFlight = new Set<string>()

const refKey = (ref: OverlayGameRef): string => (ref.surface === 'chat' ? ref.messageId : ref.postId)

async function loadSession(ref: OverlayGameRef): Promise<GameSession | null> {
  if (ref.surface === 'chat') {
    const m = await getMessage(ref.messageId)
    return m?.game && !m.deleted ? m.game : null
  }
  return wallGameSession(ref.postId)
}

async function attend(ref: OverlayGameRef): Promise<void> {
  if (ref.gameType !== 'armada') return // the one duty-bearing module today
  const session = await loadSession(ref)
  if (!session) return
  const module = GAMES[ref.gameType]
  if (!module) return
  const me = session.players
    ? playerIndexOf(session, getSelfUserId() ?? '')
    : ref.surface === 'chat'
      ? await chatSeat(ref.messageId)
      : null
  if (me === null) return
  const state = replayState(module, session) as ArmadaState
  const key = refKey(ref)
  const staged = await getStagedCommit('armada', key)
  const secretHash = state.commits[me] ?? staged?.h ?? null
  const secret = secretHash ? await getFleetSecret('armada', secretHash) : null
  const move = owedMove(state, me, secret, staged)
  if (!move) {
    // The staged commit made it into the log — the stage served its purpose.
    if (staged && state.commits[me] !== null) void clearStagedCommit('armada', key)
    return
  }
  const guard = `${key}:${session.moves.length}:${move.t}`
  if (inFlight.has(guard)) return
  inFlight.add(guard)
  try {
    if (ref.surface === 'chat') await playGameMove(ref.chatId, ref.messageId, move)
    else await playWallGameMove(ref.postId, move)
  } finally {
    // The applied move changes the log length, so the next pass gets a fresh
    // guard; on failure a later pass may retry with the same key — allow it.
    setTimeout(() => inFlight.delete(guard), 5_000)
  }
}

async function chatSeat(messageId: string): Promise<0 | 1 | null> {
  const m = await getMessage(messageId)
  if (!m?.game) return null
  return (m.outgoing ? 0 : 1) as 0 | 1
}

/** Terminal-state cleanup for sessions the pill no longer reports (they are
 *  filtered out at 'ongoing', so sweep directly). Cheap: only rows with a
 *  fullscreen game are inspected inside ongoingOverlayGames' own scan; here
 *  we only handle the ones the DUTY saw before they ended. */
const seenOngoing = new Map<string, OverlayGameRef>()
async function sweepFinished(current: Set<string>): Promise<void> {
  for (const [key, ref] of [...seenOngoing]) {
    if (current.has(key)) continue
    seenOngoing.delete(key)
    const session = await loadSession(ref)
    const module = session ? GAMES[session.gameType] : null
    const done = !session || (module && deriveStatus(module, session).state !== 'ongoing')
    if (!done) continue
    const state = session && module ? (replayState(module, session) as ArmadaState) : null
    const me = session?.players ? playerIndexOf(session, getSelfUserId() ?? '') : ref.surface === 'chat' ? await chatSeat(ref.messageId) : null
    const h = me !== null ? state?.commits[me] : null
    if (h) void clearFleetSecret('armada', h)
    void clearStagedCommit('armada', key)
  }
}

let running = false
let dirty = false
async function pass(): Promise<void> {
  // A trigger landing MID-pass must not be dropped — the pass may have read
  // the state from before that write (e.g. the opponent's commit arriving
  // while we were attending the pre-commit state). Mark dirty and loop.
  if (running) {
    dirty = true
    return
  }
  running = true
  try {
    do {
      dirty = false
      const games = await ongoingOverlayGames()
      const current = new Set<string>()
      for (const g of games) {
        const key = refKey(g.ref)
        current.add(key)
        seenOngoing.set(key, g.ref)
        await attend(g.ref)
      }
      await sweepFinished(current)
    } while (dirty)
  } catch {
    /* a failed pass retries on the next store change */
  } finally {
    running = false
  }
}

let wired = false
/** Start the duty officer (App.vue, once). */
export function useGameDuty(): void {
  if (wired) return
  wired = true
  void pass()
  subscribe(['messages', 'posts', 'postEngagement'], () => void pass())
  watch(overlayOpen, (open) => {
    if (open) void pass()
  })
}
