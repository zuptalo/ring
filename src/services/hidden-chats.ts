/**
 * Hidden Chats — the local, zero-knowledge privacy layer (spec 1019, hardened
 * and given its per-person model by spec 1027).
 *
 * A hidden chat is an ordinary conversation whose id is recorded in a per-device
 * "hidden set". That set, and a separate dedicated reveal PIN, live ONLY on this
 * device and never cross the wire (the server already can't read conversation
 * content; hiding adds no new signal — see spec §Zero-Knowledge Impact).
 *
 * Per person there is at most ONE hidden and ONE visible chat (`hidden-pair.ts`
 * enforces it), inbound frames route to the hidden thread instead of minting a
 * visible one (`inbound-route.ts`), and a destructive reset blocks the live
 * relay path too (`hidden-chats-reset.ts` + the hiddenPeer tombstones).
 *
 * Storage (both device-local `settings` keys, deliberately excluded from
 * own-data sync so hiding stays per-device):
 *   - `privacy.hiddenChats`: the set of hidden conversation ids, AEAD-sealed under
 *     the master key (so it can't be read off the device without unlocking, yet is
 *     readable while the app is unlocked to exclude hidden chats *by default*).
 *   - `privacy.hiddenPin`: a separate PIN verifier — a marker sealed under an
 *     Argon2id key derived from the dedicated PIN. "Verify" is decryption success;
 *     the PIN is never stored in recoverable form (FR-010/FR-015). Argon2id's cost
 *     is the brute-force mitigation (FR-022).
 *
 * Knowing membership (to hide by default) is separate from authorizing a reveal:
 * the master-key-sealed set answers "is this hidden?"; the dedicated PIN authorizes
 * flipping the in-memory reveal session (held in `hidden-state.ts`).
 */
// Deliberately depends ONLY on idb + crypto (no `queries.ts`): this module is
// pulled into the service-worker bundle via `readHiddenSet`, and `queries.ts`
// drags in DOM-heavy media code the SW can't (and shouldn't) load. The one
// queries-dependent action, `startHiddenChat`, lives in `hidden-chats-start.ts`.
import { get, put, remove } from '@/db/idb';
import { getMasterKey } from '@/services/crypto/identity';
import {
  sealJson,
  openJson,
  utf8ToBytes,
  bytesToB64url,
  b64urlToBytes,
  type Envelope,
} from '@/services/crypto/envelope';
import { argon2id, randomBytes, ARGON_SALT_BYTES } from '@/services/crypto/primitives';
import {
  registerHiddenLoader,
  ensureHiddenLoaded,
  setHiddenIdsCache,
} from '@/services/hidden-state';

// Local settings get/put (same shape as queries.getSetting/setSetting) so this
// module needs no `queries.ts` import.
async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await get<{ key: string; value: T }>('settings', key);
  return s ? s.value : fallback;
}
function writeSetting<T>(key: string, value: T): Promise<void> {
  return put('settings', { key, value });
}

const SET_KEY = 'privacy.hiddenChats';
const PIN_KEY = 'privacy.hiddenPin';
// Versioned marker: decrypting it back proves the PIN. Opaque; carries no secret.
const PIN_MARKER = 'ring-hidden-v1';

/** Encrypted-at-rest wrapper, mirroring `src/db/secrets.ts`'s shape. */
interface EncWrapper {
  __enc: 1;
  env: Envelope;
}
interface HiddenPinRec {
  salt: string; // b64url Argon2id salt (clear)
  env: Envelope; // PIN_MARKER sealed under the PIN-derived key
  // Digit count for auto-verify-at-length, SEALED under the master key (spec
  // 1027 T044): stored in the clear it told anyone reading IndexedDB how many
  // digits to brute-force. The search-bar gesture only needs it while the app
  // is unlocked, so master-key sealing costs no availability.
  len?: Envelope;
  length?: number; // legacy cleartext count (pre-1027) — migrated on first read
}

const LEN_AAD = 'privacy.hiddenPin.len';

function sealLen(n: number): Envelope {
  return sealJson(getMasterKey(), n, 'master', utf8ToBytes(LEN_AAD));
}

/* ---- hidden set: master-key-sealed, device-local ---- */

function sealSet(ids: string[]): EncWrapper {
  return { __enc: 1, env: sealJson(getMasterKey(), ids, 'master', utf8ToBytes(SET_KEY)) };
}

function openSet(w: EncWrapper): string[] {
  return openJson<string[]>(getMasterKey(), w.env, utf8ToBytes(SET_KEY));
}

/** Decrypt the stored set. Throws if locked (caller fails closed). */
async function loadSet(): Promise<Set<string>> {
  const raw = await readSetting<EncWrapper | undefined>(SET_KEY, undefined);
  if (!raw) return new Set();
  return new Set(openSet(raw));
}

// Inject the decryptor into the leaf so `listChats`/`listCallGroups` can lazily
// populate the cache without importing this (queries-dependent) module.
registerHiddenLoader(loadSet);

async function persist(ids: Set<string>): Promise<void> {
  await writeSetting<EncWrapper>(SET_KEY, sealSet([...ids]));
  setHiddenIdsCache(ids);
}

/** The set of conversation ids hidden on this device (cached after first load). */
export async function getHiddenSet(): Promise<Set<string>> {
  return ensureHiddenLoaded();
}

/**
 * Direct (uncached, no side effects) read of the hidden set — for the service
 * worker's notification path. Fails CLOSED to an empty set when locked; that's
 * safe because a locked keystore also can't decrypt the message, so the SW
 * already shows a generic, content-free notification in that case.
 */
export async function readHiddenSet(): Promise<Set<string>> {
  return (await readHiddenSetOrNull()) ?? new Set();
}

/**
 * Like readHiddenSet, but distinguishes "no chats hidden" (a set) from "can't
 * know — keystore locked" (null). The SW badge needs the difference (spec 1027
 * B4): under badge mode 'never'/'revealed' an unreadable set must fall back to
 * the last preference-filtered count, not be mistaken for "nothing hidden"
 * (which would count hidden unreads against the user's explicit choice).
 */
export async function readHiddenSetOrNull(): Promise<Set<string> | null> {
  try {
    return await loadSet();
  } catch {
    return null;
  }
}

export async function isHidden(chatId: string): Promise<boolean> {
  return (await getHiddenSet()).has(chatId);
}

/** Hide an existing conversation. */
export async function addHidden(chatId: string): Promise<void> {
  const ids = new Set(await getHiddenSet());
  if (ids.has(chatId)) return;
  ids.add(chatId);
  await persist(ids);
}

/** Permanently unhide a conversation (it returns to the normal list). */
export async function removeHidden(chatId: string): Promise<void> {
  const ids = new Set(await getHiddenSet());
  if (!ids.delete(chatId)) return;
  await persist(ids);
}

/* ---- separate dedicated PIN ---- */

export async function hasHiddenPin(): Promise<boolean> {
  return (await readSetting<HiddenPinRec | undefined>(PIN_KEY, undefined)) != null;
}

/** Set (or replace) the dedicated reveal PIN. */
export async function enableHiddenPin(pin: string): Promise<void> {
  const salt = randomBytes(ARGON_SALT_BYTES);
  const key = argon2id(pin, salt);
  const env = sealJson(key, PIN_MARKER, 'pin');
  await writeSetting<HiddenPinRec>(PIN_KEY, {
    salt: bytesToB64url(salt),
    env,
    len: sealLen(pin.length),
  });
}

/** Verify a reveal-PIN attempt. Returns false (no oracle) on any failure. */
export async function verifyHiddenPin(pin: string): Promise<boolean> {
  const rec = await readSetting<HiddenPinRec | undefined>(PIN_KEY, undefined);
  if (!rec) return false;
  try {
    const key = argon2id(pin, b64urlToBytes(rec.salt));
    return openJson<string>(key, rec.env) === PIN_MARKER;
  } catch {
    return false;
  }
}

/** Change the PIN (requires the old one). Re-wraps the verifier; the set is
 *  independent of the PIN, so there is no window where it is unprotected. */
export async function changeHiddenPin(oldPin: string, newPin: string): Promise<void> {
  if (!(await verifyHiddenPin(oldPin))) throw new Error('incorrect PIN');
  await enableHiddenPin(newPin);
}

export async function hiddenPinLength(): Promise<number | null> {
  const rec = await readSetting<HiddenPinRec | undefined>(PIN_KEY, undefined);
  if (!rec) return null;
  if (rec.len) {
    try {
      return openJson<number>(getMasterKey(), rec.len, utf8ToBytes(LEN_AAD));
    } catch {
      return null; // locked → the reveal gesture simply stays un-armed
    }
  }
  // Legacy pre-1027 record with a CLEARTEXT length: migrate in place (reseal +
  // drop the plaintext) on first read while unlocked.
  if (typeof rec.length === 'number') {
    const n = rec.length;
    try {
      await writeSetting<HiddenPinRec>(PIN_KEY, { salt: rec.salt, env: rec.env, len: sealLen(n) });
    } catch {
      /* locked → keep the legacy shape; the next unlocked read migrates it */
    }
    return n;
  }
  return null;
}

/** Erase the hidden set + PIN material from storage and the in-memory cache.
 *  Used by the destructive PIN reset (the conversation wipe lives in
 *  `hidden-chats-reset.ts`). */
export async function clearHiddenStorage(): Promise<void> {
  await remove('settings', SET_KEY);
  await remove('settings', PIN_KEY);
  setHiddenIdsCache(new Set());
}
