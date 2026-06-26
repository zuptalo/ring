/**
 * Hidden Chats — the local, zero-knowledge privacy layer (spec 1019).
 *
 * A hidden chat is an ordinary conversation whose id is recorded in a per-device
 * "hidden set". That set, and a separate dedicated reveal PIN, live ONLY on this
 * device and never cross the wire (the server already can't read conversation
 * content; hiding adds no new signal — see spec §Zero-Knowledge Impact).
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
import { getSetting, setSetting, createGroup } from '@/db/queries';
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
  length: number; // digit count, for auto-verify-at-length
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
  const raw = await getSetting<EncWrapper | undefined>(SET_KEY, undefined);
  if (!raw) return new Set();
  return new Set(openSet(raw));
}

// Inject the decryptor into the leaf so `listChats`/`listCallGroups` can lazily
// populate the cache without importing this (queries-dependent) module.
registerHiddenLoader(loadSet);

async function persist(ids: Set<string>): Promise<void> {
  await setSetting<EncWrapper>(SET_KEY, sealSet([...ids]));
  setHiddenIdsCache(ids);
}

/** The set of conversation ids hidden on this device (cached after first load). */
export async function getHiddenSet(): Promise<Set<string>> {
  return ensureHiddenLoaded();
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
  return (await getSetting<HiddenPinRec | undefined>(PIN_KEY, undefined)) != null;
}

/** Set (or replace) the dedicated reveal PIN. */
export async function enableHiddenPin(pin: string): Promise<void> {
  const salt = randomBytes(ARGON_SALT_BYTES);
  const key = argon2id(pin, salt);
  const env = sealJson(key, PIN_MARKER, 'pin');
  await setSetting<HiddenPinRec>(PIN_KEY, { salt: bytesToB64url(salt), env, length: pin.length });
}

/** Verify a reveal-PIN attempt. Returns false (no oracle) on any failure. */
export async function verifyHiddenPin(pin: string): Promise<boolean> {
  const rec = await getSetting<HiddenPinRec | undefined>(PIN_KEY, undefined);
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
  const rec = await getSetting<HiddenPinRec | undefined>(PIN_KEY, undefined);
  return rec ? rec.length : null;
}

/* ---- starting a distinct, coexisting hidden conversation (US2) ---- */

/**
 * Start a NEW hidden conversation with a contact, modeled on the group mechanism
 * so it coexists with any normal 1:1 with the same person (a distinct id, its own
 * history). Reuses the existing sender-key crypto — no new scheme. Returns the
 * new conversation id, already added to the hidden set.
 */
export async function startHiddenChat(contactId: string): Promise<string> {
  const groupId = await createGroup('', [contactId]);
  await addHidden(groupId);
  return groupId;
}
