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
import { deleteBlob } from '@/services/media-transfer';
import { applyStatusReceipt, applyDownloadedReceipt, type ReceiptStatus } from '@/services/message-status';
import { KeyedMutex } from '@/services/keyed-mutex';

const CURSOR_KEY = 'syncCursor';

export function getSyncCursor(): Promise<string | null> {
  return getSetting<string | null>(CURSOR_KEY, null);
}

export function setSyncCursor(cursor: string): Promise<void> {
  return setSetting(CURSOR_KEY, cursor);
}

/* ---- push ---- */

let draining = false;
// An outbox entry stays until the server CONFIRMS it (a 'sent'/'delivered'/'seen'
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
      // later delivered/seen receipt advances it past 'failed' on its own.)
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

// Serialize every read-modify-write of a given message row. Receipt application
// and media-cleanup both read a message, change a few fields, and write it back;
// without serialization a `downloaded` cleanup write made from a snapshot taken
// BEFORE an `await` could clobber a concurrent status transition (the regression
// this module fixes). Keying the lock by message id keeps unrelated messages
// fully concurrent.
const messageLock = new KeyedMutex();

/** Atomically update a message row: under the per-id lock, re-read the LATEST row,
 *  apply `fn`, and persist only if `fn` actually changed it (the pure reducers
 *  return the same reference on a no-op). Returns the resulting row, or undefined
 *  if the message no longer exists. */
async function mutateMessage(
  id: string,
  fn: (m: Message) => Message,
): Promise<Message | undefined> {
  return messageLock.run(id, async () => {
    const cur = await getMessage(id);
    if (!cur) return undefined;
    const next = fn(cur);
    if (next !== cur) {
      next.updatedAt = Date.now();
      await bulkPut('messages', [next]); // notifies 'messages' → UI updates
    }
    return next;
  });
}

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
      // (so seen receipts we send back correlate on their side). The ack (which
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
  status: Message['status'] | 'downloaded',
  at: number,
  recipient?: string,
): Promise<void> {
  // 'downloaded' is a media-cleanup signal, not a UI status: a recipient confirming it
  // holds the bytes. Handle it separately (it never touches the message's displayed
  // status) and return.
  if (status === 'downloaded') {
    await applyDownloaded(messageId, recipient ?? '', at);
    return;
  }
  // Any server-originated status confirms the relay durably has the message for THIS
  // recipient, so its outbox retry copy can be dropped (at-least-once satisfied).
  // Scoped to `recipient` so one group member's receipt never evicts the still-unsent
  // copies addressed to the other members. Done before the local-message lookup so it
  // still fires for a message row that's since been pruned locally.
  if (status === 'sent' || status === 'delivered' || status === 'seen') {
    await removeOutboxByFrameId(messageId, recipient);
  }
  // Status derivation is a pure reducer (see message-status.ts, fully unit-tested);
  // mutateMessage serializes the read-modify-write so a concurrent cleanup or local
  // write can't clobber it. The reducer no-ops (same reference) on a duplicate/late
  // frame, so no spurious write/notification happens.
  await mutateMessage(messageId, (m) => applyStatusReceipt(m, status as ReceiptStatus, at, recipient));
}

/** A recipient confirmed they hold our media's bytes. Once EVERY recipient has, delete the
 *  server blob (we own it) — instant cleanup the moment the media is fully downloaded,
 *  with the server's age sweep only as a backstop. 1:1 = the single peer; group = all
 *  members (m.receipts). Never changes the message's displayed status. */
async function applyDownloaded(messageId: string, recipient: string, at: number): Promise<void> {
  // Phase 1: stamp the cleanup bookkeeping under the lock (re-reading the latest row),
  // and learn whether every recipient now holds the bytes.
  let allDownloaded = false;
  const m = await mutateMessage(messageId, (cur) => {
    if (!cur.outgoing || !cur.sentBlobId) return cur; // not ours, or blob already gone
    const res = applyDownloadedReceipt(cur, recipient, at);
    allDownloaded = res.allDownloaded;
    return res.msg;
  });
  if (!m || !allDownloaded || !m.sentBlobId) return;

  // Phase 2: delete the server blob, then clear sentBlobId in a SEPARATE locked
  // mutation that re-reads the latest row. Crucially we never hold a message snapshot
  // across this await, so the clear can't overwrite a status change made meanwhile.
  try {
    await deleteBlob(m.sentBlobId);
  } catch {
    return; // leave sentBlobId set: retried on the next 'downloaded' / on chat delete; TTL backstops
  }
  await mutateMessage(messageId, (cur) => (cur.sentBlobId ? { ...cur, sentBlobId: undefined } : cur));
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
