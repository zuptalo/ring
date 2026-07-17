// Armada GameModule (spec 1038) — the fourth catalog entry and the first
// FULLSCREEN-presentation game: chat/wall surfaces render its challenge card
// and the board lives in the app-global game overlay. `id` is frozen
// (contracts/armada-protocol.md); the module's replayed state is the PUBLIC
// game only — layouts stay device-local until the reveal.

import { locateOutline } from 'ionicons/icons'
import type { GameModule } from '../types'
import { applyMove, createInitialState, mayMove as armadaMayMove, status, turn, type ArmadaMove, type ArmadaState } from './logic'

/** The foley a just-applied move deserves — Armada's own layered naval set
 *  (spec 1038; cue names are device-local, not wire): the deck gun, the
 *  shell's splash, the armor hit, the full sinking sequence — and when a move
 *  ENDS the war, the bugle victory march or the struck-colours lament instead
 *  of the platform's generic fanfare. Commits and reveals are silent
 *  bookkeeping (the final reveal is what lands the result cue). */
function moveCue(move: unknown, st: { state: string; winner?: 0 | 1 }, me: 0 | 1): string | null {
  // The ending owns its music regardless of HOW it ended — the final reveal,
  // or a resignation (which carries no move at all).
  if (st.state === 'won' || st.state === 'resigned') return st.winner === me ? 'ar-victory' : 'ar-defeat'
  if (st.state === 'draw') return null // two cheaters share the generic shrug
  const m = move as ArmadaMove | null
  if (!m || typeof m !== 'object') return null
  if (st.state !== 'ongoing') return null
  if (m.t === 'shot') return 'ar-fire'
  if (m.t === 'answer') return m.r === 'miss' ? 'ar-splash' : m.r === 'sunk' ? 'ar-sunk' : 'ar-hit'
  return null
}

const armada: GameModule<ArmadaState, ArmadaMove> = {
  id: 'armada',
  displayName: 'Armada',
  icon: locateOutline,
  players: 2,
  createInitialState,
  applyMove,
  turn,
  status,
  moveCue,
  // Strict turn order EVERYWHERE, including sequential deployment commits —
  // the parallel-deploy feel lives in the staged commit + duty officer, never
  // in the rules (contract §Moves). The hook exists so the gate is explicit.
  mayMove: (state, player) => armadaMayMove(state as ArmadaState, player),
  // The whole point of spec 1038: played fullscreen, carded in the chat.
  presentation: 'fullscreen',
  // The challenge-card + overlay copy, in Armada's naval voice. (These strings
  // shipped inline in GameChallengeCard for spec 1038; they moved here verbatim
  // when the card was generalized for a second fullscreen game — Armada reads
  // exactly as before.)
  card: {
    tagline: 'Naval duel',
    emoji: '🎯', // calling shots to sink the enemy fleet — the targeting core, at a glance
    parallelOpening: true, // both admirals deploy fleets before the first shot
    deployLine: 'Your fleet awaits deployment',
    awaitingOpening: (name) => `Awaiting ${name}'s fleet`,
    reviewOpeningBtn: 'Review fleet ▸',
    win: 'Victory at sea',
    loss: 'Your fleet was lost',
    resignWin: 'They surrendered. Victory is yours',
    resignLoss: 'You surrendered',
    spectateFinished: 'Battle decided',
    theirTurn: (name) => `${name} is aiming…`,
    spectateOngoing: 'Battle under way',
  },
  // ONE look — the handoff's warship design IS Armada's identity.
  themes: [{ id: 'classic', name: 'Armada' }],
}

export default armada
