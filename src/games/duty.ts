// The duty resolver (spec 1038, FR-009) — "what move do I owe right now?"
//
// Battleship (0011/1033) auto-sent the defender's answers from INSIDE the
// board component, so a defender who never had the bubble on screen never
// answered — the root cause of the both-players-waiting stall. Armada's
// protocol bookkeeping is instead derived here, purely, from (public state,
// device-local secret, staged commit); the app-level watcher
// (composables/useGameDuty.ts) emits whatever is owed whenever it observes
// the session — board mounted or not, overlay open or not.
//
// Idempotence: every branch goes quiet once the owed move is in the log
// (pending answered, commit recorded, reveal present), and the session
// engine's seq dedup additionally drops an accidental double-send — so
// re-running this after an app kill between judging and sending is always
// safe, which is exactly the re-emit-on-open rule the spec demands.

import {
  FLEET_CELLS,
  judgeShot,
  status,
  type ArmadaMove,
  type ArmadaState,
  type Layout,
  type Reveal,
} from './armada/logic'

export interface DutySecret {
  layout: Layout
  salt: string
}

/** A commit staged while the wire slot wasn't open yet (commits are
 *  sequential — contract §Moves); stored device-locally next to the secret. */
export interface StagedCommit {
  h: string
}

/** Normalize to plain data at the choke point: the secret may arrive wrapped
 *  in Vue reactivity, and a Proxy inside an emitted move throws
 *  DataCloneError when the applied session is stored (the trap has bitten
 *  posts, fleet secrets, AND battleship's auto-reveal before). */
const plainLayout = (l: Layout): Layout => l.map((s) => ({ r: s.r, c: s.c, len: s.len, dir: s.dir }))
const plainReveal = (sec: DutySecret): Reveal => ({ layout: plainLayout(sec.layout), salt: sec.salt })

/**
 * The single move `me` currently owes the protocol, or null. Pure — the
 * caller loads the secret/staged records and emits through the normal
 * play-move paths (which re-validate via the session engine).
 */
export function owedMove(
  s: ArmadaState,
  me: 0 | 1,
  secret: DutySecret | null,
  staged?: StagedCommit | null,
): ArmadaMove | null {
  if (!secret) return null // without the layout this device can judge nothing
  if (status(s).state !== 'ongoing') return null

  // A staged commit whose slot has opened (P0 immediately; P1 once P0's is in).
  if (s.commits[me] === null) {
    if (!staged?.h) return null
    const slotOpen = me === 0 || s.commits[0] !== null
    return slotOpen ? { t: 'commit', h: staged.h } : null
  }
  if (s.commits[0] === null || s.commits[1] === null) return null // waiting on the other side

  // The winner's closing reveal (verify phase).
  if (s.finalBy !== null) {
    return s.finalBy === me && s.reveals[me] === null ? { t: 'reveal', ...plainReveal(secret) } : null
  }

  // The defender's answer to a pending enemy shot.
  const p = s.pending
  if (!p || p.by === me) return null
  const incoming = s.shots[p.by].filter((x) => x.r !== 'miss').map((x) => x.cell)
  const r = judgeShot(secret.layout, p.cell, incoming)
  const declared = incoming.length + (r === 'miss' ? 0 : 1)
  if (declared >= FLEET_CELLS) {
    // The final answer carries the loser's reveal (a bare final answer is illegal).
    return { t: 'answer', r: 'sunk', reveal: plainReveal(secret) }
  }
  return { t: 'answer', r }
}
