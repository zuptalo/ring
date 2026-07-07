// The ongoing-games set behind the floating return button (spec 1038 FR-008)
// — pure decision core. queries.ts feeds it message/post rows; everything
// judgeable without IndexedDB is judged here so the truth table is
// unit-testable like the rest of the games engine.
//
// An entry exists iff: the module presents fullscreen, the local user holds a
// seat, the session is enterable (an OPEN challenge has no board to enter;
// cancelled is over), and the derived status is ongoing. `awaitingMe` is the
// badge: the engine's own acting gate, so it self-clears the moment the
// player moves — no unread ledger to maintain (research.md D7).

import { challengePhase } from './challenge'
import { deriveStatus, localMoveAllowed } from './session'
import type { GameModule, GameSession } from './types'

export type OverlayGameRef =
  | { surface: 'chat'; chatId: string; messageId: string; gameType: string }
  | { surface: 'wall'; postId: string; gameType: string }

export interface OngoingOverlayGame {
  ref: OverlayGameRef
  /** The engine says the local player owes an action (deploy or fire). */
  awaitingMe: boolean
  /** Last accepted move's `at`, else the session start, else the row's time. */
  lastActivityAt: number
}

/** Judge one session for the ongoing set; null = not shown on the pill. */
export function overlayGameEntry(
  module: GameModule | null,
  session: GameSession,
  me: 0 | 1 | null,
  ref: OverlayGameRef,
  fallbackAt: number,
): OngoingOverlayGame | null {
  if (module?.presentation !== 'fullscreen') return null
  if (me === null) return null // spectators follow the card, never the pill
  if (session.challenge && challengePhase(session) !== 'accepted') return null
  if (deriveStatus(module, session).state !== 'ongoing') return null
  const lastMove = session.moves[session.moves.length - 1]
  return {
    ref,
    awaitingMe: localMoveAllowed(module, session, me),
    lastActivityAt: lastMove?.at ?? session.startedAt ?? fallbackAt,
  }
}

/** The pill's tap order: games awaiting me first, newest activity breaking
 *  ties — index 0 is what a tap opens (spec §Decisions: no chooser sheet). */
export function mostUrgentFirst(entries: OngoingOverlayGame[]): OngoingOverlayGame[] {
  return [...entries].sort((a, b) => {
    if (a.awaitingMe !== b.awaitingMe) return a.awaitingMe ? -1 : 1
    return b.lastActivityAt - a.lastActivityAt
  })
}
