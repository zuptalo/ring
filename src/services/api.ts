/**
 * Authenticated HTTP client for the backend's REST surface (prekey
 * distribution). The WebSocket relay is handled separately (transport.ts); this
 * module is for request/response calls that carry the bearer token.
 */
import { apiBaseUrl } from './config';
import { getToken } from './auth';
import type { PublicBundle } from './crypto/identity';
import type { Envelope } from './crypto/envelope';

/** A peer's prekey bundle as returned by GET /v1/keys/{userId}. */
export interface PeerBundleResponse {
  userId: string;
  edPub: string;
  xPub: string;
  signedPreKey: { id: string; pub: string; sig: string };
  oneTimePreKey?: { id: string; pub: string };
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Publish (or rotate) this device's public bundle + one-time prekey pool. */
export async function publishPreKeys(bundle: PublicBundle): Promise<number> {
  const res = await fetch(`${apiBaseUrl()}/v1/keys`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(bundle),
  });
  if (!res.ok) throw new Error(`publish keys failed: ${res.status}`);
  const data = (await res.json()) as { oneTimePreKeys: number };
  return data.oneTimePreKeys;
}

/** How many one-time prekeys remain in this device's server-side pool. */
export async function preKeyCount(): Promise<number> {
  const res = await fetch(`${apiBaseUrl()}/v1/keys/count`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`key count failed: ${res.status}`);
  const data = (await res.json()) as { oneTimePreKeys: number };
  return data.oneTimePreKeys;
}

/** Replenish this device's one-time prekey pool on the server. Returns the new
 *  remaining count. */
export async function addOneTimeKeys(oneTimePreKeys: { id: string; pub: string }[]): Promise<number> {
  const res = await fetch(`${apiBaseUrl()}/v1/keys/onetime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ oneTimePreKeys }),
  });
  if (!res.ok) throw new Error(`add one-time keys failed: ${res.status}`);
  const data = (await res.json()) as { oneTimePreKeys: number };
  return data.oneTimePreKeys;
}

/** Fetch a peer's bundle to bootstrap an X3DH session. Consumes one of their
 *  one-time prekeys server-side. Returns null if the peer hasn't published
 *  (404), e.g. a local-only/demo contact with no real account. */
export async function fetchPeerBundle(userId: string): Promise<PeerBundleResponse | null> {
  const res = await fetch(`${apiBaseUrl()}/v1/keys/${encodeURIComponent(userId)}`, {
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch peer bundle failed: ${res.status}`);
  return (await res.json()) as PeerBundleResponse;
}

/** Delete (terminate) the current account. The server wipes all per-user data
 *  (tokens, prekeys, relay queue, sync records, recovery wrap, push, blocks) but
 *  KEEPS the user row flipped to 'terminated' so the id can't be re-registered and
 *  peers can detect it (POST /v1/status → "Ghosted"). Uploaded media blobs are
 *  retained so peers can still download what was already sent. Idempotent. */
export async function deleteAccount(): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/me`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`delete account failed: ${res.status}`);
}

/** Lifecycle state of a batch of peers, so the client can detect terminated
 *  ("Ghosted") accounts. Unknown ids report 'unknown'. Returns {} on failure. */
export async function fetchUserStatuses(
  ids: string[],
): Promise<Record<string, 'active' | 'terminated' | 'unknown'>> {
  if (ids.length === 0) return {};
  const res = await fetch(`${apiBaseUrl()}/v1/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`status lookup failed: ${res.status}`);
  const data = (await res.json()) as { statuses?: Record<string, 'active' | 'terminated' | 'unknown'> };
  return data.statuses ?? {};
}

/** Block a peer server-side: the relay stops delivering their messages to us and
 *  refuses to hand them our key bundle (so they can't message or re-add us). */
export async function blockUser(userId: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/blocks/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`block failed: ${res.status}`);
}

/** Lift a server-side block on a peer. */
export async function unblockUser(userId: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/blocks/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`unblock failed: ${res.status}`);
}

/** The ids the current user has blocked (to reconcile the local ledger on start). */
export async function fetchBlocks(): Promise<string[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/blocks`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`list blocks failed: ${res.status}`);
  const data = (await res.json()) as { blocked?: string[] };
  return data.blocked ?? [];
}

/* ---- public in-network directory ---- */

/** A public profile in the in-network directory (GET /v1/users). avatar/about are
 *  empty when the owner hid them (privacy tier 'nobody'). */
export interface DirectoryUser {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  about?: string;
  profileAt: number;
}

/** Fetch a page of the directory. `q` substring-matches username/display name;
 *  pass back `nextCursor` to continue. Returns {} on the last page. */
export async function fetchDirectory(
  opts: { q?: string; cursor?: string; limit?: number } = {},
): Promise<{ users: DirectoryUser[]; nextCursor: string }> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`${apiBaseUrl()}/v1/users${qs ? `?${qs}` : ''}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`directory list failed: ${res.status}`);
  const data = (await res.json()) as { users?: DirectoryUser[]; nextCursor?: string };
  return { users: data.users ?? [], nextCursor: data.nextCursor ?? '' };
}

/** Fetch one directory profile. Null (404) if it isn't visible to us (unknown,
 *  terminated, no username, or mutually blocked). */
export async function fetchDirectoryUser(userId: string): Promise<DirectoryUser | null> {
  const res = await fetch(`${apiBaseUrl()}/v1/users/${encodeURIComponent(userId)}`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`directory user failed: ${res.status}`);
  return (await res.json()) as DirectoryUser;
}

/** Update our own directory profile (display name, avatar thumb, About). Never
 *  touches the username. Send '' for avatar/about to hide that field. */
export async function updateDirectoryProfile(profile: {
  displayName: string;
  avatar: string;
  about: string;
}): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(`update profile failed: ${res.status}`);
}

/** Reconcile our contact edges on the server (replace the set). The server uses
 *  these only to compute the presence audience for the 'contacts' tier. */
export async function putContactEdges(ids: string[]): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/contacts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`put contacts failed: ${res.status}`);
}

/** One-time username claim for a legacy account that registered before usernames
 *  existed. Throws 'taken' on 409 conflict. */
export async function claimUsername(username: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/username`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ username }),
  });
  if (res.status === 409) throw new Error('taken');
  if (!res.ok) throw new Error(`claim username failed: ${res.status}`);
}

/* ---- encrypted own-data sync (7e) ---- */

export interface SyncRecord {
  store: string;
  recordId: string;
  updatedAt: number;
  ciphertext?: string; // opaque sealed record ('' / omitted when deleted)
  deleted?: boolean;
  seq?: number;
}

/** Push a batch of encrypted records; returns the server's new cursor. */
export async function pushSyncRecords(records: SyncRecord[]): Promise<number> {
  const res = await fetch(`${apiBaseUrl()}/v1/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ records }),
  });
  if (!res.ok) throw new Error(`sync push failed: ${res.status}`);
  const data = (await res.json()) as { cursor: number };
  return data.cursor;
}

/** Pull records changed after `cursor`. */
export async function pullSyncRecords(cursor: number): Promise<{ records: SyncRecord[]; cursor: number }> {
  const res = await fetch(`${apiBaseUrl()}/v1/sync/pull?cursor=${cursor}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`sync pull failed: ${res.status}`);
  return (await res.json()) as { records: SyncRecord[]; cursor: number };
}

/** Upload the recovery wrap (idempotent; replaces any existing). `lookup` is the
 *  one-way hash of the recovery code that lets a new device find this account. */
export async function putRecoveryWrap(salt: string, envelope: Envelope, lookup: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/recovery`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ salt, envelope, lookup }),
  });
  if (!res.ok) throw new Error(`put recovery wrap failed: ${res.status}`);
}

/** New-device restore, step 1 (UNAUTHENTICATED; the device has no token yet).
 *  Resolve a recovery-code lookup hash to the account's wrap + a challenge to
 *  sign. Throws a friendly error when no account advertises that code. */
export async function recoveryBegin(
  lookup: string,
): Promise<{ userId: string; salt: string; envelope: Envelope; challenge: string }> {
  const res = await fetch(`${apiBaseUrl()}/v1/recovery/begin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lookup }),
  });
  if (res.status === 404) throw new Error('No account found for that recovery code.');
  if (!res.ok) throw new Error('Cannot reach the server. Check your connection and try again.');
  return (await res.json()) as { userId: string; salt: string; envelope: Envelope; challenge: string };
}

/** New-device restore, step 2 (UNAUTHENTICATED). Submit the signed challenge;
 *  the server verifies it against the account's identity key and mints a token. */
export async function recoveryComplete(
  userId: string,
  challenge: string,
  signature: string,
): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${apiBaseUrl()}/v1/recovery/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, challenge, signature }),
  });
  if (!res.ok) throw new Error('Recovery verification failed. Please check your code and try again.');
  return (await res.json()) as { token: string; userId: string };
}

/** Fetch the stored recovery wrap (for restore on a new device). Null if none. */
export async function getRecoveryWrap(): Promise<{ salt: string; envelope: Envelope } | null> {
  const res = await fetch(`${apiBaseUrl()}/v1/recovery`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get recovery wrap failed: ${res.status}`);
  return (await res.json()) as { salt: string; envelope: Envelope };
}

/* ---- server config + Web Push (7f) ---- */

/** Public server config: backend URL, Web Push VAPID public key, and the per-upload
 *  blob size cap (bytes) so clients can pre-validate large attachments. */
export async function fetchServerConfig(): Promise<{
  publicUrl: string;
  vapidPublicKey: string;
  maxBlobBytes?: number;
  version?: string;
}> {
  // Bounded so a hung /v1/config can't stall callers that gate on it (push
  // (re)subscription, version checks). A slow-but-alive network still succeeds.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/v1/config`, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`server config failed: ${res.status}`);
  return (await res.json()) as { publicUrl: string; vapidPublicKey: string; maxBlobBytes?: number; version?: string };
}

/** Register a browser push subscription with the backend. */
export async function subscribePush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(sub),
  });
  if (!res.ok) throw new Error(`push subscribe failed: ${res.status}`);
}

/** Mint a single-use invitation code (owned by the current user) to share. */
export async function createInvitation(): Promise<{ code: string; publicUrl: string }> {
  const res = await fetch(`${apiBaseUrl()}/v1/invitations`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (res.status === 429) throw new Error('You have too many unused invitations. Use or wait for those first.');
  if (!res.ok) throw new Error(`create invitation failed: ${res.status}`);
  return (await res.json()) as { code: string; publicUrl: string };
}

export interface ServerInvitation {
  code: string;
  createdAt: number;
  expiresAt?: number; // ms; absent for legacy never-expiring codes
  usedBy: string; // redeemer's user id, "" if not yet redeemed
  usedAt?: number;
}

/** List the current user's created invitation codes + redemption state. */
export async function listInvitations(): Promise<ServerInvitation[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/invitations`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`list invitations failed: ${res.status}`);
  const data = (await res.json()) as { invitations?: ServerInvitation[] };
  return data.invitations ?? [];
}

/** Extend an unused invitation's validity by 24 hours (works even after it expired).
 *  Returns the new expiry in ms. */
export async function extendInvitation(code: string): Promise<number> {
  const res = await fetch(`${apiBaseUrl()}/v1/invitations/${encodeURIComponent(code)}/extend`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (res.status === 404) throw new Error('That invitation can’t be extended (it was used or removed).');
  if (!res.ok) throw new Error(`extend invitation failed: ${res.status}`);
  const data = (await res.json()) as { expiresAt?: number };
  return data.expiresAt ?? 0;
}

/** Cancel (delete) an unused invitation so it can no longer be redeemed. Idempotent:
 *  a 404 (already used/removed) is treated as success. */
export async function cancelInvitation(code: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/invitations/${encodeURIComponent(code)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`cancel invitation failed: ${res.status}`);
}

/** Remove a push subscription from the backend. */
export async function unsubscribePushServer(endpoint: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) throw new Error(`push unsubscribe failed: ${res.status}`);
}
