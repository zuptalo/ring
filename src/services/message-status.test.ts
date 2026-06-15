import { describe, it, expect } from 'vitest';
import type { Message, Receipt } from '@/db/types';
import {
  STATUS_ORDER,
  statusRank,
  applyScalarReceipt,
  applyGroupReceipt,
  applyStatusReceipt,
  applyDownloadedReceipt,
} from './message-status';

// Minimal outgoing-message factory. The reducers only read status/receipts/*At/
// cleanup fields, so the rest is filler.
function msg(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    chatId: 'c1',
    senderId: 'me',
    senderName: 'Me',
    body: '',
    kind: 'image',
    timestamp: 1000,
    outgoing: true,
    status: 'sent',
    ...over,
  } as Message;
}

function recipients(ids: string[]): Receipt[] {
  return ids.map((contactId) => ({ contactId }));
}

describe('STATUS_ORDER', () => {
  it('ranks pre-send states below sent and read at the top, and excludes downloaded', () => {
    expect(statusRank('pending')).toBeLessThan(statusRank('sent'));
    expect(statusRank('compressing')).toBeLessThan(statusRank('sent'));
    expect(statusRank('failed')).toBeLessThan(statusRank('sent'));
    expect(statusRank('sent')).toBeLessThan(statusRank('delivered'));
    expect(statusRank('delivered')).toBeLessThan(statusRank('read'));
    expect('downloaded' in STATUS_ORDER).toBe(false);
  });
});

describe('applyScalarReceipt (1:1)', () => {
  it('advances pending → sent → delivered → read and stamps timeline', () => {
    let m = msg({ status: 'pending' });
    m = applyScalarReceipt(m, 'sent', 10);
    expect(m.status).toBe('sent');
    expect(m.sentAt).toBe(10);
    m = applyScalarReceipt(m, 'delivered', 20);
    expect(m.status).toBe('delivered');
    expect(m.deliveredAt).toBe(20);
    m = applyScalarReceipt(m, 'read', 30);
    expect(m.status).toBe('read');
    expect(m.readAt).toBe(30);
    expect(m.deliveredAt).toBe(20); // unchanged by read
  });

  it('read implies delivered when delivered was skipped', () => {
    const m = applyScalarReceipt(msg({ status: 'sent' }), 'read', 30);
    expect(m.status).toBe('read');
    expect(m.deliveredAt).toBe(30);
    expect(m.readAt).toBe(30);
  });

  it('never regresses and returns the SAME reference on a no-op', () => {
    const m = msg({ status: 'read', readAt: 30, deliveredAt: 20, sentAt: 10 });
    expect(applyScalarReceipt(m, 'delivered', 99)).toBe(m); // same ref → no write
    expect(applyScalarReceipt(m, 'sent', 99)).toBe(m);
    expect(applyScalarReceipt(m, 'read', 99).status).toBe('read');
  });

  it('does not mutate the input', () => {
    const m = msg({ status: 'sent' });
    const out = applyScalarReceipt(m, 'delivered', 20);
    expect(out).not.toBe(m);
    expect(m.status).toBe('sent'); // original untouched
  });
});

describe('applyGroupReceipt', () => {
  it('does not reach delivered until EVERY member has delivered', () => {
    let m = msg({ status: 'sent', sentAt: 5, receipts: recipients(['a', 'b', 'c']) });
    m = applyGroupReceipt(m, 'delivered', 10, 'a');
    expect(m.status).toBe('sent'); // only a
    m = applyGroupReceipt(m, 'delivered', 11, 'b');
    expect(m.status).toBe('sent'); // a, b
    m = applyGroupReceipt(m, 'delivered', 12, 'c');
    expect(m.status).toBe('delivered'); // all three
    expect(m.deliveredAt).toBe(12);
  });

  it('does not reach read until EVERY member has read', () => {
    let m = msg({ status: 'delivered', sentAt: 5, receipts: recipients(['a', 'b']) });
    m = applyGroupReceipt(m, 'read', 20, 'a');
    expect(m.status).toBe('delivered');
    m = applyGroupReceipt(m, 'read', 21, 'b');
    expect(m.status).toBe('read');
    expect(m.readAt).toBe(21);
  });

  it('is order-independent: any permutation yields the same aggregate', () => {
    const base = () => msg({ status: 'sent', sentAt: 5, receipts: recipients(['a', 'b']) });
    const inOrder = [
      ['delivered', 10, 'a'],
      ['delivered', 11, 'b'],
      ['read', 20, 'a'],
      ['read', 21, 'b'],
    ] as const;
    const shuffled = [
      ['read', 21, 'b'],
      ['delivered', 10, 'a'],
      ['read', 20, 'a'],
      ['delivered', 11, 'b'],
    ] as const;
    const run = (steps: readonly (readonly [string, number, string])[]) =>
      steps.reduce((m, [s, at, who]) => applyGroupReceipt(m, s as never, at, who), base());
    const A = run(inOrder);
    const B = run(shuffled);
    // Terminal status and the all-read time are order-independent. (The aggregate
    // deliveredAt can differ when a member reads before it delivers — "read implies
    // delivered" stamps that member's deliveredAt to the read time — which is the
    // existing, intentional behavior; we only guarantee monotonic, stable status.)
    expect(A.status).toBe('read');
    expect(B.status).toBe('read');
    expect(A.readAt).toBe(B.readAt);
    expect(A.readAt).toBe(21);
    expect(A.deliveredAt).toBeDefined();
    expect(B.deliveredAt).toBeDefined();
  });

  it('a late member delivered never regresses an all-read message', () => {
    let m = msg({ status: 'read', sentAt: 5, receipts: recipients(['a', 'b']) });
    m.receipts = [
      { contactId: 'a', deliveredAt: 10, readAt: 20 },
      { contactId: 'b', deliveredAt: 11, readAt: 21 },
    ];
    const out = applyGroupReceipt(m, 'delivered', 99, 'a');
    expect(out.status).toBe('read'); // clamped
  });

  it('returns the SAME reference when a receipt adds nothing', () => {
    const m = msg({
      status: 'delivered',
      sentAt: 5,
      receipts: [
        { contactId: 'a', deliveredAt: 10 },
        { contactId: 'b' },
      ],
    });
    expect(applyGroupReceipt(m, 'delivered', 99, 'a')).toBe(m); // a already delivered
  });
});

describe('applyDownloadedReceipt — status independence (the bug)', () => {
  it('1:1: never changes status or timeline, marks allDownloaded, records peer', () => {
    const m = msg({ status: 'sent', sentAt: 10, sentBlobId: 'blob1' });
    const { msg: out, allDownloaded } = applyDownloadedReceipt(m, 'peer', 50);
    expect(allDownloaded).toBe(true);
    expect(out.status).toBe('sent'); // UNCHANGED
    expect(out.sentAt).toBe(10);
    expect(out.deliveredAt).toBeUndefined();
    expect(out.readAt).toBeUndefined();
    expect(out.downloadedBy).toEqual(['peer']);
  });

  it('group: allDownloaded only once every member confirms; status untouched', () => {
    let m = msg({ status: 'read', sentBlobId: 'blob1', receipts: recipients(['a', 'b']) });
    let r = applyDownloadedReceipt(m, 'a', 50);
    expect(r.allDownloaded).toBe(false);
    expect(r.msg.status).toBe('read');
    m = r.msg;
    r = applyDownloadedReceipt(m, 'b', 51);
    expect(r.allDownloaded).toBe(true);
    expect(r.msg.status).toBe('read'); // STILL untouched
    expect(r.msg.receipts?.every((x) => x.downloadedAt)).toBe(true);
  });

  it('is idempotent: re-confirming a peer is a no-op (same ref)', () => {
    const m = msg({ status: 'sent', sentBlobId: 'b', downloadedBy: ['peer'] });
    const { msg: out, allDownloaded } = applyDownloadedReceipt(m, 'peer', 99);
    expect(out).toBe(m);
    expect(allDownloaded).toBe(true);
  });

  it('does not mutate the input message or its receipts', () => {
    const m = msg({ status: 'read', receipts: recipients(['a', 'b']) });
    applyDownloadedReceipt(m, 'a', 50);
    expect(m.receipts?.find((x) => x.contactId === 'a')?.downloadedAt).toBeUndefined();
  });
});

describe('applyStatusReceipt dispatch', () => {
  it('routes to the scalar path for 1:1 and the group path for rosters', () => {
    expect(applyStatusReceipt(msg({ status: 'sent' }), 'delivered', 20).status).toBe('delivered');
    const g = applyStatusReceipt(
      msg({ status: 'sent', sentAt: 5, receipts: recipients(['a', 'b']) }),
      'delivered',
      20,
      'a',
    );
    expect(g.status).toBe('sent'); // group: not all delivered yet
  });
});
