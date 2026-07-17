/**
 * Sealing for ephemeral activity indicators (spec 1009).
 *
 * The activity KIND (+ group id) is sealed peer-to-peer so the relay sees only
 * {t, to, from}. Per the D3 decision (maintainer-signed-off 2026-06-17) the
 * sealing key is a LONG-TERM pairwise key derived from the two parties' X25519
 * IDENTITY keys via static-static DH + HKDF:
 *
 *     activityKey = HKDF(x25519(myIdentityX.priv, peerIdentityX.pub), "ring/activity/v1")
 *
 * It is identical on both sides (DH is symmetric), stable for the life of the
 * identity keys, and computable for ANY peer whose bundle is published. It does
 * NOT touch the Double Ratchet (no churn) and reuses only existing primitives
 * (x25519 + hkdf + the AEAD envelope) — no new/hand-rolled crypto. Tradeoff,
 * accepted in the D3 sign-off: no forward secrecy, fine for this never-stored,
 * low-sensitivity signal.
 *
 * Fail-closed: if we're locked or the peer has no published bundle, sealing
 * returns null and the caller suppresses the signal — it is never sent unsealed.
 */
import { getIdentityKeys, isUnlockedNow } from './identity';
import { x25519, hkdf } from './primitives';
import { sealJson, openJson, utf8ToBytes, b64urlToBytes, type Envelope } from './envelope';
import { fetchPeerBundle } from '@/services/api';
import type { ActivityKind, ActivityState } from '@/services/transport';

const INFO = utf8ToBytes('ring/activity/v1');
const KID = 'activity';

export interface ActivityPayload {
  c: string; // conversation id for groups (the shared group id); '' for 1:1 (peer is implied)
  k: ActivityKind;
  s: ActivityState;
}

// In-memory cache of the derived per-peer activity key (never persisted). The key
// is stable (identity-keyed), so caching avoids a bundle fetch on every keystroke.
const keyCache = new Map<string, Uint8Array>();

async function activityKeyFor(otherUserId: string): Promise<Uint8Array | null> {
  const cached = keyCache.get(otherUserId);
  if (cached) return cached;
  if (!isUnlockedNow()) return null; // our identity key is needed to derive
  const peer = await fetchPeerBundle(otherUserId);
  if (!peer) return null; // no published bundle (local-only/non-account) → fail closed
  const me = getIdentityKeys();
  const shared = x25519(me.x.privateKey, b64urlToBytes(peer.xPub));
  const key = hkdf(shared, 32, undefined, INFO);
  keyCache.set(otherUserId, key);
  return key;
}

/** Seal an activity payload for `peerUserId`. Returns null (→ suppress) if it can't be sealed. */
export async function sealActivity(peerUserId: string, payload: ActivityPayload): Promise<Envelope | null> {
  const key = await activityKeyFor(peerUserId);
  if (!key) return null;
  return sealJson(key, payload, KID);
}

/** Open an activity envelope from `senderUserId`. Returns null if undecryptable / unavailable. */
export async function openActivity(senderUserId: string, env: Envelope): Promise<ActivityPayload | null> {
  const key = await activityKeyFor(senderUserId);
  if (!key) return null;
  try {
    return openJson<ActivityPayload>(key, env);
  } catch {
    return null; // wrong key / tampered / unknown format → ignore
  }
}

/** Drop cached activity keys (on sign-out), like clearTyping()/clearPresence(). */
export function clearActivityKeys(): void {
  keyCache.clear();
}
