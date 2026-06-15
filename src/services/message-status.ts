// Pure message-status reducers — the single source of truth for how an outgoing
// message's delivery status (the WhatsApp-style ticks) and its media-cleanup
// bookkeeping evolve as receipts arrive.
//
// Why a separate, pure module: status derivation used to live inline in sync.ts,
// entangled with IndexedDB, so it was untestable and a `downloaded` cleanup
// receipt could clobber a concurrent status transition (it rewrote the whole
// message row from a stale snapshot). These functions take a plain `Message` and
// return the next `Message` with NO I/O — so they're exhaustively unit-testable
// in the Node test env, and the stateful sync layer is a thin, serialized wrapper
// (see `mutateMessage` in sync.ts) that re-reads the latest row before applying.
//
// Contract used by the caller to avoid needless writes: a reducer returns the
// SAME object reference when it changes nothing, and a NEW object when it does.
// `updatedAt` is intentionally NOT touched here — that's the persistence layer's
// job (it stamps it only when a write actually happens).

import type { Message, Receipt } from '@/db/types';

/** Monotonic rank of each displayed status. Pre-send states (compressing/pending/
 *  failed) sit below `sent` so a server ack advances them; status never regresses
 *  to a lower rank. `downloaded` is deliberately absent — it is a media-cleanup
 *  signal, never a displayed status, and the types below keep it out of `status`. */
export const STATUS_ORDER: Record<Message['status'], number> = {
  compressing: 0,
  failed: 0,
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export function statusRank(s: Message['status']): number {
  return STATUS_ORDER[s];
}

/** Statuses a receipt can carry for the *displayed* timeline. `downloaded` is
 *  handled by a separate reducer and is intentionally excluded here, so the
 *  compiler prevents it from ever being assigned to `Message.status`. */
export type ReceiptStatus = Extract<Message['status'], 'sent' | 'delivered' | 'read'>;

/** Apply a status receipt to a message, dispatching on whether it's a group
 *  message (has a per-member `receipts[]` roster) or a 1:1 message. Returns the
 *  same reference when nothing changes. Never touches cleanup fields. */
export function applyStatusReceipt(
  msg: Message,
  status: ReceiptStatus,
  at: number,
  recipient?: string,
): Message {
  return msg.receipts && msg.receipts.length
    ? applyGroupReceipt(msg, status, at, recipient)
    : applyScalarReceipt(msg, status, at);
}

/** 1:1 message: a single scalar status timeline, monotonic. */
export function applyScalarReceipt(msg: Message, status: ReceiptStatus, at: number): Message {
  if (STATUS_ORDER[status] <= STATUS_ORDER[msg.status]) return msg; // never regress
  const next: Message = { ...msg, status };
  // The real "sent" time is when the server accepted it (not when composed).
  if (status === 'sent') next.sentAt ??= at;
  // Record when delivery/read happened so Message info can show a timeline.
  if (status === 'delivered') next.deliveredAt ??= at;
  if (status === 'read') {
    next.deliveredAt ??= at;
    next.readAt = at;
  }
  return next;
}

/** Group message: every fan-out copy is confirmed independently and the server
 *  stamps each receipt with the member who confirmed it (`recipient`). Record
 *  ONLY that member's row, then derive the message-level status from the whole
 *  roster, WhatsApp-style: delivered only once every member's device has it, read
 *  only once every member has opened it. (The pre-fix code marked everyone
 *  delivered/read on a single member's receipt.) Returns the same reference when
 *  nothing changes. */
export function applyGroupReceipt(
  msg: Message,
  status: ReceiptStatus,
  at: number,
  recipient?: string,
): Message {
  const recs: Receipt[] = (msg.receipts ?? []).map((r) => ({ ...r }));

  let touched = false;
  // The real "sent" time is when the server accepted it (the group path persists it).
  let sentAt = msg.sentAt;
  if (status === 'sent' && sentAt == null) {
    sentAt = at;
    touched = true;
  }
  if (recipient && (status === 'delivered' || status === 'read')) {
    const r = recs.find((x) => x.contactId === recipient);
    if (r) {
      if (status === 'delivered' && r.deliveredAt == null) {
        r.deliveredAt = at;
        touched = true;
      }
      if (status === 'read') {
        if (r.deliveredAt == null) r.deliveredAt = at;
        if (r.readAt !== at) {
          r.readAt = at;
          touched = true;
        }
      }
    }
  }

  const allDelivered = recs.length > 0 && recs.every((r) => r.deliveredAt);
  const allRead = recs.length > 0 && recs.every((r) => r.readAt);

  let deliveredAt = msg.deliveredAt;
  let readAt = msg.readAt;
  // Message-level timestamps only once the WHOLE group reaches that state.
  if (allDelivered && deliveredAt == null) deliveredAt = Math.max(...recs.map((r) => r.deliveredAt ?? 0));
  if (allRead && readAt == null) readAt = Math.max(...recs.map((r) => r.readAt ?? 0));

  const agg: Message['status'] = allRead ? 'read' : allDelivered ? 'delivered' : sentAt ? 'sent' : msg.status;
  // Monotonic clamp: a late member's 'delivered' must never regress an already-
  // all-read message, and an out-of-order frame can only raise status.
  const nextStatus = STATUS_ORDER[agg] > STATUS_ORDER[msg.status] ? agg : msg.status;

  if (
    !touched &&
    nextStatus === msg.status &&
    deliveredAt === msg.deliveredAt &&
    readAt === msg.readAt &&
    sentAt === msg.sentAt
  ) {
    return msg; // nothing changed
  }

  return { ...msg, receipts: recs, status: nextStatus, sentAt, deliveredAt, readAt };
}

/** A recipient confirmed they hold our media's bytes. Stamps the cleanup
 *  bookkeeping ONLY (never the displayed status or any *At timeline field) and
 *  reports whether EVERY recipient now holds the bytes, so the caller can delete
 *  the server blob. 1:1 = the single peer; group = all members (`receipts`).
 *  Returns the same reference when nothing changes. */
export function applyDownloadedReceipt(
  msg: Message,
  recipient: string,
  at: number,
): { msg: Message; allDownloaded: boolean } {
  if (msg.receipts && msg.receipts.length) {
    // Group: stamp this member, then check the whole roster.
    const recs = msg.receipts.map((r) => ({ ...r }));
    const r = recs.find((x) => x.contactId === recipient);
    const changed = r != null && r.downloadedAt == null;
    if (r && r.downloadedAt == null) r.downloadedAt = at;
    const allDownloaded = recs.every((x) => x.downloadedAt);
    return { msg: changed ? { ...msg, receipts: recs } : msg, allDownloaded };
  }
  // 1:1: the sole recipient confirming is enough.
  const already = (msg.downloadedBy ?? []).includes(recipient);
  if (already) return { msg, allDownloaded: true };
  const downloadedBy = [...new Set([...(msg.downloadedBy ?? []), recipient])];
  return { msg: { ...msg, downloadedBy }, allDownloaded: true };
}
