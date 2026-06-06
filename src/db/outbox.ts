/**
 * Durable outbox: local writes awaiting push to the server. Persisted in the
 * `outbox` IndexedDB store so it survives reloads/offline; the sync engine
 * drains it whenever the transport is online (see services/sync.ts).
 *
 * At-least-once delivery: an entry is NOT removed when it's written to the socket
 * (a write only means the bytes left this device; the server may still crash /
 * restart before durably queuing it). It's removed only when the server confirms
 * receipt (a 'sent'/'delivered'/'read' receipt → removeByFrameId), and re-sent on
 * reconnect until then. The relay's EnqueueRelay is idempotent on
 * (recipient, msg_id), so re-sends never duplicate.
 */
import { getAll, put, remove, update } from './idb';
import { uid } from '@/utils/uid';
import type { Frame } from '@/services/transport';

export interface OutboxEntry {
  id: string;
  frame: Frame;
  createdAt: number;
  attempts: number; // times written to the socket (drives the give-up cap)
  sentAt?: number; // last time written to a live socket; absent = never sent yet
}

/** Append a frame to the outbox (notifies the `outbox` store → triggers a drain). */
export async function enqueue(frame: Frame): Promise<void> {
  await put<OutboxEntry>('outbox', {
    id: uid(),
    frame,
    createdAt: Date.now(),
    attempts: 0,
  });
}

export function listOutbox(): Promise<OutboxEntry[]> {
  return getAll<OutboxEntry>('outbox');
}

export function removeOutbox(id: string): Promise<void> {
  return remove('outbox', id);
}

/** Remove the outbox copy the server just confirmed (a receipt proves it's durably
 *  queued). Scoped to `recipient` when given: a group message fans out one copy per
 *  member (same message id, different `to`), so one member's receipt must clear ONLY
 *  that member's copy, never the still-unsent copies for the others. */
export async function removeOutboxByFrameId(messageId: string, recipient?: string): Promise<void> {
  for (const e of await getAll<OutboxEntry>('outbox')) {
    if (e.frame.t !== 'msg' || e.frame.id !== messageId) continue;
    // Fail safe: a receipt WITHOUT a recipient (a client read receipt, or anything
    // un-scoped) must never blanket-delete a copy that targets a specific recipient
    // that would wipe a group message's still-unsent copies for the other members.
    // Server 'sent'/'delivered' receipts always carry the recipient, so this only
    // ever skips the (already-delivered) single-copy paths.
    if (!recipient && e.frame.to) continue;
    if (recipient && e.frame.to && e.frame.to !== recipient) continue;
    await remove('outbox', e.id);
  }
}

/** Record that an entry was just (re)written to the socket: bump the attempt count
 *  and stamp sentAt, so it isn't re-sent again until the ack grace elapses. Done in
 *  a single atomic transaction that no-ops if the entry is already gone, so a
 *  confirming receipt that removed it on another async chain can't be resurrected. */
export async function markOutboxSent(entry: OutboxEntry, at: number): Promise<void> {
  await update<OutboxEntry>('outbox', entry.id, (cur) =>
    cur ? { ...cur, attempts: cur.attempts + 1, sentAt: at } : undefined,
  );
}
