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

/* ---- social Wall (spec 0003) ---- */

/** A post envelope on the wire: a recipient + their wrapped K_post. */
export interface PostEnvelopeWire {
  recipient: string;
  wrappedKey: string;
}

/** Create a post: opaque blob id + per-recipient wrapped-key envelopes + coarse
 *  expiry. The server stores ciphertext only and addresses delivery to the envelopes;
 *  it rejects (403) any recipient who isn't an accepted friend. */
export async function createPost(req: {
  id: string;
  blobId: string;
  size: number;
  expiresAt?: number;
  ttlMs?: number;
  envelopes: PostEnvelopeWire[];
}): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`create post failed: ${res.status}`);
}

/** A post as delivered to the caller. `wrappedKey` is the caller's envelope (absent
 *  for the caller's own posts). All content is in the opaque blob. */
export interface ServerPost {
  id: string;
  author: string;
  blobId: string;
  size: number;
  createdAt: number;
  expiresAt?: number;
  ttlMs?: number;
  wrappedKey?: string;
}

/** Pull posts addressed to the caller (and their own) newer than `since`, newest
 *  first, with a cursor to pass next time. `revoked` lists post ids the caller was
 *  removed from (e.g. dropped from close friends) so the client prunes local copies. */
export async function listPosts(
  since = 0,
): Promise<{ posts: ServerPost[]; cursor: number; revoked: string[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/posts?since=${since}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`list posts failed: ${res.status}`);
  const body = (await res.json()) as { posts: ServerPost[]; cursor: number; revoked?: string[] };
  return { ...body, revoked: body.revoked ?? [] };
}

/** Delete one of the caller's own posts (author-only server-side). Idempotent. */
export async function deletePost(id: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`delete post failed: ${res.status}`);
}

/** Push one of the caller's own posts' auto-delete back to a full window (author-only). */
export async function keepAlivePost(id: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/posts/${encodeURIComponent(id)}/keepalive`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`extend post failed: ${res.status}`);
}

/** Broaden one of the caller's own posts' audience by adding recipient key-envelopes
 *  (author-only). The added recipients get the post silently (no notification). */
export async function addPostEnvelopes(postId: string, envelopes: PostEnvelopeWire[]): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/posts/${encodeURIComponent(postId)}/envelopes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ envelopes }),
  });
  if (!res.ok) throw new Error(`add post envelopes failed: ${res.status}`);
}

/** Remove one recipient from one of the caller's own posts (author-only). Used when
 *  un-close-friending someone to revoke close-only posts: their key envelope is deleted
 *  and a revocation is recorded so their device prunes the local copy. Idempotent. */
export async function removePostRecipient(postId: string, userId: string): Promise<void> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/posts/${encodeURIComponent(postId)}/recipient/${encodeURIComponent(userId)}`,
    { method: 'DELETE', headers: authHeaders() },
  );
  if (!res.ok && res.status !== 404) throw new Error(`remove post recipient failed: ${res.status}`);
}

/** Submit one opaque engagement item (reaction/comment) on a post; the server fans it
 *  out to the post's audience. Only audience members (or the author) may engage. */
export async function submitEngagement(
  postId: string,
  req: { id: string; kind: string; payload?: string; target?: string },
): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/posts/${encodeURIComponent(postId)}/engagement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`submit engagement failed: ${res.status}`);
}

/** Record that the caller viewed a post (delivered to the author only). Sent only when
 *  the caller's seen-receipts setting is on. Idempotent. */
export async function recordPostView(postId: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/posts/${encodeURIComponent(postId)}/view`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`record view failed: ${res.status}`);
}

/** Author-only: who viewed a post. */
export async function listPostViews(postId: string): Promise<{ views: { viewer: string; viewedAt: number }[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/posts/${encodeURIComponent(postId)}/views`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`list views failed: ${res.status}`);
  return (await res.json()) as { views: { viewer: string; viewedAt: number }[] };
}

/** One opaque engagement item; `payload` is sealed under K_post (decrypted client-side). */
export interface ServerEngagement {
  id: string;
  actor: string;
  kind: string;
  payload: string;
  createdAt: number;
}

/** Fetch the engagement on a post the caller can see. */
export async function listEngagement(postId: string): Promise<{ items: ServerEngagement[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/posts/${encodeURIComponent(postId)}/engagement`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`list engagement failed: ${res.status}`);
  return (await res.json()) as { items: ServerEngagement[] };
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

/** Replace this device's push routing prefs whole (spec 1050, FR-011). The blob
 *  is plaintext BY DESIGN — it exists so the blind relay can gate push tickles;
 *  hidden chats are structurally excluded before this is ever called. */
export async function savePushPrefs(prefs: unknown): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/push/prefs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error(`push prefs failed: ${res.status}`);
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
  notes?: import('@/services/release-notes').ReleaseNote[];
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
  return (await res.json()) as {
    publicUrl: string;
    vapidPublicKey: string;
    maxBlobBytes?: number;
    version?: string;
    notes?: import('@/services/release-notes').ReleaseNote[];
  };
}

/** One reconciled delivery: a message we sent reached `recipient` (a group message
 *  reports one entry per member). */
export interface DeliveredEntry {
  messageId: string;
  recipient: string;
  at: number;
}

/**
 * Reconcile our still-'sent' messages on reconnect: ask the server which of the
 * given message ids it has recorded as delivered (so a 'delivered' receipt that was
 * dropped while we were offline is recovered). Returns the delivered entries.
 */
export async function checkDeliveries(ids: string[]): Promise<DeliveredEntry[]> {
  if (!ids.length) return [];
  const res = await fetch(`${apiBaseUrl()}/v1/deliveries/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`deliveries check failed: ${res.status}`);
  return ((await res.json()) as { delivered?: DeliveredEntry[] }).delivered ?? [];
}

/** One reconciled seen receipt: a message we sent was seen by `recipient` (a group
 *  message reports one entry per member who saw it). */
export interface SeenEntry {
  messageId: string;
  recipient: string;
  at: number;
}

/**
 * Reconcile our seen state on reconnect (spec 1010): ask the server which of the
 * given message ids it has recorded as seen (so a 'seen' receipt dropped while we
 * were offline is recovered). Mirrors checkDeliveries. Returns the seen entries.
 */
export async function checkSeen(ids: string[]): Promise<SeenEntry[]> {
  if (!ids.length) return [];
  const res = await fetch(`${apiBaseUrl()}/v1/seen/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`seen check failed: ${res.status}`);
  return ((await res.json()) as { seen?: SeenEntry[] }).seen ?? [];
}

/* ---- connect-request lifecycle (directory-initiated 1:1 connections) ---- */

export interface ConnReq {
  requester: string;
  target: string;
  state: string;
  updatedAt: number;
}

/** Send a connect request to a directory user; returns the resulting state. */
export async function connectRequest(target: string): Promise<string> {
  const res = await fetch(`${apiBaseUrl()}/v1/connections/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw new Error(`connect request failed: ${res.status}`);
  return ((await res.json()) as { state: string }).state;
}

/** Accept an incoming connect request from `requester`. */
export async function connectAccept(requester: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/connections/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ requester }),
  });
  if (!res.ok) throw new Error(`connect accept failed: ${res.status}`);
}

/** Reject an incoming connect request from `requester`; `block` also hides you from
 *  them in the directory + presence. */
export async function connectReject(requester: string, block: boolean): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/connections/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ requester, block }),
  });
  if (!res.ok) throw new Error(`connect reject failed: ${res.status}`);
}

/** Withdraw a pending request you sent to `target`: removes it server-side so it
 *  leaves the target's incoming list (authoritative cancel). */
export async function connectWithdraw(target: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/connections/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw new Error(`connect withdraw failed: ${res.status}`);
}

/** Create an accepted connection to `target` without a request (group co-members:
 *  membership is the consent), so fan-out can fetch their bundle under the gate. */
export async function connectLink(target: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/connections/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw new Error(`connect link failed: ${res.status}`);
}

/** The caller's incoming (awaiting accept) + outgoing (pending/rejected) requests.
 *  With `includeFriends` the server also returns the full accepted-peer id list
 *  (spec 2040) — the authoritative friend graph a recovered device rebuilds its
 *  local connected-peers ledger from. `friends` is undefined on older servers. */
export async function listConnections(
  includeFriends = false,
): Promise<{ incoming: ConnReq[]; outgoing: ConnReq[]; friends?: string[] }> {
  const url = `${apiBaseUrl()}/v1/connections${includeFriends ? '?include=friends' : ''}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`list connections failed: ${res.status}`);
  return (await res.json()) as { incoming: ConnReq[]; outgoing: ConnReq[]; friends?: string[] };
}

/** Register a browser push subscription with the backend. */
export async function subscribePush(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  // Optional per-device metadata for the 9-AM-local version announcement (spec 1016):
  // the running client version and the device's local UTC offset in minutes. The server
  // preserves prior values when these are omitted (e.g. the SW resubscribe path).
  installedVersion?: string;
  tzOffsetMinutes?: number;
}): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(sub),
  });
  if (!res.ok) throw new Error(`push subscribe failed: ${res.status}`);
}

/**
 * (spec 2043) Fetch the caller's queued-frame status: the oldest queued frame's age
 * (epoch ms, null when the queue is empty) and the total count. Side-effect-free on
 * the server (no dequeue, no delivery receipt), so it is safe to poll on foreground.
 * Powers the client zombie self-heal: a subscription the push service silently
 * revoked still 201-accepts upstream but never wakes the device, so the server holds
 * frames older than any push wake this device recorded. Bounded so a hung request
 * can't stall the foreground path.
 */
export async function fetchRelayStatus(): Promise<{ oldestQueuedAtMs: number | null; count: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/v1/relay/status`, { headers: authHeaders(), signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`relay status failed: ${res.status}`);
  return (await res.json()) as { oldestQueuedAtMs: number | null; count: number };
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

/**
 * Fetch the raw bytes of a third-party URL through the server relay (POST
 * /v1/unfurl) for link-preview generation. A PWA can't read a cross-origin page
 * directly (CORS), so the server fetches on our behalf and streams bytes back
 * UNPARSED - we parse them client-side. With `asImage` the relay enforces an
 * image content-type (used for the resolved og:image's second fetch). Returns
 * null on any non-OK status so callers degrade to a domain-only card.
 */
export async function fetchUnfurl(url: string, asImage = false): Promise<Response | null> {
  const qs = `url=${encodeURIComponent(url)}${asImage ? '&as=image' : ''}`;
  const res = await fetch(`${apiBaseUrl()}/v1/unfurl?${qs}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return res.ok ? res : null;
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
