// Device-local fleet secrets (spec 0011): the layout + salt behind a player's
// commitment. NEVER leaves this device before the end-of-game reveal — it is
// deliberately NOT part of Message.game / the wall session (both are shared),
// and the settings store is excluded from own-data sync for this namespace by
// simply never being listed in SYNCED_PREF_KEYS. Reads idb directly (no
// queries import → no cycle; same reasoning as game-sounds.ts).

import { get, put, remove } from '@/db/idb'
import type { Layout } from './logic'

export interface FleetSecret {
  layout: Layout
  salt: string
}

const key = (gameId: string): string => `battleship.secret.${gameId}`

export async function getFleetSecret(gameId: string): Promise<FleetSecret | null> {
  const row = await get<{ key: string; value: FleetSecret }>('settings', key(gameId))
  return row?.value ?? null
}

export async function setFleetSecret(gameId: string, secret: FleetSecret): Promise<void> {
  // Normalize to PLAIN objects at the choke point: callers hand us Vue
  // reactive refs, and a Proxy-wrapped array throws DataCloneError in
  // IndexedDB (the same trap the wall composer hit on iOS).
  const plain: FleetSecret = {
    layout: secret.layout.map((s) => ({ r: s.r, c: s.c, len: s.len, dir: s.dir })),
    salt: secret.salt,
  }
  await put('settings', { key: key(gameId), value: plain })
}

/** Called when the game reaches a terminal state (the reveal made the secret
 *  public) or the bubble/post is gone — the secret has no reason to outlive it. */
export async function clearFleetSecret(gameId: string): Promise<void> {
  await remove('settings', key(gameId)).catch(() => {})
}
