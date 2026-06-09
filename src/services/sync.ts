/**
 * Sync engine. Pushes the outbox to the transport and applies inbound frames
 * (delivery receipts, changed records, tombstones), merging into IndexedDB so
 * the UI updates through the change bus + useLiveQuery. Last-write-wins on
 * `updatedAt`; tombstones prevent deleted rows from resurrecting.
 *
 * Today it runs against MockTransport (see services/transport.ts); the same
 * code drives the real WebSocket transport later. The cursor API is preserved.
 */
import { getSetting, setSetting, getMessage, receiveIncoming, markSendFailed } from '@/db/queries';
import { get, bulkPut, remove, type StoreName } from '@/db/idb';
import { listOutbox, removeOutbox, removeOutboxByFrameId, markOutboxSent } from '@/db/outbox';
import { recordTombstone, isTombstoned } from '@/db/tombstones';
import type { Frame, Transport } from '@/services/transport';
import type { Message } from '@/db/types';
import { applyPresenceFrame } from '@/composables/usePresence';

const CURSOR_KEY = 'syncCursor';

export function getSyncCursor(): Promise<string | null> {
  return getSetting<string | null>(CURSOR_KEY, null);
}

export function setSyncCursor(cursor: string): Promise<void> {
  return setSetting(CURSOR_KEY, cursor);
}

/* ---- push ---- */

let draining = false;
// An outbox entry stays until the server CONFIRMS it (a 'sent'/'delivered'/'read'
// receipt removes it). Until then it's re-sent on reconnect and on a periodic
// grace tick; re-sends are idempotent server-side (relay_queue is unique on
// recipient,msg_id). This is what closes the loss window where the server received
// a frame over the socket but restarted before durably queuing it: the client kept
// no copy under the old "remove on socket-write" behavior.
const ACK_GRACE_MS = 15_000; // don't re-send an in-flight entry until this elapses
const MAX_SENDS = 6; // ~ACK_GRACE*MAX_SENDS unconfirmed while online → give up (failed)

/** Drain the outbox: (re)send entries the server hasn't confirmed yet, keeping each
 *  until its receipt arrives. An entry sent within ACK_GRACE is left alone (awaiting
 *  confirmation); one that's been sent MAX_SENDS times without ever being confirmed
 *  is surfaced as failed (a later receipt still heals it past 'failed'). */
export async function drainOutbox(transport: Transport): Promise<number> {
  if (draining || transport.state !== 'online') return 0;
  draining = true;
  let pushed = 0;
  try {
    const entries = (await listOutbox()).sort((a, b) => a.createdAt - b.createdAt);
    const now = Date.now();
    for (const entry of entries) {
      // Already sent and still within the confirmation grace → wait for the receipt.
      if (entry.sentAt && now - entry.sentAt < ACK_GRACE_MS) continue;
      // Sent repeatedly but never confirmed → give up so the user sees it failed.
      // (Idempotency means no duplicate was created; if it HAD reached the server, a
      // later delivered/read receipt advances it past 'failed' on its own.)
      if (entry.attempts >= MAX_SENDS) {
        if (entry.frame.t === 'msg' && entry.frame.id) await markSendFailed(entry.frame.id);
        await removeOutbox(entry.id);
        continue;
      }
      try {
        await transport.send(entry.frame);
      } catch {
        break; // a state race closed the socket → stop; reconnect will re-drain
      }
      // Mark in-flight (NOT removed): the server's receipt removes it for real.
      await markOutboxSent(entry, now);
      pushed += 1;
    }
  } finally {
    draining = false;
  }
  return pushed;
}

/* ---- pull / inbound ---- */

const STATUS_ORDER: Record<Message['status'], number> = {
  compressing: 0, // local pre-send states sit below 'sent' so a server ack advances
  failed: 0,
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/** Apply one inbound frame to local storage. */
export async function handleIncomingFrame(frame: Frame): Promise<void> {
  switch (frame.t) {
    case 'receipt':
      await applyReceipt(frame.messageId, frame.status, frame.at, frame.from);
      return;
    case 'records':
      if (frame.store) await mergeRecords(frame.store as StoreName, frame.rows as MergeRow[]);
      if (frame.cursor) await setSyncCursor(frame.cursor);
      return;
    case 'tombstone':
      await applyTombstone(frame.store as StoreName, frame.recordId, frame.deletedAt);
      return;
    case 'msg':
      // Inbound relayed message: decrypt + store under the SENDER's message id
      // (so read receipts we send back correlate on their side). The ack (which
      // clears the server queue and triggers the sender's delivered receipt) is
      // sent by useSync after this resolves.
      await receiveIncoming(frame.from ?? '', frame.id, frame.ciphertext);
      return;
    case 'presence':
      applyPresenceFrame(frame);
      return;
    case 'call-offer':
    case 'call-answer':
    case 'call-ice':
    case 'call-ringing':
    case 'call-accept':
    case 'call-reject':
    case 'call-cancel':
    case 'call-busy':
    case 'call-end':
    case 'call-upgrade-request':
    case 'call-upgrade-accept':
    case 'call-upgrade-reject':
    case 'call-join':
    case 'call-leave':
    case 'call-roster':
    case 'call-key':
    case 'call-key-request':
    case 'call-streamid':
    case 'call-group-invite':
    case 'sfu-offer':
    case 'sfu-answer':
    case 'sfu-ice': {
      // Live-only call signalling → hand to the call controller. Lazily imported
      // to avoid pulling the WebRTC engine into the sync module's load path.
      const { handleCallFrame } = await import('@/composables/useCall');
      await handleCallFrame(frame);
      return;
    }
    default:
      return; // 'ack'/'pull' need no local change here
  }
}

async function applyReceipt(
  messageId: string,
  status: Message['status'],
  at: number,
  recipient?: string,
): Promise<void> {
  // Any server-originated status confirms the relay durably has the message for THIS
  // recipient, so its outbox retry copy can be dropped (at-least-once satisfied).
  // Scoped to `recipient` so one group member's receipt never evicts the still-unsent
  // copies addressed to the other members. Done before the local-message lookup so it
  // still fires for a message row that's since been pruned locally.
  if (status === 'sent' || status === 'delivered' || status === 'read') {
    await removeOutboxByFrameId(messageId, recipient);
  }
  const m = await getMessage(messageId);
  if (!m) return;

  const recs = m.receipts;
  if (recs && recs.length) {
    // The real "sent" time is when the server accepted it (not when composed). Set
    // here (the group path always persists) so the aggregate below can read it.
    if (status === 'sent') m.sentAt ??= at;
    // GROUP message: every fan-out copy is confirmed independently, and the server
    // stamps each receipt with the member who confirmed it (`recipient`). Record
    // ONLY that member's row (never the whole array), then derive the message-level
    // status from the aggregate, WhatsApp-style: a double (delivered) check only once
    // every member's device has it, blue (read) only once every member has opened it.
    // (The old code marked every member delivered/read on a single member's receipt,
    //  so Message info showed everyone as read the instant one person read.)
    if (recipient && (status === 'delivered' || status === 'read')) {
      const r = recs.find((x) => x.contactId === recipient);
      if (r) {
        if (status === 'delivered') r.deliveredAt ??= at;
        if (status === 'read') {
          r.deliveredAt ??= at;
          r.readAt = at;
        }
      }
    }
    const allDelivered = recs.every((r) => r.deliveredAt);
    const allRead = recs.every((r) => r.readAt);
    // Message-level timestamps only once the WHOLE group reaches that state.
    if (allDelivered) m.deliveredAt ??= Math.max(...recs.map((r) => r.deliveredAt ?? 0));
    if (allRead) m.readAt ??= Math.max(...recs.map((r) => r.readAt ?? 0));
    const agg: Message['status'] = allRead
      ? 'read'
      : allDelivered
        ? 'delivered'
        : m.sentAt
          ? 'sent'
          : m.status;
    // Monotonic clamp: a late member's 'delivered' must never regress an
    // already-all-read message, and an out-of-order frame can only raise status.
    if (STATUS_ORDER[agg] > STATUS_ORDER[m.status]) m.status = agg;
    m.updatedAt = Date.now();
    await bulkPut('messages', [m]); // notifies 'messages' → UI updates
    return;
  }

  // 1:1 message: a single scalar status timeline, monotonic.
  if (STATUS_ORDER[status] <= STATUS_ORDER[m.status]) return; // never regress
  m.status = status;
  m.updatedAt = Date.now();
  // The real "sent" time is when the server accepted it (not when composed).
  if (status === 'sent') m.sentAt ??= at;
  // Record when delivery/read happened so Message info can show a timeline.
  if (status === 'delivered') m.deliveredAt ??= at;
  if (status === 'read') {
    m.deliveredAt ??= at;
    m.readAt = at;
  }
  await bulkPut('messages', [m]); // notifies 'messages' → UI updates
}

interface MergeRow {
  id: string;
  updatedAt: number;
}

/** Last-write-wins merge: keep incoming rows newer than local and not tombstoned. */
async function mergeRecords(store: StoreName, rows: MergeRow[]): Promise<void> {
  const winners: MergeRow[] = [];
  for (const row of rows) {
    if (await isTombstoned(store, row.id, row.updatedAt)) continue;
    const local = await get<MergeRow>(store, row.id);
    if (!local || row.updatedAt > local.updatedAt) winners.push(row);
  }
  if (winners.length) await bulkPut(store, winners);
}

async function applyTombstone(
  store: StoreName,
  recordId: string,
  deletedAt: number,
): Promise<void> {
  await recordTombstone(store, recordId, deletedAt);
  const local = await get<MergeRow>(store, recordId);
  if (local && deletedAt >= local.updatedAt) await remove(store, recordId);
}
