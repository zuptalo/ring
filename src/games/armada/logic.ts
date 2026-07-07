// Armada protocol (spec 1038) — battleship's commit-and-reveal protocol
// re-cut for the classic 10×10 five-ship game, as a self-contained fork.
// Battleship's module stays byte-untouched behind its frozen id; sharing a
// core would couple a retiring module to a live one (research.md D1).
//
// The replayed state here is the PUBLIC game only: commitments, shots,
// answers, and the end-of-game reveals. Each player's layout+salt lives on
// their own device (fleet-secret.ts) until the reveal; honesty is
// commit-and-reveal, verified in status() as a pure function of the shared
// log — so players AND observers flip a cheated result identically
// (contracts/armada-protocol.md).
//
// One deliberate rules divergence from battleship-1033: deployment commits
// are SEQUENTIAL on the wire (P0 seq 1, then P1 seq 2). 1033's parallel
// commits carry a latent race — two simultaneous seq-1 commits trip the
// engine's same-seq/different-content rule and kill the session as
// out-of-sync. Deployment still FEELS parallel: the second player's Engage
// stages the commit device-locally and the duty officer (../duty.ts) emits it
// the moment the slot opens.
//
// Uses the app's existing libsodium SHA-256 (Principle IV — no bespoke
// crypto). Module functions stay synchronous: sodium is initialized before
// any game code runs (the app and SW both await ready() at boot; tests too).

import { sha256, randomBytes } from '@/services/crypto/primitives'

export const SIZE = 10
export const FLEET = [5, 4, 3, 3, 2] as const
export const FLEET_CELLS = 17

/** The five classes, index-aligned with FLEET — the canonical layout order.
 *  The two 3-cell classes are distinguished by position (Cruiser before
 *  Submarine), which the serialization then pins into the commitment. */
export const SHIP_CLASSES = [
  { key: 'carrier', name: 'Carrier', size: 5 },
  { key: 'battleship', name: 'Battleship', size: 4 },
  { key: 'cruiser', name: 'Cruiser', size: 3 },
  { key: 'submarine', name: 'Submarine', size: 3 },
  { key: 'destroyer', name: 'Destroyer', size: 2 },
] as const

export interface Ship {
  r: number
  c: number
  len: number
  dir: 'h' | 'v'
}
export type Layout = Ship[]
export interface Reveal {
  layout: Layout
  salt: string
}

export type ArmadaMove =
  | { t: 'commit'; h: string }
  | { t: 'shot'; cell: number }
  | { t: 'answer'; r: 'miss' | 'hit' | 'sunk'; reveal?: Reveal }
  | { t: 'reveal'; layout: Layout; salt: string }

export interface ShotRec {
  cell: number
  /** The defender's declared result (trusted in play, verified at the end). */
  r: 'miss' | 'hit' | 'sunk'
}

export interface ArmadaState {
  /** [P0, P1] layout commitments — sequential: P0's must land first. */
  commits: [string | null, string | null]
  /** Answered shots per ATTACKER, in order. */
  shots: [ShotRec[], ShotRec[]]
  /** A fired, not-yet-answered shot. */
  pending: { by: 0 | 1; cell: number } | null
  /** End-of-game reveals per SIDE (loser's rides the final answer). */
  reveals: [Reveal | null, Reveal | null]
  /** The attacker whose 17th declared hit ended the battle (presumptive winner). */
  finalBy: 0 | 1 | null
}

export type ArmadaStatus =
  | { state: 'ongoing'; turn: 0 | 1 }
  | { state: 'won'; winner: 0 | 1 }
  | { state: 'draw' }

/* ---- layout helpers ---- */

export function cellsOf(ship: Ship): number[] {
  const out: number[] = []
  for (let i = 0; i < ship.len; i++) {
    out.push(ship.dir === 'h' ? ship.r * SIZE + ship.c + i : (ship.r + i) * SIZE + ship.c)
  }
  return out
}

/** Structural legality: exactly the fleet, canonical class order, in bounds,
 *  no overlap (touching allowed). */
export function layoutLegal(layout: unknown): layout is Layout {
  if (!Array.isArray(layout) || layout.length !== FLEET.length) return false
  const lens = layout.map((s) => (s as Ship)?.len)
  if (JSON.stringify(lens) !== JSON.stringify([...FLEET])) return false
  const seen = new Set<number>()
  for (const s of layout as Ship[]) {
    if (
      !s || !Number.isInteger(s.r) || !Number.isInteger(s.c) ||
      (s.dir !== 'h' && s.dir !== 'v') ||
      s.r < 0 || s.c < 0 ||
      (s.dir === 'h' ? s.c + s.len > SIZE || s.r >= SIZE : s.r + s.len > SIZE || s.c >= SIZE)
    ) {
      return false
    }
    for (const cell of cellsOf(s)) {
      if (seen.has(cell)) return false
      seen.add(cell)
    }
  }
  return true
}

/** The handoff's UI view of a layout: named ship recs in class order. Derived
 *  for rendering only — never serialized (the wire carries {r,c,len,dir}). */
export function fleetView(layout: Layout): {
  key: string
  name: string
  size: number
  orient: 'h' | 'v'
  cells: number[]
}[] {
  return layout.map((ship, i) => ({
    key: SHIP_CLASSES[i].key,
    name: SHIP_CLASSES[i].name,
    size: SHIP_CLASSES[i].size,
    orient: ship.dir,
    cells: cellsOf(ship),
  }))
}

/** Random legal placement from an injected RNG (Math.random in the app,
 *  seeded in tests). Rejection-samples ship by ship; 10×10 with this fleet
 *  places quickly. Emits canonical class order by construction. */
export function randomLayout(rand: () => number = Math.random): Layout {
  for (;;) {
    const layout: Ship[] = []
    const taken = new Set<number>()
    let ok = true
    for (const len of FLEET) {
      let placed = false
      for (let attempt = 0; attempt < 100 && !placed; attempt++) {
        const dir = rand() < 0.5 ? 'h' : 'v'
        const r = Math.floor(rand() * (dir === 'v' ? SIZE - len + 1 : SIZE))
        const c = Math.floor(rand() * (dir === 'h' ? SIZE - len + 1 : SIZE))
        const ship: Ship = { r, c, len, dir }
        const cells = cellsOf(ship)
        if (cells.every((x) => !taken.has(x))) {
          cells.forEach((x) => taken.add(x))
          layout.push(ship)
          placed = true
        }
      }
      if (!placed) {
        ok = false
        break
      }
    }
    if (ok) return layout
  }
}

/* ---- commitments ---- */

/** Canonical serialization (contract §Layout). The geometry header binds the
 *  board and fleet into the hash: an armada commitment can never verify under
 *  another game's rules, and vice versa. */
export function serializeLayout(layout: Layout, salt: string): string {
  return `10x10|5,4,3,3,2|${layout.map((s) => `${s.r}.${s.c}.${s.len}.${s.dir}`).join(';')}|${salt}`
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function toB64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += B64URL[n & 63]
  }
  return out
}

export function commitment(layout: Layout, salt: string): string {
  return toB64url(sha256(new TextEncoder().encode(serializeLayout(layout, salt))))
}

export function randomSalt(): string {
  return toB64url(randomBytes(32))
}

/** The truthful answer for a shot against `layout`, given every hit cell so
 *  far INCLUDING this one when it hits ('sunk' exactly on a ship's last cell). */
export function judgeShot(layout: Layout, cell: number, hitsSoFar: number[]): 'miss' | 'hit' | 'sunk' {
  const ship = layout.find((s) => cellsOf(s).includes(cell))
  if (!ship) return 'miss'
  const hit = new Set(hitsSoFar)
  hit.add(cell)
  return cellsOf(ship).every((x) => hit.has(x)) ? 'sunk' : 'hit'
}

/* ---- the state machine ---- */

export function createInitialState(): ArmadaState {
  return { commits: [null, null], shots: [[], []], pending: null, reveals: [null, null], finalBy: null }
}

const declaredHits = (recs: ShotRec[]): number => recs.filter((x) => x.r !== 'miss').length

export function turn(s: ArmadaState): 0 | 1 {
  if (s.commits[0] === null) return 0
  if (s.commits[1] === null) return 1
  if (s.finalBy !== null) return s.finalBy // verify phase: the winner owes a reveal
  if (s.pending) return (1 - s.pending.by) as 0 | 1 // the defender answers
  // The last answerer fires next; P0 opens.
  const total = s.shots[0].length + s.shots[1].length
  if (total === 0) return 0
  const lastAttacker = s.shots[0].length > s.shots[1].length ? 0 : s.shots[1].length > s.shots[0].length ? 1 : 1
  return (1 - lastAttacker) as 0 | 1
}

/** May this player act right now? STRICT turn order everywhere — including
 *  placement, where commits are sequential on the wire (P0 then P1). The
 *  parallel-deploy FEEL lives in the UI's staged commit + the duty officer,
 *  never in the rules (the 1033-style parallel gate is the proven seq race). */
export function mayMove(s: ArmadaState, player: 0 | 1): boolean {
  if (status(s).state !== 'ongoing') return false
  return player === turn(s)
}

export function applyMove(s: ArmadaState, move: ArmadaMove, player: 0 | 1): ArmadaState | null {
  if (!move || typeof move !== 'object') return null
  if (!mayMove(s, player)) return null

  // Placing (sequential: turn() routes P0 first, then P1).
  if (s.commits[0] === null || s.commits[1] === null) {
    if (move.t !== 'commit' || typeof move.h !== 'string' || !move.h) return null
    const commits: ArmadaState['commits'] = [...s.commits]
    commits[player] = move.h
    return { ...s, commits }
  }

  // Verify: the presumptive winner closes with their reveal.
  if (s.finalBy !== null) {
    if (move.t !== 'reveal' || !move.salt || !Array.isArray(move.layout)) return null
    const reveals: ArmadaState['reveals'] = [...s.reveals]
    reveals[player] = { layout: move.layout, salt: move.salt }
    return { ...s, reveals }
  }

  // Battle: answer a pending shot, or fire one.
  if (s.pending) {
    if (move.t !== 'answer' || !['miss', 'hit', 'sunk'].includes(move.r)) return null
    const attacker = s.pending.by
    const rec: ShotRec = { cell: s.pending.cell, r: move.r }
    const shots: ArmadaState['shots'] = [attacker === 0 ? [...s.shots[0], rec] : s.shots[0], attacker === 1 ? [...s.shots[1], rec] : s.shots[1]]
    const ends = declaredHits(shots[attacker]) >= FLEET_CELLS
    if (ends) {
      // The FINAL answer must be 'sunk' and carry the loser's reveal.
      if (move.r !== 'sunk' || !move.reveal || !move.reveal.salt || !Array.isArray(move.reveal.layout)) return null
      const reveals: ArmadaState['reveals'] = [...s.reveals]
      reveals[player] = move.reveal
      return { ...s, shots, pending: null, reveals, finalBy: attacker }
    }
    if (move.reveal) return null // reveals ride ONLY the final answer
    return { ...s, shots, pending: null }
  }
  if (move.t !== 'shot' || !Number.isInteger(move.cell) || move.cell < 0 || move.cell >= SIZE * SIZE) return null
  if (s.shots[player].some((x) => x.cell === move.cell)) return null // no repeats
  return { ...s, pending: { by: player, cell: move.cell } }
}

/** Re-check one side's full answer history against their revealed layout. */
export function answersHonest(side: 0 | 1, s: ArmadaState): boolean {
  const reveal = s.reveals[side]
  if (!reveal) return false
  if (!layoutLegal(reveal.layout)) return false
  if (commitment(reveal.layout, reveal.salt) !== s.commits[side]) return false
  // Every answer `side` gave (as the defender of the OTHER side's shots).
  const incoming = s.shots[(1 - side) as 0 | 1]
  const hits: number[] = []
  for (const shot of incoming) {
    const truth = judgeShot(reveal.layout, shot.cell, hits)
    if (truth !== 'miss') hits.push(shot.cell)
    if (shot.r !== truth) return false
  }
  return true
}

export function status(s: ArmadaState): ArmadaStatus {
  if (s.finalBy !== null && s.reveals[0] !== null && s.reveals[1] !== null) {
    const winner = s.finalBy
    const loser = (1 - winner) as 0 | 1
    const winnerHonest = answersHonest(winner, s)
    const loserHonest = answersHonest(loser, s)
    if (winnerHonest) return { state: 'won', winner } // the loser's cheating can't save them
    if (loserHonest) return { state: 'won', winner: loser } // the winner cheated → flip
    return { state: 'draw' } // two cheaters share the disgrace
  }
  return { state: 'ongoing', turn: turn(s) }
}
