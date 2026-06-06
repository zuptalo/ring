/**
 * On-device authentication.
 *
 * Model (no passwords, possession of the device token IS the session):
 *  - Register with a one-time invitation code → the server issues a device token
 *    we persist; subsequent launches authenticate automatically from it.
 *  - Restore on a NEW device with the recovery code (beginRestore/finishRestore)
 *    re-derives the identity and mints a fresh token for the same account.
 *  - There is no token "sign-in" screen: signing out wipes the token + keys, so a
 *    returning user re-registers or restores.
 */

import { ref, readonly } from 'vue';
import { resetOnboarding } from './permissions';
import {
  wipeIdentity,
  lock,
  recoveryLookupId,
  buildRecoveryProof,
  installRestored,
  type RecoveredCore,
} from './crypto/identity';
import type { Envelope } from './crypto/envelope';
import { recoveryBegin, recoveryComplete } from './api';
import { apiBaseUrl } from './config';
import { wipeAllStores } from '@/db/idb';
import { mirrorSession, clearSession, readSessionToken } from './session';

const TOKEN_KEY = 'ring.webAccessToken';
// The account's server-assigned user id, returned by the backend at
// registration. This is how peers address this device (their Contact.id ==
// this user id), so we persist it alongside the token.
const USERID_KEY = 'ring.userId';
// The account's immutable, network-unique username, chosen at registration. It's
// the discovery handle + anti-impersonation anchor; persisted so the UI can show
// "@you" without a round-trip.
const USERNAME_KEY = 'ring.username';
// Accept a 6 to 8 character alphanumeric invitation code: the standalone
// LoginPage uses a 6-box OTP, while the experimental Auth tab uses an 8-char
// text field. Widening to {6,8} lets both flows validate against this service.
const INVITE_RE = /^[A-Za-z0-9]{6,8}$/;
// Mirrors the server's usernameRE (internal/api/username.go): 3 to 30 chars, ASCII
// letters/digits/underscore plus interior dots, can't start/end with a dot.
const USERNAME_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9_.]{1,28}[A-Za-z0-9_])$/;

/** Read the device-stored web access token, if any. */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** This device's server-assigned user id, if registered. Peers use it to add
 *  this account (their Contact.id == this id). */
export function getSelfUserId(): string | null {
  try {
    return localStorage.getItem(USERID_KEY);
  } catch {
    return null;
  }
}

/** This account's immutable username (handle), if known. */
export function getSelfUsername(): string | null {
  try {
    return localStorage.getItem(USERNAME_KEY);
  } catch {
    return null;
  }
}

/** Persist the account username (set at registration; also refreshed from
 *  /v1/me or a legacy claim). */
export function setSelfUsername(username: string): void {
  try {
    localStorage.setItem(USERNAME_KEY, username);
  } catch {
    /* non-fatal */
  }
}

function persistSession(token: string, userId: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERID_KEY, userId);
  } catch {
    throw new Error('Unable to store the access token on this device.');
  }
  // Mirror into IndexedDB so the service worker (which can't read localStorage)
  // can authenticate to drain the relay for background decryption. Fire-and-forget.
  void mirrorSession(token, userId);
}

/** Ensure the service-worker-readable IDB copy of the token exists. Called once at
 *  boot to migrate already-logged-in users who registered before the token was
 *  mirrored. */
export async function ensureSessionMirrored(): Promise<void> {
  const token = getToken();
  const userId = getSelfUserId();
  if (!token || !userId) return;
  try {
    if (!(await readSessionToken())) await mirrorSession(token, userId);
  } catch {
    /* non-fatal, retried next boot / login */
  }
}

/** Shape check for a username (the backend is the authority on uniqueness). */
export function isUsernameFormatValid(username: string): boolean {
  return USERNAME_RE.test(username.trim()) && !username.includes('..');
}

/**
 * Reactive source of truth for "is this device registered". Components read
 * `isAuthenticated` (e.g. to decide which tabs are visible) and the router
 * guard reads it, so the UI updates the instant register/login/sign-out change
 * the stored token. Initialized from whatever is already persisted.
 */
const authed = ref(!!getToken());
export const isAuthenticated = readonly(authed);

/** True when this device has already been registered. */
export function hasToken(): boolean {
  return !!getToken();
}

/** Remove the stored token (sign out / reset device). */
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERID_KEY);
    localStorage.removeItem(USERNAME_KEY);
  } catch {
    /* ignore */
  }
  authed.value = false;
  // Sign-out destroys this device's key material: lock memory immediately and
  // wipe the persisted keystore (fire-and-forget; the keystore lives in IDB).
  lock();
  void clearSession();
  void wipeIdentity();
  // Re-arm the permission wizard so it runs again for the next authenticated
  // user (only re-prompts when the OS permission is still undecided; see
  // resetOnboarding's note on why granted/denied can't be re-requested).
  resetOnboarding();
}

let resetting = false;

/**
 * Full local reset to a fresh, unregistered state: erase every on-device store
 * and the token/identity. Used when the server no longer recognizes this device
 * (the account was deleted, or the database was wiped) so the app drops back to
 * onboarding cleanly. Setting the token to null flips `isAuthenticated`, which
 * the app watches to land on the Auth view.
 */
export async function resetToFresh(): Promise<void> {
  if (resetting) return;
  resetting = true;
  try {
    await wipeAllStores();
  } catch {
    /* best-effort; still clear the token below */
  } finally {
    clearToken(); // token + identity + authed=false
    resetting = false;
  }
}

/**
 * Ask the server whether this device's token is still valid (GET /v1/me). If the
 * server rejects it (401, the account/token no longer exists) the device is
 * wiped back to a fresh state. A network/5xx error is treated as "unknown" and
 * does NOT reset; we don't erase local data just because the server is down.
 */
export async function verifySessionOrReset(): Promise<void> {
  const token = getToken();
  if (!token || resetting) return;
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/v1/me`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return; // unreachable, keep state, retry on the next trigger
  }
  if (res.status === 401) {
    await resetToFresh();
  }
}

/** Shape check for an invitation code. */
export function isInvitationFormatValid(code: string): boolean {
  return INVITE_RE.test(code);
}

/** Client-side format pre-check (the backend is the authority on validity). */
export async function validateInvitationCode(code: string): Promise<boolean> {
  return isInvitationFormatValid(code);
}

interface RegisterResponse {
  token: string;
  userId: string;
  username: string;
  invitedBy?: string; // who created the redeemed code (for auto-connect)
}

// Stashed at registration; the sync layer connects us to this inviter once the
// keystore is unlocked, then clears it.
const INVITED_BY_KEY = 'ring.invitedBy';
export function getPendingInviter(): string | null {
  return localStorage.getItem(INVITED_BY_KEY);
}
export function clearPendingInviter(): void {
  localStorage.removeItem(INVITED_BY_KEY);
}

/**
 * Register this device against the backend with an invitation code and a chosen
 * immutable username. The server validates the code + username (network-unique),
 * creates the account, and issues the access token + user id, which we persist.
 * Returns the token on success. Throws 'username-taken' if the handle is already
 * claimed (409) so the UI can prompt for another, or a friendly message otherwise.
 */
export async function register(code: string, username: string): Promise<string> {
  if (!isInvitationFormatValid(code)) {
    throw new Error('Invalid or expired invitation code.');
  }
  if (!isUsernameFormatValid(username)) {
    throw new Error('Please choose a valid username (3 to 30 letters, digits, _ or .).');
  }
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitationCode: code, username: username.trim() }),
    });
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 409) {
    throw new Error('username-taken');
  }
  if (res.status === 400) {
    // A 400 covers two very different causes: a bad/expired invite, or a rejected
    // username (invalid format or a reserved handle like @admin/@me). Distinguish
    // them from the server message so the UI can offer the right fix (change the
    // name vs. get a new/extended code) instead of dead-ending on the wrong one.
    let serverMsg = '';
    try {
      serverMsg = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* no body */
    }
    if (/username/i.test(serverMsg) && !/invitation/i.test(serverMsg)) {
      throw new Error('username-rejected');
    }
    throw new Error('invite-invalid');
  }
  if (!res.ok) {
    throw new Error('Registration failed. Please try again.');
  }
  const data = (await res.json()) as RegisterResponse;
  persistSession(data.token, data.userId);
  if (data.username) setSelfUsername(data.username);
  // Remember who invited us so we auto-connect to them once unlocked.
  if (data.invitedBy) localStorage.setItem(INVITED_BY_KEY, data.invitedBy);
  authed.value = true;
  return data.token;
}

/* ---- new-device restore (recovery code) ---- */

/** Everything needed to finish a restore once the user picks a new passcode.
 *  Held only in memory between the two steps, never persisted. */
export interface StagedRestore {
  token: string;
  userId: string;
  core: RecoveredCore;
  recoverySalt: string;
  recoveryWrapped: Envelope;
  recoveryLookup: string;
}

/**
 * Restore step 1: from the recovery code, find the account, recover the identity
 * key, prove possession to the server, and obtain a device token. The token is
 * NOT persisted here; it's returned for finishRestore to commit only after the
 * keystore is installed, so a reload mid-flow can never leave a stored token with
 * no (or a wrong, freshly-generated) identity.
 */
export async function beginRestore(code: string): Promise<StagedRestore> {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('Enter your recovery code.');
  const lookup = recoveryLookupId(trimmed);
  const begun = await recoveryBegin(lookup); // throws "No account…" on 404
  let proof;
  try {
    proof = buildRecoveryProof(begun.envelope, begun.salt, trimmed, begun.challenge);
  } catch {
    throw new Error('That recovery code did not match this account.');
  }
  const { token } = await recoveryComplete(begun.userId, begun.challenge, proof.signature);
  return {
    token,
    userId: begun.userId,
    core: proof.core,
    recoverySalt: begun.salt,
    recoveryWrapped: begun.envelope,
    recoveryLookup: lookup,
  };
}

/**
 * Restore step 2: install the recovered identity, THEN commit the session. Order
 * matters: if the keystore write fails we stay un-authed and the user can retry,
 * instead of being stuck authenticated with no identity.
 *
 * `pin` is OPTIONAL and omitted by default: a restored account uses the same
 * passwordless device-key posture as a fresh registration (a passcode is opt-in
 * later in Settings). Restoring with a recovery key never forces a passcode.
 */
export async function finishRestore(staged: StagedRestore, pin?: string): Promise<void> {
  await installRestored(staged.core, staged.recoverySalt, staged.recoveryWrapped, staged.recoveryLookup, pin);
  persistSession(staged.token, staged.userId);
  authed.value = true;
}
