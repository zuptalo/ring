/**
 * Service-worker AUTHORITATIVE receive (spec 1032, behind `sw.fullPersist`).
 *
 * Where sw-inbox.ts previews the queued E2EE frames read-only, this module — when
 * the gate below passes — applies eligible ones for real at notification time:
 * decrypt under the cross-context locks, commit the message row + chat summary +
 * advanced ratchet session + exactly-once ledger mark in ONE IndexedDB
 * transaction, and (the caller, after showing notifications) ack the frames so
 * the app opens warm. Everything it does NOT handle keeps today's preview-only
 * behavior and drains over the page's WebSocket on next open.
 *
 * Eligibility (v1, spec FR-004): plain messages — text, or media-by-reference
 * stored as `pendingMedia` for the page to download — in an EXISTING chat from an
 * EXISTING connected contact, including group messages into an existing group.
 * First-contact X3DH, contact/group cards, reactions, edits, erases, poll votes,
 * link-preview attaches, call signals, rekey/TTL controls: deferred.
 *
 * Degrade-to-today is the spine (spec FR-008): flag off, no Web Locks, locked
 * device, fetch failure, lock timeout (a frozen page can hold a lock), transaction
 * failure — every path returns a degrade/defer that leaves the frame queued and
 * the caller on the preview path. An ack is only ever sent for a frame whose
 * commit completed (in this wake or a previous one).
 *
 * Import-clean for the SW like sw-inbox.ts: idb, crypto/messaging, cross-lock,
 * sw-inbox helpers, notify-preview, types. No DOM / Ionic / page-only modules.
 */
import { attemptDeviceUnlock } from './crypto/identity';
import { openPacketStaged, DeferFrame, type StagedOpen } from './messaging';
import { withInboundLock, withSessionLock, locksAvailable, LockTimeoutError } from './cross-lock';
import { readSessionToken, readSessionUserId } from './session';
import { readHiddenSetOrNull } from './hidden-chats';
import { resolveInboundDirectChat } from './hidden-pair';
import { fetchPendingFrames, noteForPayload, aggregate, setting, loadShown, type MsgFrame, type SwNote } from './sw-inbox';
import { chatListPreview, previewKind } from './message-preview';
import { transact, getAll, get } from '@/db/idb';
import type { Chat, Contact, Message, Setting } from '@/db/types';
import type { MessagePayload } from './crypto/message';

const API = `${import.meta.env.VITE_API_URL ?? ''}/v1`;

/** Internal rollout flag (spec 1032 FR-011). Device-local, NOT in the Settings UI —
 *  overridable via dev tooling (`__ringTest.setSetting`). */
export const SW_FULL_PERSIST_KEY = 'sw.fullPersist';

/** The flag's default when the device has no stored value: ON for everyone (spec
 *  1032 rollout completion — messages are saved the moment a notification arrives,
 *  so the app opens up to date). An explicitly stored `false` still wins as a
 *  per-device kill switch (and pins today's-behavior control tests) until the flag
 *  is removed entirely in a later cleanup. */
export const SW_FULL_PERSIST_DEFAULT = true;

// How long the SW waits for a cross-context lock before degrading that frame (and
// the rest of the wake) to preview-only. A frozen-but-alive page can hold a lock
// indefinitely; the push handler must not burn its waitUntil budget waiting.
const LOCK_TIMEOUT_MS = 3000;

// Bound on the /relay/ack POST, mirroring sw-inbox's PENDING_FETCH_TIMEOUT_MS.
const ACK_TIMEOUT_MS = 8000;

// The exactly-once ledger SHARED with the page path (db/queries.ts
// wasInboundSeen/markInboundSeen — same key, same cap). The SW marks a frame
// inside its atomic commit; the page skips marked frames and just re-acks.
const INBOUND_SEEN_KEY = 'inboundSeenIds';
const INBOUND_SEEN_CAP = 2000;

export type DegradeReason =
  | 'flag-off'
  | 'no-locks'
  | 'no-token'
  | 'locked'
  | 'hidden-unknown'
  | 'relay-error'
  | 'no-frames';

export interface DrainResult {
  /** 'applied' = the drain ran (even if some frames deferred); 'degrade' = the
   *  caller must run today's preview path instead. */
  mode: 'applied' | 'degrade';
  reason?: DegradeReason | 'lock-timeout';
  /** Frames committed in THIS wake. */
  applied: number;
  /** Frame ids safe to ack: committed now, or found already-committed (re-ack). */
  ackIds: string[];
  /** msg frames left queued for the page (ineligible / failed / lock-timeout). */
  deferred: number;
  /** Notifications for the APPLIED frames (existing privacy rules), aggregated. */
  notes: SwNote[];
}

interface ApplyCtx {
  chats: Chat[];
  contacts: Contact[];
  connected: Record<string, boolean>;
  blocked: Record<string, boolean>;
  hidden: Set<string>;
  selfId: string;
  showMessages: boolean;
  showPreview: boolean;
  keepArchived: boolean;
}

/** The plain-1:1 session chat for a peer: EXACTLY the page's rule-R resolver
 *  (resolveInboundDirectChat — visible non-pending first, then visible pending,
 *  then hidden), so both writers route a frame to the same chat (security review
 *  F3: a pending-flag-only preference could commit into a hidden chat the page
 *  would have routed visibly). Returns null when no chat row exists — which also
 *  covers the hidden-chat reset block (the reset destroyed the row), so those
 *  frames defer to the page. */
export function directChatFor(chats: Chat[], hidden: ReadonlySet<string>, from: string): Chat | null {
  return resolveInboundDirectChat(chats, hidden, from);
}

/** Pure eligibility classifier over a DECRYPTED payload (spec FR-004). Anything
 *  that is not a plain displayable message defers to the page — those frames are
 *  side effects (cards, reactions, controls) whose handlers live page-side. */
export function classifyPayload(
  payload: MessagePayload,
  chats: Chat[],
): { verdict: 'eligible'; targetChatId: string | null } | { verdict: 'defer'; why: string } {
  if (payload.card) return { verdict: 'defer', why: 'card' };
  if (payload.group) return { verdict: 'defer', why: 'group-card' };
  if (payload.reaction) return { verdict: 'defer', why: 'reaction' };
  if (payload.pollVote) return { verdict: 'defer', why: 'poll-vote' };
  if (payload.gameMove) return { verdict: 'defer', why: 'game-move' };
  if (payload.edit) return { verdict: 'defer', why: 'edit' };
  if (payload.erase) return { verdict: 'defer', why: 'erase' };
  if (payload.linkPreviewSig) return { verdict: 'defer', why: 'link-preview' };
  if (payload.call) return { verdict: 'defer', why: 'call-signal' };
  if (payload.rekey) return { verdict: 'defer', why: 'rekey' };
  if (payload.ttl !== undefined) return { verdict: 'defer', why: 'ttl-control' };
  if (payload.groupId) {
    const g = chats.find((c) => c.id === payload.groupId && c.isGroup);
    if (!g) return { verdict: 'defer', why: 'unknown-group' };
    return { verdict: 'eligible', targetChatId: g.id };
  }
  return { verdict: 'eligible', targetChatId: null }; // null = the 1:1 session chat
}

type ApplyOutcome =
  | { kind: 'applied'; note: SwNote | null }
  | { kind: 'ack-only'; note: SwNote | null }
  | { kind: 'defer'; why: string };

/** Rebuild the notification for a frame that was COMMITTED in a previous wake but
 *  never shown (SW killed between commit and showNotes — its id is in the seen
 *  ledger but not the shown ledger). The message row is the durable source: map it
 *  back to a payload shape and run the exact same noteForPayload privacy rules.
 *  Returns null when the note was already shown, or the row can't be found (page
 *  applied it — its own notify path ran). */
async function noteFromCommittedFrame(id: string, ctx: ApplyCtx): Promise<SwNote | null> {
  if ((await loadShown()).includes(id)) return null; // already alerted (normal re-ack)
  const m = await get<Message>('messages', id);
  if (!m || m.outgoing) return null;
  const chat = ctx.chats.find((c) => c.id === m.chatId);
  const payload: MessagePayload = {
    body: m.body,
    kind: m.kind,
    timestamp: m.timestamp,
    groupId: chat?.isGroup ? chat.id : undefined,
    albumName: m.albumName,
    videoNote: m.videoNote,
    location: m.location,
    poll: m.poll,
    game: m.game ? { gameType: m.game.gameType } : undefined,
    contact: m.contact,
    audio: m.audio,
    mentions: m.mentions,
    mentionsEveryone: m.mentionsEveryone,
  };
  const { note } = noteForPayload(
    { t: 'msg', id, from: m.senderId },
    payload,
    ctx.chats,
    ctx.contacts,
    ctx.showMessages,
    ctx.showPreview,
    ctx.hidden,
    ctx.selfId,
  );
  return note;
}

/** Apply ONE frame under the session lock: staged decrypt → classify → atomic
 *  commit. Caller holds `ring:inbound`. Never acks — it only reports. */
async function applyOne(f: MsgFrame, ctx: ApplyCtx): Promise<ApplyOutcome> {
  const id = f.id as string;
  const from = f.from as string;

  // Exactly-once (shared ledger): already committed by us or the page → re-ack.
  // But NEVER silently (security review F4): if a prior wake committed this frame
  // and was killed before its notification/ack, the redelivery is the only chance
  // to alert — rebuild the note from the stored row unless it was already shown.
  const seenNow = await setting<string[]>(INBOUND_SEEN_KEY, []);
  if (seenNow.includes(id)) {
    return { kind: 'ack-only', note: await noteFromCommittedFrame(id, ctx) };
  }

  if (ctx.blocked[from]) return { kind: 'defer', why: 'blocked' }; // page drops + acks on open
  const contact = ctx.contacts.find((c) => c.id === from);
  if (!contact || !ctx.connected[from]) return { kind: 'defer', why: 'not-connected' };
  const direct = directChatFor(ctx.chats, ctx.hidden, from);
  if (!direct) return { kind: 'defer', why: 'no-chat' };

  // The session lock spans decrypt AND commit: openPacketStaged persists nothing,
  // so a gap here would let a page seal interleave and be clobbered by our commit.
  return withSessionLock(
    direct.id,
    async () => {
      let staged: StagedOpen;
      try {
        staged = await openPacketStaged(direct.id, f.ciphertext);
      } catch (e) {
        if (e instanceof DeferFrame) return { kind: 'defer' as const, why: e.why };
        throw e;
      }
      const payload = staged.payload;
      const cls = classifyPayload(payload, ctx.chats);
      if (cls.verdict === 'defer') return { kind: 'defer' as const, why: cls.why };
      const targetChatId = cls.targetChatId ?? direct.id;

      const ts = payload.timestamp || Date.now();
      const kind = (payload.kind as Message['kind']) || 'text';
      const isGroupMsg = !!payload.groupId;
      // Media bytes are NEVER downloaded in the SW (no canvas pipeline, tight
      // budget): store the reference as pendingMedia; the page backfills via
      // resumePendingMediaJobs on reconnect.
      const message: Message = {
        id, // the sender's message id: receipts correlate + redelivery dedupes
        chatId: targetChatId,
        senderId: from,
        senderName: contact.name,
        body: payload.body,
        kind,
        durationSec: payload.mediaRef?.durationSec,
        timestamp: ts,
        outgoing: false,
        status: 'delivered',
        replyTo: payload.reply,
        albumId: payload.albumId,
        albumName: payload.albumName,
        videoNote: payload.videoNote,
        location: payload.location,
        poll: payload.poll,
        // A fresh session for an inbound game bubble, exactly like the page's
        // receive (spec 0008): moves arrive later as page-deferred signals.
        game: payload.game ? { gameType: payload.game.gameType, moves: [] } : undefined,
        contact: payload.contact,
        audio: payload.audio,
        linkPreview: payload.linkPreview,
        mentions: payload.mentions,
        mentionsEveryone: payload.mentionsEveryone,
        expiresAt: payload.expiresAt,
        mediaWidth: payload.mediaRef?.width,
        mediaHeight: payload.mediaRef?.height,
        mediaSize: payload.mediaRef?.size,
        mediaQuality: payload.mediaRef?.quality as Message['mediaQuality'],
        posterData: payload.mediaRef?.poster,
        pendingMedia: payload.mediaRef,
        updatedAt: Date.now(),
      };

      // ONE transaction: session advance + message row + chat RMW + ledger mark.
      // All-or-nothing (see idb transact): a kill/quota error leaves the frame
      // queued and unmarked → clean redelivery; committed-but-unacked → the ledger
      // turns the redelivery into a bare re-ack. The chat row is re-read INSIDE the
      // transaction (the pre-loaded ctx.chats is classification-only) so this RMW
      // can't clobber a concurrent page write — the inbound lock already excludes
      // the page's receive path, and same-store writes serialize in IDB.
      await transact(['sessions', 'messages', 'chats', 'settings'], async (tx) => {
        tx.put('sessions', staged.sessionRow);
        for (const w of staged.metaWrites) tx.put('settings', { key: w.key, value: w.value });
        tx.put('messages', message);
        const chat = await tx.get<Chat>('chats', targetChatId);
        if (chat) {
          const preview = chatListPreview(payload, kind, payload.mediaRef?.durationSec);
          chat.lastMessage = isGroupMsg ? `${contact.name.split(' ')[0]}: ${preview}` : preview;
          chat.lastKind = previewKind(kind, payload.albumName, payload.videoNote);
          chat.lastMessageTime = ts;
          chat.interactions = (chat.interactions ?? 0) + 1;
          // No isChatActive here: the gate already deferred to any live page that
          // claimed the wake, so nobody is viewing this chat right now.
          chat.unread = (chat.unread ?? 0) + 1;
          const selfMentioned =
            isGroupMsg &&
            (!!payload.mentions?.includes(ctx.selfId) ||
              (!!payload.mentionsEveryone && !!chat.createdBy && from === chat.createdBy));
          if (selfMentioned) chat.unreadMentions = (chat.unreadMentions ?? 0) + 1;
          // Accepted 1:1 content un-pends the chat, mirroring the page path (security
          // review F7): the frame is acked, so the page never reprocesses it — leaving
          // pending set would strand delivered messages in a hidden "request" chat.
          if (!isGroupMsg && chat.pending) delete chat.pending;
          if (chat.archived && !chat.locked && !ctx.keepArchived) {
            delete chat.archived;
          }
          chat.updatedAt = Date.now();
          tx.put('chats', chat);
        }
        const seen = (await tx.get<Setting<string[]>>('settings', INBOUND_SEEN_KEY))?.value ?? [];
        if (!seen.includes(id)) {
          tx.put('settings', { key: INBOUND_SEEN_KEY, value: [...seen, id].slice(-INBOUND_SEEN_CAP) });
        }
      });

      // The notification for what we just committed — the exact same privacy rules
      // as the preview path (mute / hidden / content prefs / mentions), so posture
      // behavior is byte-identical (spec FR-006).
      const { note } = noteForPayload(
        f,
        payload,
        ctx.chats,
        ctx.contacts,
        ctx.showMessages,
        ctx.showPreview,
        ctx.hidden,
        ctx.selfId,
      );
      return { kind: 'applied' as const, note };
    },
    { timeoutMs: LOCK_TIMEOUT_MS },
  );
}

/**
 * The drain: gate → fetch → per-frame apply under `ring:inbound` → result. Does
 * NOT ack — the caller shows the notifications first (so a kill after commit
 * can't lose the wake's alert), then calls ackFrames(result.ackIds) as the LAST
 * step. Any degrade leaves the world exactly as today's preview path expects it.
 */
export async function drainPersistPending(): Promise<DrainResult> {
  const degrade = (reason: DegradeReason): DrainResult => ({
    mode: 'degrade',
    reason,
    applied: 0,
    ackIds: [],
    deferred: 0,
    notes: [],
  });

  if (!(await setting<boolean>(SW_FULL_PERSIST_KEY, SW_FULL_PERSIST_DEFAULT))) return degrade('flag-off');
  if (!locksAvailable()) return degrade('no-locks');
  const token = await readSessionToken();
  if (!token) return degrade('no-token');
  // PIN/passkey posture (spec FR-006): no device key → no decrypt, no storage —
  // BEFORE any fetch, so the wake is byte-identical to today's locked behavior
  // (previewPending does its own fetch and shows the generic).
  if (!(await attemptDeviceUnlock().catch(() => false))) return degrade('locked');

  const fetched = await fetchPendingFrames(token);
  if ('failure' in fetched) return degrade('relay-error');
  const frames = fetched.frames.filter((f) => f.t === 'msg' && !!f.id && !!f.from);
  if (!frames.length) return degrade('no-frames');

  // Fail closed while the hidden-chat set can't be read (mirrors the page's
  // routeInboundFrom defer): we can't route or classify safely without it.
  const hidden = await readHiddenSetOrNull();
  if (hidden === null) return degrade('hidden-unknown');

  const [chats, contacts, selfId, showMessages, showPreview, connected, blocked, keepArchived] = await Promise.all([
    getAll<Chat>('chats'),
    getAll<Contact>('contacts'),
    readSessionUserId(),
    setting<boolean>('notifications.message.show', true),
    setting<boolean>('notifications.showPreview', true),
    setting<Record<string, boolean>>('connectedPeers', {}),
    setting<Record<string, boolean>>('blockedPeers', {}),
    setting<boolean>('chats.keepArchived', false),
  ]);
  const ctx: ApplyCtx = {
    chats,
    contacts,
    connected,
    blocked,
    hidden,
    selfId: selfId ?? '',
    showMessages,
    showPreview,
    keepArchived,
  };

  const ackIds: string[] = [];
  const rawNotes: SwNote[] = [];
  let applied = 0;
  let deferred = 0;
  let reason: DrainResult['reason'];

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    try {
      const out = await withInboundLock(() => applyOne(f, ctx), { timeoutMs: LOCK_TIMEOUT_MS });
      if (out.kind === 'applied') {
        applied += 1;
        ackIds.push(f.id as string);
        if (out.note) rawNotes.push(out.note);
      } else if (out.kind === 'ack-only') {
        ackIds.push(f.id as string);
        if (out.note) rawNotes.push(out.note); // committed earlier but never alerted (F4)
      } else {
        deferred += 1;
      }
    } catch (e) {
      if (e instanceof LockTimeoutError) {
        // Someone (a frozen page?) holds a lock: stop fighting, defer the rest of
        // the wake to the preview path — it needs no locks and the page drains later.
        reason = 'lock-timeout';
        deferred += frames.length - i;
        break;
      }
      console.warn('[sw-drain] frame apply failed → deferred', e);
      deferred += 1; // stays queued; today's behavior for this frame
    }
  }

  return { mode: 'applied', reason, applied, ackIds, deferred, notes: aggregate(rawNotes) };
}

/** Ack committed frames (idempotent server-side): deletes them from the relay
 *  queue and emits the durable delivered receipts, exactly like the page's WS
 *  ack. STRICTLY after commit + notifications — the wake's last step. Returns
 *  false on failure; the frames then linger (harmless: the ledger makes their
 *  redelivery a bare re-ack). */
export async function ackFrames(ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const token = await readSessionToken();
  if (!token) return false;
  try {
    // Bounded like every other SW-context fetch (security review F10): a hung ack on
    // a flaky post-wake network must not stall the notify chain past the push budget —
    // an unacked frame just lingers and redelivers as a bare re-ack via the ledger.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ACK_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/relay/ack`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    return res.ok;
  } catch (e) {
    console.warn('[sw-drain] ack failed (frames linger; ledger dedupes)', e);
    return false;
  }
}
