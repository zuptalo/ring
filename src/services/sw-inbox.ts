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
  suppressed: boolean;
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
// page drains it. Track shown message ids (bounded) so we don't re-notify. The cap
// stays comfortably above the per-fetch preview cap so a displayed id can't be
// evicted before the page acks it (which would re-notify it).
const SHOWN_KEY = 'swNotifiedIds';
const SHOWN_CAP = 1000;
async function loadShown(): Promise<string[]> {
  return setting<string[]>(SHOWN_KEY, []);
}
async function saveShown(ids: string[]): Promise<void> {
  await put<Setting<string[]>>('settings', { key: SHOWN_KEY, value: ids.slice(-SHOWN_CAP) });
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
): { note: SwNote | null; wasMessage: boolean } {
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
  // Reactions / poll votes carry nothing to show.
  if (payload.reaction || payload.pollVote) return { note: null, wasMessage: false };

  // A plain message. Honors the "Show notifications" toggle (requests above don't).
  if (!showMessages) return { note: null, wasMessage: true };

  const isGroup = !!payload.groupId;
  const groupChat = isGroup ? chats.find((c) => c.id === payload.groupId) : undefined;
  const senderName = known || 'Someone';
  const preview = showPreview ? notifyPreview(payload) : 'New message';
  const chatId = isGroup
    ? payload.groupId
    : chats.find((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === from)?.id;
  return {
    note: {
      ids: [f.id as string],
      title: isGroup ? groupChat?.name || 'Group' : senderName,
      // Group previews prefix the sender (WhatsApp-style), but only when we know who
      // they are, never the bare "Someone:" garble.
      body: isGroup && showPreview && known ? `${known}: ${preview}` : preview,
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
export async function previewPending(): Promise<PreviewResult> {
  const token = await readSessionToken();
  if (!token) {
    console.warn('[sw-inbox] no session token → generic');
    return { notes: [], pending: 0, suppressed: false };
  }

  // Fetch the queue FIRST, before any decryption or settings gate. Fetching is
  // what tells the server the device received these frames (→ "delivered"
  // receipts), so it must happen even if we later withhold or can't decrypt.
  // Bounded so a cold-start fetch can't hang the handler.
  let frames: MsgFrame[] = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
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
      return { notes: [], pending: 0, suppressed: false };
    }
    frames = ((await res.json()) as { frames?: MsgFrame[] }).frames ?? [];
  } catch (e) {
    console.warn('[sw-inbox] /relay/pending fetch failed', e);
    return { notes: [], pending: 0, suppressed: false };
  }
  if (!frames.length) return { notes: [], pending: 0, suppressed: false };

  // Queued message frames = the undelivered backlog → the app-icon badge. Known
  // from the fetch alone, so the badge is right even if we can't decrypt.
  const pending = frames.filter((f) => f.t === 'msg' && !!f.id).length;
  console.info('[sw-inbox] fetched frames', { total: frames.length, pending });

  const showMessages = await setting<boolean>('notifications.message.show', true);

  // Now decrypt for the rich preview. PIN/passkey-locked (no device key) → generic
  // (the frames were still fetched above, so the sender already got "delivered").
  // Runs AFTER the fetch so a stalled libsodium init can't block delivery.
  if (!(await attemptDeviceUnlock())) {
    console.warn('[sw-inbox] device unlock failed (PIN-locked?) → generic');
    // Can't tell a message from a request → let the caller show a generic, UNLESS
    // the user disabled message notifications (then stay silent rather than buzz).
    return { notes: [], pending, suppressed: !showMessages };
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
  for (const f of frames) {
    if (f.t !== 'msg' || !f.from || !f.id || seen.has(f.id)) continue;
    let payload: MessagePayload;
    try {
      payload = await previewPacket(sessionKeyForPeer(chats, f.from), f.ciphertext);
    } catch (e) {
      console.warn('[sw-inbox] decrypt failed for a frame → skipped', e);
      continue; // can't decrypt this one (session not reachable yet) → leave it for the page
    }
    seen.add(f.id);
    const { note, wasMessage } = noteForPayload(f, payload, chats, contacts, showMessages, showPreview);
    if (note) raw.push(note);
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
  return { notes, pending, suppressed: notes.length === 0 && (withheldMessage || !showMessages) };
}

/** Persist the frame ids we actually displayed, so they aren't re-shown on the next
 *  push (the SW never acks, so frames linger in the relay queue until the page
 *  drains). Merges into the bounded `swNotifiedIds` ledger. */
export async function markShown(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const shown = await loadShown();
  await saveShown([...shown, ...ids]);
}

/** Best-effort unread total from the on-device chats. The SW can't persist the new
 *  message (read-only preview), so the push handler adds the count of fresh
 *  notifications on top for the app-icon badge. */
export async function unreadCount(): Promise<number> {
  const chats = await getAll<Chat>('chats');
  return chats.reduce((n, c) => n + (c.unread || 0), 0);
}
