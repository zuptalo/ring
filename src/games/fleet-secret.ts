// Device-local fleet secrets, namespaced (spec 1038): the layout + salt
// behind a player's commitment, plus the staged-commit pointer for armada's
// sequential-wire deployment. NEVER leaves this device before the end-of-game
// reveal — deliberately NOT part of Message.game / the wall session (both are
// shared), and excluded from own-data sync by simply never being listed in
// SYNCED_PREF_KEYS. Reads idb directly (no queries import → no cycle; same
// reasoning as game-sounds.ts).
//
// Battleship's original helper (battleship/secret.ts, keys
// `battleship.secret.*`) stays byte-untouched behind its frozen id; this
// generalization exists so armada's `armada.secret.*` namespace can never
// collide with it while legacy games finish.

import { get, put, remove } from '@/db/idb'

export interface FleetSecret {
  layout: { r: number; c: number; len: number; dir: 'h' | 'v' }[]
  salt: string
}

/** A commitment staged while its wire slot wasn't open (sequential commits,
 *  contract §Moves). Keyed by SESSION (message/post id) — the one pointer
 *  that lets the duty officer find the right secret before the commit is in
 *  the shared log. */
export interface StagedCommit {
  h: string
}

const secretKey = (ns: string, commitment: string): string => `${ns}.secret.${commitment}`
const stagedKey = (ns: string, sessionKey: string): string => `${ns}.staged.${sessionKey}`

export async function getFleetSecret(ns: string, commitment: string): Promise<FleetSecret | null> {
  const row = await get<{ key: string; value: FleetSecret }>('settings', secretKey(ns, commitment))
  return row?.value ?? null
}

export async function setFleetSecret(ns: string, commitment: string, secret: FleetSecret): Promise<void> {
  // Normalize to PLAIN objects at the choke point: callers hand us Vue
  // reactive refs, and a Proxy-wrapped array throws DataCloneError in
  // IndexedDB (the same trap the wall composer hit on iOS).
  const plain: FleetSecret = {
    layout: secret.layout.map((s) => ({ r: s.r, c: s.c, len: s.len, dir: s.dir })),
    salt: secret.salt,
  }
  await put('settings', { key: secretKey(ns, commitment), value: plain })
}

/** Called when the game reaches a terminal state (the reveal made the secret
 *  public) or the bubble/post is gone — the secret has no reason to outlive it. */
export async function clearFleetSecret(ns: string, commitment: string): Promise<void> {
  await remove('settings', secretKey(ns, commitment)).catch(() => {})
}

export async function getStagedCommit(ns: string, sessionKey: string): Promise<StagedCommit | null> {
  const row = await get<{ key: string; value: StagedCommit }>('settings', stagedKey(ns, sessionKey))
  return row?.value ?? null
}

export async function setStagedCommit(ns: string, sessionKey: string, staged: StagedCommit): Promise<void> {
  await put('settings', { key: stagedKey(ns, sessionKey), value: { h: staged.h } })
}

/** Cleared when the commit lands in the log (the stage served its purpose)
 *  or with the secret's other lifecycle events. */
export async function clearStagedCommit(ns: string, sessionKey: string): Promise<void> {
  await remove('settings', stagedKey(ns, sessionKey)).catch(() => {})
}
