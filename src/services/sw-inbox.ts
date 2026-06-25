/**
 * Service-worker background decryption for rich notifications (Choice A).
 *
 * Woken by a content-free push tickle while the app is closed, the SW fetches the
 * queued E2EE frames over HTTP, decrypts them READ-ONLY (previewPacket never
 * persists the ratchet or acks), and builds notification previews. The page still
 * drains + persists the messages for real over its WebSocket when it next
 * connects, so this adds notification content WITHOUT touching shared ratchet
 * state. Only a content-free tickle ever flows through Apple/Google.
 *
 * Mirrors the live page dispatch (db/queries.ts `receiveIncoming` → services/notify
 * `notifyIncoming`): plain messages honor `notifications.message.show`, while
 * friend requests / group invites always surface. Notes for the same conversation
 * are aggregated (one updating notification with a count), so a backlog doesn't
 * collapse to "just the last message" or stack N separate banners.
 *
 * Import-clean for the SW: depends only on idb, the crypto/decrypt path, and the
 * IDB-backed session token (no DOM / Ionic / page-only modules).
 */
import { attemptDeviceUnlock } from './crypto/identity';
import { previewPacket } from './messaging';
import { readSessionToken } from './session';
import { get, getAll, put } from '@/db/idb';
import { notifyPreview } from '@/utils/notify-preview';
import type { Chat, Contact, Setting } from '@/db/types';
import type { MessagePayload } from './crypto/message';

// Same-origin by default (the dev proxy / prod reverse-proxy route /v1 → backend).
// VITE_API_URL is baked in only when targeting a different backend host.
const API = `${import.meta.env.VITE_API_URL ?? ''}/v1`;

interface MsgFrame {
  t: string;
  id?: string;
  from?: string;
  ciphertext?: unknown;
}

/** A ready-to-show notification. `ids` are the relay frame ids this note covers
 *  (more than one when several messages from the same conversation are merged);
 *  the caller marks them all shown after displaying so none re-notifies. */
export interface SwNote {
  ids: string[];
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Background-preview result. `notes` are the displayable notifications, `pending`
 *  is the number of queued (undelivered) message frames, known from the fetch
 *  alone (no decryption needed) and used for the app-icon badge. `suppressed` is
 *  set when there was something to alert but the user's "Show notifications" toggle
 *  withheld it, so the caller skips the generic placeholder rather than showing
 *  "New message" the user asked not to see. */
export interface PreviewResult {
  notes: SwNote[];
  pending: number;
  // suppressed: there was something to alert on but the user's global "Show
  // notifications" toggle withheld it → caller skips the generic placeholder AND
  // doesn't badge (nothing to count for the user).
  suppressed: boolean;
  // silenced: every notifiable message was INTENTIONALLY silenced by per-chat prefs
  // (mute / web-push-off / content=none) and nothing else needs surfacing → caller
  // shows NO notification (not even the generic placeholder), but STILL badges the
  // pending count (spec 1015 FR-022/FR-024: "badge only"). Distinct from `suppressed`
  // so the badge keeps updating, and from a cold-start undecryptable frame (which
  // still gets a generic placeholder to honor the Web Push userVisibleOnly contract).
  silenced: boolean;
  // (spec 2014 US2) When we end up with NO decrypted notes and fall back to the generic placeholder,
  // why? — 'relay-<status>' / 'relay-error' (couldn't fetch the queue), 'locked' (device unlock
  // failed), 'decrypt-failed' (frames fetched but none decryptable). Surfaced ONLY on the dev
  // deployment to diagnose the "generic after a while" regression on-device; never shown in prod.
  reason?: string;
}

async function setting<T>(key: string, fallback: T): Promise<T> {
  const s = await get<Setting<T>>('settings', key);
  return s ? s.value : fallback;
}

/** The 1:1 chat id used as the ratchet-session key for `from` (or a synthetic key
 *  when no chat exists yet, a prekey preamble then establishes the session in
 *  memory for the preview). Mirrors startDirectChat by preferring a non-pending
 *  (visible) chat when a peer somehow has more than one 1:1 chat. */
function sessionKeyForPeer(chats: Chat[], from: string): string {
  const mine = chats.filter((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === from);
  return (mine.find((c) => !c.pending) ?? mine[0])?.id ?? from;
}

// The SW doesn't ack, so an unprocessed frame reappears on the next push until the
// page drains it. Track shown message ids so we don't re-notify, expiring entries by
// AGE rather than a fixed count: a high-volume conversation could otherwise evict a
// recently-shown id (the old 1000-count cap) before the page acks it, re-notifying
// it. 48h comfortably outlives the gap between a push and the next app open. A large
// safety cap still bounds storage in a pathological burst.
const SHOWN_KEY = 'swNotifiedIds';
const SHOWN_TTL_MS = 48 * 60 * 60 * 1000;
const SHOWN_MAX = 2000;

// Upper bound on the /relay/pending fetch when the SW wakes for a push, so a slow or
// unresponsive server can't hang the handler (the caller falls back to a generic
// placeholder, then upgrades if the fetch lands within the outer settle window).
const PENDING_FETCH_TIMEOUT_MS = 8000;
type ShownEntry = { id: string; ts: number };

async function loadShownEntries(): Promise<ShownEntry[]> {
  const raw = await setting<Array<ShownEntry | string>>(SHOWN_KEY, []);
  const cutoff = Date.now() - SHOWN_TTL_MS;
  const out: ShownEntry[] = [];
  for (const e of raw) {
    // Tolerate the legacy string[] shape from before time-based expiry: keep them,
    // stamped now, so an upgrade doesn't immediately re-notify recent messages.
    if (typeof e === 'string') out.push({ id: e, ts: Date.now() });
    else if (e && e.ts >= cutoff) out.push(e);
  }
  return out;
}
async function loadShown(): Promise<string[]> {
  return (await loadShownEntries()).map((e) => e.id);
}

/** Build the raw (un-aggregated) note for one decrypted frame, or null when the
 *  frame carries nothing to alert on (reactions, votes, silent membership/profile
 *  side effects). Mirrors db/queries.ts `receiveIncoming` + the notifyIncoming
 *  calls it makes: requests/invites always notify; plain messages honor showMessages. */
function noteForPayload(
  f: MsgFrame,
  payload: MessagePayload,
  chats: Chat[],
  contacts: Contact[],
  showMessages: boolean,
  showPreview: boolean,
): { note: SwNote | null; wasMessage: boolean; silenced?: boolean } {
  const from = f.from as string;
  const known = contacts.find((c) => c.id === from)?.name;

  // Friend request (ContactCard 'request') always surfaces, like the live path.
  if (payload.card) {
    if (payload.card.t !== 'request') return { note: null, wasMessage: false };
    const name = known || payload.card.name || 'Someone';
    return {
      note: { ids: [f.id as string], title: name, body: 'wants to connect', url: '/tabs/contacts', tag: `ring:req:${from}` },
      wasMessage: false,
    };
  }
  // Group invite (GroupCard 'invite') always surfaces. Other membership cards
  // (create/update/leave/accept/decline) are silent side effects.
  if (payload.group) {
    if (payload.group.t !== 'invite') return { note: null, wasMessage: false };
    const inviter = known || 'Someone';
    const groupName = payload.group.name || 'a group';
    return {
      note: {
        ids: [f.id as string],
        title: inviter,
        body: `invited you to "${groupName}"`,
        url: '/tabs/contacts',
        tag: `ring:ginv:${payload.group.groupId}`,
      },
      wasMessage: false,
    };
  }
  // Reactions / poll votes / edits / delete-for-everyone / link-preview attach, and
  // the session re-key + disappearing-message TTL controls, are silent side effects
  // with nothing to show.
  if (
    payload.reaction || payload.pollVote || payload.edit || payload.erase ||
    payload.linkPreviewSig || payload.rekey || payload.ttl !== undefined
  ) {
    return { note: null, wasMessage: false };
  }

  // A plain message. Honors the "Show notifications" toggle (requests above don't).
  if (!showMessages) return { note: null, wasMessage: true };

  const isGroup = !!payload.groupId;
  const groupChat = isGroup ? chats.find((c) => c.id === payload.groupId) : undefined;
  const senderName = known || 'Someone';
  const chat = isGroup
    ? groupChat
    : chats.find((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === from);
  // Per-chat mute: don't show an OS notification for a muted chat (the frame was
  // still fetched above, so the sender's delivery receipt is unaffected). `silenced`
  // marks this as an INTENTIONAL per-chat silence, so the caller shows no generic
  // placeholder (vs. a cold-start undecryptable frame, which still needs one) — the
  // badge still counts it.
  if (chat?.mutedUntil && chat.mutedUntil > Date.now()) return { note: null, wasMessage: true, silenced: true };
  // Per-chat web push off (spec 1015 FR-022): suppress the system notification for
  // the closed app — the server still sent the content-free tickle (it can't know
  // per-chat prefs), so the SW enforces it here; the badge still counts the frame.
  if (chat?.notifyWebPush === false) return { note: null, wasMessage: true, silenced: true };
  // Content visibility (FR-022/FR-024). 'none' = badge-only → no notification at all.
  const content = chat?.notifyContent ?? 'full';
  if (content === 'none') return { note: null, wasMessage: true, silenced: true };
  // Show the decrypted text only when the chat allows full content AND the global
  // "Show preview" is on (most-private-wins); otherwise a content-free placeholder.
  const showText = content === 'full' && showPreview;
  const preview = showText ? notifyPreview(payload) : 'New message';
  const chatId = chat?.id;
  return {
    note: {
      ids: [f.id as string],
      title: isGroup ? groupChat?.name || 'Group' : senderName,
      // Group previews prefix the sender (WhatsApp-style), but only when we know who
      // they are and full content is allowed, never the bare "Someone:" garble.
      body: isGroup && showText && known ? `${known}: ${preview}` : preview,
      url: chatId ? `/chat/${chatId}` : '/tabs/chats',
      tag: chatId ? `ring:${chatId}` : `ring:from:${from}`,
    },
    wasMessage: true,
  };
}

/** Merge notes that share a tag (same conversation / same requester) into one
 *  updating notification: the latest body, a count when more than one, and every
 *  underlying frame id so they all get marked shown. */
function aggregate(raw: SwNote[]): SwNote[] {
  const order: string[] = [];
  const byTag = new Map<string, SwNote>();
  for (const n of raw) {
    const cur = byTag.get(n.tag);
    if (!cur) {
      byTag.set(n.tag, { ...n, ids: [...n.ids] });
      order.push(n.tag);
    } else {
      cur.ids.push(...n.ids);
      cur.body = n.body; // latest wins
      cur.title = n.title;
    }
  }
  return order.map((tag) => {
    const n = byTag.get(tag) as SwNote;
    const k = n.ids.length;
    return k > 1 ? { ...n, title: `${n.title} (${k})` } : n;
  });
}

/**
 * Decrypt queued frames read-only and return notification previews not yet shown.
 * Always fetches the queue first (so the server records "delivered" and we learn
 * the true backlog) even when notifications are off or the account is PIN-locked
 * (the SW can't decrypt → caller falls back to a generic notification). Never
 * persists or acks.
 */
/** Tell the server this device received a call ring push (proves it's reachable), so
 *  the caller's UI flips "Calling" -> "Ringing". Best-effort, no body. */
export async function ackCall(): Promise<void> {
  const token = await readSessionToken();
  if (!token) return;
  try {
    await fetch(`${API}/call/ack`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    /* best-effort: a missed ack just leaves the caller on "Calling" */
  }
}

export async function previewPending(): Promise<PreviewResult> {
  const token = await readSessionToken();
  if (!token) {
    console.warn('[sw-inbox] no session token → generic');
    return { notes: [], pending: 0, suppressed: false, silenced: false };
  }

  // Kick the device unlock NOW, IN PARALLEL with the fetch below (spec 2010
  // root-cause c). attemptDeviceUnlock awaits libsodium's WASM init (`ready()`) then
  // unwraps the device bundle — on a cold wake (evicted SW) that init + unwrap is
  // pure CPU with no network, so overlapping it with the network round-trip hides its
  // latency inside the fetch instead of paying it serially AFTER, which used to push
  // the first decrypt past the GENERIC_AFTER_MS budget → a stranded generic. We still
  // AWAIT it before any decrypt below, so correctness is unchanged (never decrypt
  // before the key is ready).
  const unlockReady = attemptDeviceUnlock().catch(() => false);

  // Fetch the queue, before any decryption or settings gate. Fetching is what tells
  // the server the device received these frames (→ "delivered" receipts), so it must
  // happen even if we later withhold or can't decrypt. Bounded so a cold-start fetch
  // can't hang the handler.
  let frames: MsgFrame[] = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/relay/pending`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.warn('[sw-inbox] /relay/pending not ok', res.status);
      return { notes: [], pending: 0, suppressed: false, silenced: false, reason: `relay-${res.status}` };
    }
    frames = ((await res.json()) as { frames?: MsgFrame[] }).frames ?? [];
  } catch (e) {
    console.warn('[sw-inbox] /relay/pending fetch failed', e);
    return { notes: [], pending: 0, suppressed: false, silenced: false, reason: 'relay-error' };
  }
  if (!frames.length) return { notes: [], pending: 0, suppressed: false, silenced: false, reason: 'no-frames' };

  // Queued message frames = the undelivered backlog → the app-icon badge. Known
  // from the fetch alone, so the badge is right even if we can't decrypt.
  const pending = frames.filter((f) => f.t === 'msg' && !!f.id).length;
  console.info('[sw-inbox] fetched frames', { total: frames.length, pending });

  const showMessages = await setting<boolean>('notifications.message.show', true);

  // Now decrypt for the rich preview. PIN/passkey-locked (no device key) → generic
  // (the frames were still fetched above, so the sender already got "delivered").
  // Awaits the unlock kicked off in parallel above (its init overlapped the fetch),
  // so a stalled libsodium init never blocks delivery and a cold start doesn't pay
  // unlock latency serially after the fetch.
  if (!(await unlockReady)) {
    console.warn('[sw-inbox] device unlock failed (PIN-locked?) → generic');
    // Can't tell a message from a request → let the caller show a generic, UNLESS
    // the user disabled message notifications (then stay silent rather than buzz).
    return { notes: [], pending, suppressed: !showMessages, silenced: false, reason: 'locked' };
  }

  const showPreview = await setting<boolean>('notifications.showPreview', true);
  const [chats, contacts, shown] = await Promise.all([
    getAll<Chat>('chats'),
    getAll<Contact>('contacts'),
    loadShown(),
  ]);
  const seen = new Set(shown);

  const raw: SwNote[] = [];
  let withheldMessage = false;
  let silencedMessage = false; // a message intentionally silenced by per-chat prefs
  let decryptFailed = 0; // frames we couldn't decrypt (cold start / session not reachable)
  for (const f of frames) {
    if (f.t !== 'msg' || !f.from || !f.id || seen.has(f.id)) continue;
    let payload: MessagePayload;
    try {
      payload = await previewPacket(sessionKeyForPeer(chats, f.from), f.ciphertext);
    } catch (e) {
      console.warn('[sw-inbox] decrypt failed for a frame → skipped', e);
      decryptFailed += 1;
      continue; // can't decrypt this one (session not reachable yet) → leave it for the page
    }
    seen.add(f.id);
    const { note, wasMessage, silenced } = noteForPayload(f, payload, chats, contacts, showMessages, showPreview);
    if (note) raw.push(note);
    else if (silenced) silencedMessage = true;
    else if (wasMessage && !showMessages) withheldMessage = true;
  }

  const notes = aggregate(raw);
  console.info('[sw-inbox] built notes', notes.length, 'of pending', pending);
  // Deliberately DON'T persist `seen` here; the caller marks notes shown only after
  // actually displaying them (markShown), so a discarded/timed-out preview can't
  // suppress a later rich notification for the same message.
  //
  // suppressed = we'd have alerted but "Show notifications" is off and nothing else
  // (a request/invite) needs surfacing → caller skips the generic placeholder.
  const suppressed = notes.length === 0 && (withheldMessage || !showMessages);
  // silenced = nothing to show AND everything we could decrypt was intentionally
  // per-chat silenced (mute / web-push-off / badge-only), with no undecryptable
  // frames left that might warrant a placeholder. Caller shows NO notification but
  // STILL badges the pending count (spec 1015 FR-022/FR-024). If a frame couldn't be
  // decrypted (decryptFailed > 0) we can't know its chat, so we fall back to the
  // generic placeholder (userVisibleOnly) rather than silently dropping it.
  const silenced = notes.length === 0 && !suppressed && silencedMessage && decryptFailed === 0;
  // (spec 2014 US2) If we'll fall back to the generic (no notes, not suppressed/silenced) because
  // frames were fetched but none decrypted, tag it so the dev deployment can show why.
  const reason = notes.length === 0 && !suppressed && !silenced && decryptFailed > 0 ? 'decrypt-failed' : undefined;
  return { notes, pending, suppressed, silenced, reason };
}

/** Persist the frame ids we actually displayed, so they aren't re-shown on the next
 *  push (the SW never acks, so frames linger in the relay queue until the page
 *  drains). Merges into the bounded `swNotifiedIds` ledger. */
export async function markShown(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = Date.now();
  const entries = await loadShownEntries(); // already pruned of expired
  const known = new Set(entries.map((e) => e.id));
  for (const id of ids) if (!known.has(id)) entries.push({ id, ts: now });
  await put<Setting<ShownEntry[]>>('settings', { key: SHOWN_KEY, value: entries.slice(-SHOWN_MAX) });
}

/** Best-effort unread total from the on-device chats. The SW can't persist the new
 *  message (read-only preview), so the push handler adds the count of fresh
 *  notifications on top for the app-icon badge. */
export async function unreadCount(): Promise<number> {
  const chats = await getAll<Chat>('chats');
  return chats.reduce((n, c) => n + (c.unread || 0), 0);
}

/* ---- friend-request (connection) lifecycle notifications (spec 1015 US2) ---- */

// The conn tickle is content-free, so on wake the SW reconciles the authoritative
// state from GET /v1/connections (just user ids + state — no decryption needed, so
// this works even while PIN-locked) and shows a GENERIC, identity-safe notice
// (FR-012a: never a name/raw id for a not-yet-a-contact requester). A ledger keyed
// by (kind,peer) makes repeated/duplicate conn tickles idempotent (no re-notify for
// an unchanged event), and expires by age so an old entry can't suppress forever.
const CONN_SHOWN_KEY = 'swConnShownKeys';
const CONN_SHOWN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CONN_SHOWN_MAX = 500;

/** A ready-to-show friend-request notification. `keys` are the dedup-ledger keys it
 *  covers; the caller marks them shown after displaying so they don't re-notify. */
export interface ConnNote {
  keys: string[];
  title: string;
  body: string;
  url: string;
  tag: string;
}

async function loadConnShownEntries(): Promise<ShownEntry[]> {
  const raw = await setting<ShownEntry[]>(CONN_SHOWN_KEY, []);
  const cutoff = Date.now() - CONN_SHOWN_TTL_MS;
  return raw.filter((e) => e && typeof e.ts === 'number' && e.ts >= cutoff);
}

interface ConnReq {
  requester?: string;
  target?: string;
  state?: string;
}

/**
 * Build generic friend-request notifications for the conn tickle. Reconciles the
 * server's connection state against a dedup ledger so only NEW events surface:
 *   - an incoming pending request  → "New friend request"
 *   - our outgoing request accepted → "Your friend request was accepted"
 *   - our outgoing request rejected → "Your friend request was declined"
 * All bodies are identity-safe (no names / ids), so nothing about who is exposed,
 * and no decryption is needed. Returns [] on any auth/network failure.
 */
export async function previewConnections(): Promise<ConnNote[]> {
  const token = await readSessionToken();
  if (!token) return [];
  let data: { incoming?: ConnReq[]; outgoing?: ConnReq[] };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/connections`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return [];
    data = (await res.json()) as { incoming?: ConnReq[]; outgoing?: ConnReq[] };
  } catch {
    return [];
  }
  const seen = new Set((await loadConnShownEntries()).map((e) => e.id));
  const notes: ConnNote[] = [];
  const add = (key: string, body: string, tag: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    notes.push({ keys: [key], title: 'Ring', body, url: '/tabs/contacts', tag });
  };
  for (const r of data.incoming ?? []) {
    if (r.state === 'pending' && r.requester) add(`req:${r.requester}`, 'New friend request', 'ring:conn:req');
  }
  for (const r of data.outgoing ?? []) {
    if (!r.target) continue;
    if (r.state === 'accepted') add(`acc:${r.target}`, 'Your friend request was accepted', `ring:conn:acc:${r.target}`);
    else if (r.state === 'rejected') add(`rej:${r.target}`, 'Your friend request was declined', `ring:conn:rej:${r.target}`);
  }
  return notes;
}

/** Persist the conn-ledger keys we displayed, so the same event doesn't re-notify
 *  on the next conn tickle (idempotency / no duplicate outcome notifications). */
export async function markConnShown(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const now = Date.now();
  const entries = await loadConnShownEntries();
  const known = new Set(entries.map((e) => e.id));
  for (const k of keys) if (!known.has(k)) entries.push({ id: k, ts: now });
  await put<Setting<ShownEntry[]>>('settings', { key: CONN_SHOWN_KEY, value: entries.slice(-CONN_SHOWN_MAX) });
}
