/**
 * Service-worker background decryption for rich notifications.
 *
 * Two modes since spec 1032 (specs/1032-store-messages-push/):
 *   - AUTHORITATIVE (sw-drain.ts, behind the internal `sw.fullPersist` flag):
 *     eligible plain messages are decrypted, PERSISTED atomically, and acked at
 *     notification time, so the app opens warm. sw-drain reuses this module's
 *     fetch + note-building helpers, so notification content and privacy rules
 *     are identical in both modes.
 *   - PREVIEW (this module, the original "Choice A"): woken by a content-free
 *     push tickle, the SW fetches the queued E2EE frames over HTTP, decrypts
 *     them READ-ONLY (previewPacket never persists the ratchet or acks), and
 *     builds notification previews. The page still drains + persists for real
 *     over its WebSocket on next open. This remains the whole story for: the
 *     flag off, PIN/passkey-locked devices, frame types the drain defers
 *     (first-contact, cards, reactions, controls), and every degrade path.
 * Only a content-free tickle ever flows through Apple/Google in either mode.
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
import { ready as sodiumReady } from './crypto/primitives';
import { openPostEngagement } from './posts';
import { previewPacket } from './messaging';
import { readHiddenSet, readHiddenSetOrNull } from './hidden-chats';
import { readSessionToken, readSessionUserId } from './session';
import { get, getAll, put } from '@/db/idb';
import { notifyPreview } from '@/utils/notify-preview';
import type { Chat, Contact, Setting } from '@/db/types';
import type { MessagePayload } from './crypto/message';

// Same-origin by default (the dev proxy / prod reverse-proxy route /v1 → backend).
// VITE_API_URL is baked in only when targeting a different backend host.
const API = `${import.meta.env.VITE_API_URL ?? ''}/v1`;

// Exported (spec 1032): sw-drain.ts drains the same queue authoritatively.
export interface MsgFrame {
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
  // (spec 2017) The count to render in the title (e.g. "Alice (3)"). Carried separately from `title`
  // so the show path can make it CUMULATIVE across overlapping burst wakes (via the persisted
  // per-chat summary) instead of a per-pass slice. Defaults to ids.length when unset.
  count?: number;
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
  // The pending count the app-icon BADGE may use (spec 1027, B4): equal to
  // `pending` under badge mode 'always'; under 'never'/'revealed' only frames
  // that decrypted AND resolved to a provably NON-hidden chat. A frame we can't
  // classify (undecryptable, already-shown, unknown chat) is never counted —
  // privacy beats accuracy on the badge when the user opted hidden chats out.
  badgePending: number;
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
  // (spec 2016) Is there a GENUINELY-NEW message we couldn't render — a fetched-but-undecryptable
  // frame, a locked device with pending frames, or a fetch we couldn't even make — so the caller
  // SHOULD show the generic placeholder? FALSE when there was nothing genuinely new (the relay queue
  // was empty, or every fetched frame was already shown): the caller must NOT show a new placeholder
  // for those (pure noise — the burst extra-generic / `no-frames` toggle noise). Distinct from
  // `reason`, which only labels WHY a fallback happened for the dev diagnostic.
  newUnshown: boolean;
}

/** Read a settings-store value from the service worker (no keystore needed; settings
 *  are stored in the clear). Exported so the SW push handler can honor notification
 *  toggles like `notifications.wall.show`. */
export async function setting<T>(key: string, fallback: T): Promise<T> {
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
/** Frame ids already SHOWN as notifications (TTL-pruned). Exported for sw-drain's
 *  re-ack path (spec 1032): a committed-but-never-shown frame gets its note rebuilt
 *  on redelivery, and this ledger is what distinguishes "never shown" from shown. */
export async function loadShown(): Promise<string[]> {
  return (await loadShownEntries()).map((e) => e.id);
}

/** Build the raw (un-aggregated) note for one decrypted frame, or null when the
 *  frame carries nothing to alert on (reactions, votes, silent membership/profile
 *  side effects). Mirrors db/queries.ts `receiveIncoming` + the notifyIncoming
 *  calls it makes: requests/invites always notify; plain messages honor showMessages. */
// Exported for unit tests (spec 1019 hidden-chat generic rendering, spec 1015
// content prefs). Otherwise internal to `previewPending`.
export function noteForPayload(
  f: MsgFrame,
  payload: MessagePayload,
  chats: Chat[],
  contacts: Contact[],
  showMessages: boolean,
  showPreview: boolean,
  hidden: Set<string> = new Set(),
  selfId = '',
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
  // A game move/resign (spec 0008 US3) is the ONE side-effect signal that
  // notifies — a move demands the opponent's attention — but it sits behind
  // exactly the gates an ordinary message gets (SC-007: hidden chats, mute,
  // per-chat web-push, content prefs, global preview all behave identically).
  // wasMessage stays false: the signal stores no row and never counts unread.
  // (Copy nuance: a game-ENDING move also reads "Your move" here — the SW
  // hasn't applied the move, so it can't know; the page path, which has, uses
  // the precise outcome line.)
  if (payload.gameMove) {
    if (!showMessages) return { note: null, wasMessage: false };
    const gchat = chats.find(
      (c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === from,
    );
    if (gchat && hidden.has(gchat.id)) {
      return {
        note: { ids: [f.id as string], title: 'Ring', body: 'New message', url: '/tabs/chats', tag: `ring:${gchat.id}` },
        wasMessage: false,
      };
    }
    if (gchat?.mutedUntil && gchat.mutedUntil > Date.now()) return { note: null, wasMessage: false, silenced: true };
    if (gchat?.notifyWebPush === false) return { note: null, wasMessage: false, silenced: true };
    const gcontent = gchat?.notifyContent ?? 'full';
    if (gcontent === 'none') return { note: null, wasMessage: false, silenced: true };
    const gshowText = gcontent === 'full' && showPreview;
    return {
      note: {
        ids: [f.id as string],
        title: showPreview ? known || 'Someone' : 'Ring',
        body: gshowText ? notifyPreview(payload) : 'New message',
        url: gchat ? `/chat/${gchat.id}` : '/tabs/chats',
        tag: gchat ? `ring:${gchat.id}` : `ring:from:${from}`,
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
  // Hidden chat (spec 1019, FR-007/FR-008): a content-free notification with no
  // sender, avatar, or body, and a tap that lands on the Chats tab (never the
  // hidden chat). The per-chat tag stays internal (not user-visible) so bursts
  // still coalesce. This wins over per-chat content prefs — hidden overrides them.
  if (chat && hidden.has(chat.id)) {
    return {
      note: { ids: [f.id as string], title: 'Ring', body: 'New message', url: '/tabs/chats', tag: `ring:${chat.id}` },
      wasMessage: true,
    };
  }
  // @mentions (spec 1020): a message that @mentions me (individually, or an @everyone
  // from the actual group OWNER) escalates past the per-chat silencers below (mute,
  // web-push-off, content=none), and names the mentioner — UNLESS the chat turned the
  // "mentions even when muted" pref off. (Hidden chats above still win — a hidden chat
  // never escalates.) The global "Show notifications" master is honored above.
  const selfMentioned =
    isGroup &&
    (!!payload.mentions?.includes(selfId) ||
      (!!payload.mentionsEveryone && !!chat?.createdBy && from === chat.createdBy));
  if (selfMentioned && chat?.notifyMentions !== false) {
    const showText = (chat?.notifyContent ?? 'full') === 'full' && showPreview;
    return {
      note: {
        ids: [f.id as string],
        title: groupChat?.name || 'Group',
        body: showText ? `${senderName} mentioned you: ${notifyPreview(payload)}` : `${senderName} mentioned you`,
        url: chat?.id ? `/chat/${chat.id}` : '/tabs/chats',
        tag: chat?.id ? `ring:${chat.id}` : `ring:from:${from}`,
      },
      wasMessage: true,
    };
  }
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
  // "Show preview" off hides WHO it's from too, not just the body: use a generic title instead of
  // the sender / group name. (Hidden chats and @mentions are handled above and keep their own rules.)
  const title = showPreview ? (isGroup ? groupChat?.name || 'Group' : senderName) : 'Ring';
  return {
    note: {
      ids: [f.id as string],
      title,
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
export function aggregate(raw: SwNote[]): SwNote[] {
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
  // (spec 2017) Carry the count as a field rather than baking "(k)" into the title here. The show
  // path makes it CUMULATIVE across overlapping burst wakes (via the persisted summary) and formats
  // the title once, so the count reflects the true per-chat backlog, not this pass's unseen slice.
  return order.map((tag) => {
    const n = byTag.get(tag) as SwNote;
    return { ...n, count: n.ids.length };
  });
}

/* ---- spec 2017: per-chat "last shown" summary, for coalescing a burst into ONE notification ---- */

/** A small record of the last coalesced notification shown for a tag, so any SW wake can re-assert
 *  the ONE authoritative notification (latest body + CUMULATIVE count) instead of a stale per-pass
 *  slice or nothing. Bounded + short TTL (a burst window) so a chat read a while ago isn't
 *  resurrected with a stale count. */
export interface ShownSummary {
  tag: string;
  title: string; // base title (sender / group name), WITHOUT the "(n)" suffix
  body: string; // latest message body shown
  url: string;
  ids: string[]; // cumulative frame ids folded into this notification (count = ids.length)
  ts: number; // last update (epoch ms) — TTL'd so a stale summary doesn't re-assert forever
}
export const SUMMARY_KEY = 'swShownSummary'; // exported so the page can clear it on read (spec 2017)
const SUMMARY_TTL_MS = 2 * 60 * 1000; // a burst window; older entries don't re-assert (FR-006)
const SUMMARY_MAX = 100;

export async function loadShownSummary(): Promise<ShownSummary[]> {
  const raw = await setting<ShownSummary[]>(SUMMARY_KEY, []);
  const cutoff = Date.now() - SUMMARY_TTL_MS;
  return raw.filter((e) => e && typeof e.ts === 'number' && e.ts >= cutoff && Array.isArray(e.ids));
}
async function saveShownSummary(list: ShownSummary[]): Promise<void> {
  await put<Setting<ShownSummary[]>>('settings', { key: SUMMARY_KEY, value: list.slice(-SUMMARY_MAX) });
}

/** (spec 2017) Fold a freshly-built note into the prior per-tag summary: UNION the frame ids (so the
 *  count is the cumulative per-chat backlog, not this pass's slice), take the latest body/title/url,
 *  stamp `now`. Pure → unit-tested. `prev` is the existing summary entry for this tag, if any. */
export function mergeIntoSummary(prev: ShownSummary | undefined, note: SwNote, now: number): ShownSummary {
  const ids = prev ? Array.from(new Set([...prev.ids, ...note.ids])) : [...note.ids];
  return { tag: note.tag, title: note.title, body: note.body, url: note.url, ids, ts: now };
}

/* ---- spec 2020: last-SHOWN signature per conversation, so a nothing-new wake never
 * repeats a visually identical banner. iOS renders every showNotification call as a
 * visible banner AND a separate Notification Center entry (same-tag replacement does
 * not collapse history), so the spec-2016/2017 silent re-assert reads as a duplicate
 * whenever the coalesced content hasn't changed. The signature records what the user
 * last SAW per tag (body + cumulative count); an identical re-assert is skipped —
 * the same iOS-tolerated outcome class as the mute/badge-only paths. ---- */
export interface ShownSig {
  body: string;
  count: number;
  ts: number;
}
const SHOWN_SIG_KEY = 'sw.shownSig';
const SHOWN_SIG_TTL_MS = 10 * 60 * 1000;
const SHOWN_SIG_MAX = 50;

/** Pure decision (unit-tested): does this summary entry contain anything the user
 *  hasn't already seen on this tag? */
export function shouldReassert(prev: ShownSig | undefined, entry: ShownSummary): boolean {
  return !prev || prev.body !== entry.body || prev.count !== entry.ids.length;
}

export async function loadShownSigs(): Promise<Record<string, ShownSig>> {
  const raw = await setting<Record<string, ShownSig>>(SHOWN_SIG_KEY, {});
  const cutoff = Date.now() - SHOWN_SIG_TTL_MS;
  const out: Record<string, ShownSig> = {};
  for (const [tag, sig] of Object.entries(raw)) {
    if (sig && typeof sig.ts === 'number' && sig.ts >= cutoff) out[tag] = sig;
  }
  return out;
}

export async function saveShownSig(tag: string, sig: ShownSig): Promise<void> {
  const sigs = await loadShownSigs(); // already TTL-pruned
  sigs[tag] = sig;
  const entries = Object.entries(sigs)
    .sort((a, b) => a[1].ts - b[1].ts)
    .slice(-SHOWN_SIG_MAX);
  await put<Setting<Record<string, ShownSig>>>('settings', { key: SHOWN_SIG_KEY, value: Object.fromEntries(entries) });
}

/** (spec 2017) Merge each note into the persisted summary and return the notes to actually SHOW, with
 *  `count` set to the CUMULATIVE per-chat total (so a burst shows one monotonic count, not a bouncing
 *  per-pass slice). Persists the updated summary. Serialized by the caller. */
export async function coalesceForShow(notes: SwNote[], now: number): Promise<SwNote[]> {
  if (!notes.length) return notes;
  const list = await loadShownSummary();
  const byTag = new Map(list.map((e) => [e.tag, e]));
  const out: SwNote[] = [];
  for (const n of notes) {
    const merged = mergeIntoSummary(byTag.get(n.tag), n, now);
    byTag.set(n.tag, merged);
    out.push({ ...n, count: merged.ids.length });
  }
  await saveShownSummary(Array.from(byTag.values()));
  return out;
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

/** Fetch the queued (undelivered) frames. Fetching is what tells the server the
 *  device received them (→ "delivered" receipts), so callers do it before any
 *  decryption or settings gate. Bounded so a cold-start fetch can't hang the
 *  handler. Shared by the preview path below and the authoritative drain
 *  (sw-drain.ts, spec 1032). `failure` carries the preview-path reason label. */
export async function fetchPendingFrames(token: string): Promise<{ frames: MsgFrame[] } | { failure: string }> {
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
      return { failure: `relay-${res.status}` };
    }
    return { frames: ((await res.json()) as { frames?: MsgFrame[] }).frames ?? [] };
  } catch (e) {
    console.warn('[sw-inbox] /relay/pending fetch failed', e);
    return { failure: 'relay-error' };
  }
}

export async function previewPending(): Promise<PreviewResult> {
  const token = await readSessionToken();
  if (!token) {
    console.warn('[sw-inbox] no session token → generic');
    // Couldn't even authenticate to fetch the queue → uncertain; a real message likely woke us, so
    // honor the placeholder (newUnshown) rather than silently dropping a possible message.
    return { notes: [], pending: 0, badgePending: 0, suppressed: false, silenced: false, newUnshown: true };
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

  const fetched = await fetchPendingFrames(token);
  if ('failure' in fetched) {
    return { notes: [], pending: 0, badgePending: 0, suppressed: false, silenced: false, newUnshown: true, reason: fetched.failure };
  }
  const frames = fetched.frames;
  // No pending frames: the message was already drained (page / a prior straggler) or this push carried
  // no queued message (a settings / own-data sync wake). Nothing genuinely new → no placeholder (2016).
  if (!frames.length) return { notes: [], pending: 0, badgePending: 0, suppressed: false, silenced: false, newUnshown: false, reason: 'no-frames' };

  // Queued message frames = the undelivered backlog → the app-icon badge. Known
  // from the fetch alone, so the badge is right even if we can't decrypt.
  //
  // Spec 1032 (security review F8): frames the authoritative drain already
  // COMMITTED can linger here (their ack failed, or a redelivery raced the ack) —
  // they are already inside the stored unread count, so counting them as pending
  // would double-badge, and re-decrypting them would fail (their message keys are
  // consumed) and masquerade as a decrypt failure. Treat committed frames as
  // neither pending nor previewable; they resolve to a bare re-ack on the next
  // drain or page open.
  const committed = new Set(await setting<string[]>('inboundSeenIds', []));
  const pending = frames.filter((f) => f.t === 'msg' && !!f.id && !committed.has(f.id)).length;
  console.info('[sw-inbox] fetched frames', { total: frames.length, pending });

  // Badge mode (spec 1027, B4): under 'never'/'revealed' only frames we can
  // POSITIVELY attribute to a non-hidden chat may bump the badge.
  const badgeMode = await setting<string>('privacy.hiddenChatsBadge', 'always');
  const badgeAll = badgeMode === 'always';

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
    // Locked but there ARE pending msg frames we couldn't decrypt → a genuinely-new message warrants
    // the placeholder (newUnshown). If only non-msg frames are queued (pending === 0) there's nothing
    // new to announce here.
    // Locked → nothing is classifiable, so a non-'always' badge adds nothing
    // here (unreadCount's badge.lastCount fallback still covers the stored part).
    return { notes: [], pending, badgePending: badgeAll ? pending : 0, suppressed: !showMessages, silenced: false, newUnshown: pending > 0, reason: 'locked' };
  }

  const showPreview = await setting<boolean>('notifications.showPreview', true);
  const [chats, contacts, shown, hidden, selfId] = await Promise.all([
    getAll<Chat>('chats'),
    getAll<Contact>('contacts'),
    loadShown(),
    readHiddenSet(), // spec 1019: hidden chats get a generic, content-free notification
    readSessionUserId(), // spec 1020: needed to detect "am I @mentioned?" in the SW
  ]);
  const seen = new Set(shown);

  const raw: SwNote[] = [];
  let badgeable = 0; // frames provably in a NON-hidden chat (badge modes never/revealed)
  let withheldMessage = false;
  let silencedMessage = false; // a message intentionally silenced by per-chat prefs
  let decryptFailed = 0; // frames we couldn't decrypt (cold start / session not reachable)
  for (const f of frames) {
    if (f.t !== 'msg' || !f.from || !f.id || seen.has(f.id) || committed.has(f.id)) continue;
    let payload: MessagePayload;
    try {
      payload = await previewPacket(sessionKeyForPeer(chats, f.from), f.ciphertext);
    } catch (e) {
      console.warn('[sw-inbox] decrypt failed for a frame → skipped', e);
      decryptFailed += 1;
      continue; // can't decrypt this one (session not reachable yet) → leave it for the page
    }
    seen.add(f.id);
    // Classify for the badge (spec 1027): the frame counts only when its chat
    // resolves AND is provably not hidden. Same resolution noteForPayload uses.
    if (!badgeAll) {
      const bChat = payload.groupId
        ? chats.find((c) => c.id === payload.groupId)
        : chats.find((c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === f.from);
      if (bChat && !hidden.has(bChat.id)) badgeable += 1;
    }
    const { note, wasMessage, silenced } = noteForPayload(f, payload, chats, contacts, showMessages, showPreview, hidden, selfId ?? '');
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
  // (spec 2016) A genuinely-new message we couldn't render = an UNSEEN frame that failed to decrypt.
  // When every fetched frame was already shown (all-seen), decryptFailed === 0 and notes is empty →
  // newUnshown is false → the caller shows NO new placeholder (kills the burst extra-generic).
  const newUnshown = decryptFailed > 0;
  return { notes, pending, badgePending: badgeAll ? pending : badgeable, suppressed, silenced, newUnshown, reason };
}

/**
 * (spec 2016) Should this preview result NOT produce a new generic placeholder because there's nothing
 * genuinely new to announce? True when we have no notes to show, the user didn't disable/silence
 * notifications, AND there's no genuinely-new unrendered message — i.e. the relay queue was empty
 * (`no-frames`) or every fetched frame was already shown. The caller honors the per-push contract for
 * these by re-asserting an existing notification silently (or showing nothing), never a new "New
 * message" banner. A slow cold-start that times out before the preview settles is handled separately
 * by the caller (it shows the placeholder immediately, then upgrades/closes it on settle).
 */
export function isNothingNew(r: PreviewResult): boolean {
  return r.notes.length === 0 && !r.suppressed && !r.silenced && !r.newUnshown;
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
 *  notifications on top for the app-icon badge.
 *
 *  Honors `privacy.hiddenChatsBadge` (spec 1027, B4): 'never' excludes hidden
 *  chats; 'revealed' behaves as 'never' here because the reveal session is
 *  page-memory-only and the SW must never assume it. When the hidden set can't
 *  be decrypted (locked), fall back to `badge.lastCount` — the page's last
 *  successfully computed, already preference-filtered total — rather than
 *  guessing in either direction. */
export async function unreadCount(): Promise<number> {
  const chats = await getAll<Chat>('chats');
  const mode = await setting<string>('privacy.hiddenChatsBadge', 'always');
  if (mode === 'always') return chats.reduce((n, c) => n + (c.unread || 0), 0);
  const hidden = await readHiddenSetOrNull();
  if (!hidden) return (await setting<number | null>('badge.lastCount', null)) ?? 0;
  return chats.reduce((n, c) => n + (hidden.has(c.id) ? 0 : c.unread || 0), 0);
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
/** A requester's/target's name for a friend-request notification: their public
 *  directory profile (display name, else @username). Fetched LOCALLY by the SW — the
 *  identity never rides in the content-free push. 'Someone' if it can't be resolved. */
async function connName(userId: string, token: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const u = (await res.json()) as { displayName?: string; username?: string };
      return u.displayName?.trim() || (u.username ? `@${u.username}` : 'Someone');
    }
  } catch {
    /* fall through to a generic, identity-safe label */
  }
  return 'Someone';
}

export async function previewConnections(): Promise<{ notes: ConnNote[]; pendingIncoming: number }> {
  const token = await readSessionToken();
  if (!token) return { notes: [], pendingIncoming: 0 };
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
    if (!res.ok) return { notes: [], pendingIncoming: 0 };
    data = (await res.json()) as { incoming?: ConnReq[]; outgoing?: ConnReq[] };
  } catch {
    return { notes: [], pendingIncoming: 0 };
  }
  const seen = new Set((await loadConnShownEntries()).map((e) => e.id));
  const notes: ConnNote[] = [];
  // Title = WHO, body = the action — so iOS renders "<name>: wants to be friends". The app
  // name ("Ring") is already the notification's source line, so the old "Ring / New friend
  // request" was doubly redundant.
  const add = (key: string, title: string, body: string, tag: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    notes.push({ keys: [key], title, body, url: '/tabs/contacts', tag });
  };
  let pendingIncoming = 0;
  for (const r of data.incoming ?? []) {
    if (r.state === 'pending' && r.requester) {
      pendingIncoming++;
      add(`req:${r.requester}`, await connName(r.requester, token), 'wants to be friends', 'ring:conn:req');
    }
  }
  for (const r of data.outgoing ?? []) {
    if (!r.target) continue;
    if (r.state === 'accepted') add(`acc:${r.target}`, await connName(r.target, token), 'accepted your friend request', `ring:conn:acc:${r.target}`);
    else if (r.state === 'rejected') add(`rej:${r.target}`, await connName(r.target, token), 'declined your friend request', `ring:conn:rej:${r.target}`);
  }
  return { notes, pendingIncoming };
}

// Wall: on a "new post" tickle (app closed), name the author instead of a generic placeholder.
// The author is server-visible metadata (not E2EE content), so this needs NO decryption — we
// resolve their public directory name, exactly like a friend request. Recent-window + a cursor
// keep us from re-announcing old posts; collapsed by author so 3 posts from X = one "X posted".
const POST_SINCE_KEY = 'sw.postNotifySince';
const POST_RECENT_MS = 10 * 60 * 1000;
export async function previewPosts(): Promise<{ notes: ConnNote[]; newCount: number }> {
  const token = await readSessionToken();
  if (!token) return { notes: [], newCount: 0 };
  const self = await readSessionUserId();
  const since = (await setting<number>(POST_SINCE_KEY, 0)) || 0;
  let data: { posts?: Array<{ id: string; author: string; createdAt: number }>; cursor?: number };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/posts?since=${since}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { notes: [], newCount: 0 };
    data = (await res.json()) as typeof data;
  } catch {
    return { notes: [], newCount: 0 };
  }
  const cutoff = Date.now() - POST_RECENT_MS;
  const fresh = (data.posts ?? []).filter((p) => p.author && p.author !== self && (p.createdAt ?? 0) > cutoff);
  const notes: ConnNote[] = [];
  const seen = new Set<string>();
  for (const p of fresh) {
    if (seen.has(p.author)) continue;
    seen.add(p.author);
    notes.push({
      keys: [`post:${p.id}`],
      title: await connName(p.author, token),
      body: 'posted on their Wall',
      url: '/tabs/wall',
      tag: `ring:post:${p.author}`,
    });
  }
  if (data.cursor && data.cursor > since) {
    await put<Setting<number>>('settings', { key: POST_SINCE_KEY, value: data.cursor });
  }
  return { notes, newCount: fresh.length };
}

/* ---- owner-only Wall engagement notifications (spec 1031) ---- */

// A `post-activity` push means someone engaged with OUR post. The payload carries the
// post id (sealed inside the encrypted push envelope), so the SW pulls exactly that
// post's engagement. Actor + kind are server metadata (no decryption needed for a
// comment note); the reaction add-vs-remove flag is sealed under K_post, so it is
// opened LOCALLY with the key on our own post row — an unopenable reaction is skipped
// (never a spurious alert for what might be a removal). A ledger keyed by engagement
// id keeps repeated tickles idempotent, mirroring the conn ledger.
const WALL_ACT_SHOWN_KEY = 'sw.wallActShown';
const WALL_ACT_SHOWN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const WALL_ACT_SHOWN_MAX = 500;
const WALL_ACT_RECENT_MS = 10 * 60 * 1000;

export interface PostActivityRow {
  id: string;
  actor: string;
  kind: string;
  payload: string;
  createdAt: number;
}

export interface PostActivityItem {
  id: string;
  actor: string;
  kind: 'reaction' | 'comment';
}

/**
 * The pure filter behind previewPostActivity: which engagement rows deserve a note?
 * Owner-only is re-checked HERE (the post row must be ours — defense in depth against
 * a misrouted push), self/stale/already-shown rows drop, and a reaction survives only
 * when `openReaction` proves it is an ADD. `openReaction` may throw (locked device /
 * cold start) — that reaction is skipped silently while comments still pass.
 */
export function classifyPostActivity(args: {
  post: { outgoing?: boolean; postKey?: string } | null | undefined;
  self: string;
  rows: PostActivityRow[];
  seen: Set<string>;
  now: number;
  openReaction: (postKeyB64: string, payload: string) => { remove?: boolean };
}): PostActivityItem[] {
  const { post, self, rows, seen, now, openReaction } = args;
  if (!post?.outgoing) return []; // not ours (or pruned/expired) → never alert
  const cutoff = now - WALL_ACT_RECENT_MS;
  const items: PostActivityItem[] = [];
  for (const r of rows) {
    if (!r.actor || r.actor === self) continue; // self-actions never alert
    if (seen.has(r.id)) continue; // already announced on an earlier wake
    if ((r.createdAt ?? 0) <= cutoff) continue; // stale backlog must not flood
    if (r.kind === 'comment') {
      items.push({ id: r.id, actor: r.actor, kind: 'comment' });
    } else if (r.kind === 'reaction') {
      if (!post.postKey) continue; // no key → can't prove add-vs-remove → stay silent
      try {
        if (openReaction(post.postKey, r.payload).remove) continue; // removals never alert
      } catch {
        continue; // unopenable (locked/cold) → silence beats a possibly-wrong alert
      }
      items.push({ id: r.id, actor: r.actor, kind: 'reaction' });
    }
    // tombstones / views / unknown kinds never alert (spec 1031 FR-011)
  }
  return items;
}

/** Render the surviving items as notification note(s): one item → an actor-named
 *  note; several → ONE collapsed note (per-post tag) covering all their ledger keys. */
export function buildPostActivityNotes(
  postId: string,
  items: PostActivityItem[],
  names: Map<string, string>,
): ConnNote[] {
  if (!items.length) return [];
  const url = `/wall/post/${postId}`;
  const tag = `ring:post:act:${postId}`;
  if (items.length === 1) {
    const it = items[0];
    return [{
      keys: [it.id],
      title: names.get(it.actor) ?? 'Someone',
      body: it.kind === 'comment' ? 'commented on your post' : 'reacted to your post',
      url,
      tag,
    }];
  }
  return [{ keys: items.map((i) => i.id), title: 'Ring', body: 'New activity on your post', url, tag }];
}

async function loadWallActShownEntries(): Promise<ShownEntry[]> {
  const raw = await setting<ShownEntry[]>(WALL_ACT_SHOWN_KEY, []);
  const cutoff = Date.now() - WALL_ACT_SHOWN_TTL_MS;
  return raw.filter((e) => e && typeof e.ts === 'number' && e.ts >= cutoff);
}

/**
 * Build the closed-app notification(s) for engagement on one of OUR posts. Fetches
 * that post's engagement list, filters via classifyPostActivity (owner re-check,
 * ledger, recency, removal-proofing), resolves actor names from the public directory
 * (like previewPosts), and persists the ledger for what will be displayed. Returns []
 * on any failure — a wrong silence self-heals on next open; a wrong alert doesn't.
 */
export async function previewPostActivity(postId: string): Promise<ConnNote[]> {
  if (!postId) return [];
  const token = await readSessionToken();
  if (!token) return [];
  const self = (await readSessionUserId()) ?? '';
  const post = await get<{ id: string; outgoing?: boolean; postKey?: string }>('posts', postId);
  let rows: PostActivityRow[] = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PENDING_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/posts/${encodeURIComponent(postId)}/engagement`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return [];
    rows = ((await res.json()) as { items?: PostActivityRow[] }).items ?? [];
  } catch {
    return [];
  }
  // libsodium must be initialized before opening sealed reaction payloads; comments
  // never need it, so a failed init only silences reactions (classify's catch).
  await sodiumReady().catch(() => {});
  const seen = new Set((await loadWallActShownEntries()).map((e) => e.id));
  const items = classifyPostActivity({ post, self, rows, seen, now: Date.now(), openReaction: openPostEngagement });
  if (!items.length) return [];
  const names = new Map<string, string>();
  for (const actor of new Set(items.map((i) => i.actor))) {
    names.set(actor, await connName(actor, token));
  }
  // Persist the ledger for what we're about to display so a repeated tickle
  // (collapse topic re-fire, multi-device) doesn't re-announce the same items.
  const entries = await loadWallActShownEntries();
  const known = new Set(entries.map((e) => e.id));
  const ts = Date.now();
  for (const it of items) if (!known.has(it.id)) entries.push({ id: it.id, ts });
  await put<Setting<ShownEntry[]>>('settings', { key: WALL_ACT_SHOWN_KEY, value: entries.slice(-WALL_ACT_SHOWN_MAX) });
  return buildPostActivityNotes(postId, items, names);
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
