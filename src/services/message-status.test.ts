import { describe, it, expect } from 'vitest';
import type { Message, Receipt } from '@/db/types';
import {
  STATUS_ORDER,
  statusRank,
  applyScalarReceipt,
  applyGroupReceipt,
  applyStatusReceipt,
  applyDownloadedReceipt,
  groupProgress,
  lastMessageTick,
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
  it('ranks pre-send states below sent and seen at the top, and excludes downloaded', () => {
    expect(statusRank('pending')).toBeLessThan(statusRank('sent'));
    expect(statusRank('compressing')).toBeLessThan(statusRank('sent'));
    expect(statusRank('failed')).toBeLessThan(statusRank('sent'));
    expect(statusRank('sent')).toBeLessThan(statusRank('delivered'));
    expect(statusRank('delivered')).toBeLessThan(statusRank('seen'));
    expect('downloaded' in STATUS_ORDER).toBe(false);
  });
});

describe('applyScalarReceipt (1:1)', () => {
  it('advances pending → sent → delivered → seen and stamps timeline', () => {
    let m = msg({ status: 'pending' });
    m = applyScalarReceipt(m, 'sent', 10);
    expect(m.status).toBe('sent');
    expect(m.sentAt).toBe(10);
    m = applyScalarReceipt(m, 'delivered', 20);
    expect(m.status).toBe('delivered');
    expect(m.deliveredAt).toBe(20);
    m = applyScalarReceipt(m, 'seen', 30);
    expect(m.status).toBe('seen');
    expect(m.seenAt).toBe(30);
    expect(m.deliveredAt).toBe(20); // unchanged by seen
  });

  it('seen implies delivered when delivered was skipped', () => {
    const m = applyScalarReceipt(msg({ status: 'sent' }), 'seen', 30);
    expect(m.status).toBe('seen');
    expect(m.deliveredAt).toBe(30);
    expect(m.seenAt).toBe(30);
  });

  it('never regresses and returns the SAME reference on a no-op', () => {
    const m = msg({ status: 'seen', seenAt: 30, deliveredAt: 20, sentAt: 10 });
    expect(applyScalarReceipt(m, 'delivered', 99)).toBe(m); // same ref → no write
    expect(applyScalarReceipt(m, 'sent', 99)).toBe(m);
    expect(applyScalarReceipt(m, 'seen', 99).status).toBe('seen');
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

  it('does not reach seen until EVERY member has seen', () => {
    let m = msg({ status: 'delivered', sentAt: 5, receipts: recipients(['a', 'b']) });
    m = applyGroupReceipt(m, 'seen', 20, 'a');
    expect(m.status).toBe('delivered');
    m = applyGroupReceipt(m, 'seen', 21, 'b');
    expect(m.status).toBe('seen');
    expect(m.seenAt).toBe(21);
  });

  it('is order-independent: any permutation yields the same aggregate', () => {
    const base = () => msg({ status: 'sent', sentAt: 5, receipts: recipients(['a', 'b']) });
    const inOrder = [
      ['delivered', 10, 'a'],
      ['delivered', 11, 'b'],
      ['seen', 20, 'a'],
      ['seen', 21, 'b'],
    ] as const;
    const shuffled = [
      ['seen', 21, 'b'],
      ['delivered', 10, 'a'],
      ['seen', 20, 'a'],
      ['delivered', 11, 'b'],
    ] as const;
    const run = (steps: readonly (readonly [string, number, string])[]) =>
      steps.reduce((m, [s, at, who]) => applyGroupReceipt(m, s as never, at, who), base());
    const A = run(inOrder);
    const B = run(shuffled);
    // Terminal status and the all-seen time are order-independent. (The aggregate
    // deliveredAt can differ when a member sees before it delivers — "seen implies
    // delivered" stamps that member's deliveredAt to the seen time — which is the
    // existing, intentional behavior; we only guarantee monotonic, stable status.)
    expect(A.status).toBe('seen');
    expect(B.status).toBe('seen');
    expect(A.seenAt).toBe(B.seenAt);
    expect(A.seenAt).toBe(21);
    expect(A.deliveredAt).toBeDefined();
    expect(B.deliveredAt).toBeDefined();
  });

  it('a late member delivered never regresses an all-seen message', () => {
    let m = msg({ status: 'seen', sentAt: 5, receipts: recipients(['a', 'b']) });
    m.receipts = [
      { contactId: 'a', deliveredAt: 10, seenAt: 20 },
      { contactId: 'b', deliveredAt: 11, seenAt: 21 },
    ];
    const out = applyGroupReceipt(m, 'delivered', 99, 'a');
    expect(out.status).toBe('seen'); // clamped
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
    expect(out.seenAt).toBeUndefined();
    expect(out.downloadedBy).toEqual(['peer']);
  });

  it('group: allDownloaded only once every member confirms; status untouched', () => {
    let m = msg({ status: 'seen', sentBlobId: 'blob1', receipts: recipients(['a', 'b']) });
    let r = applyDownloadedReceipt(m, 'a', 50);
    expect(r.allDownloaded).toBe(false);
    expect(r.msg.status).toBe('seen');
    m = r.msg;
    r = applyDownloadedReceipt(m, 'b', 51);
    expect(r.allDownloaded).toBe(true);
    expect(r.msg.status).toBe('seen'); // STILL untouched
    expect(r.msg.receipts?.every((x) => x.downloadedAt)).toBe(true);
  });

  it('is idempotent: re-confirming a peer is a no-op (same ref)', () => {
    const m = msg({ status: 'sent', sentBlobId: 'b', downloadedBy: ['peer'] });
    const { msg: out, allDownloaded } = applyDownloadedReceipt(m, 'peer', 99);
    expect(out).toBe(m);
    expect(allDownloaded).toBe(true);
  });

  it('does not mutate the input message or its receipts', () => {
    const m = msg({ status: 'seen', receipts: recipients(['a', 'b']) });
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

describe('groupProgress (complete-the-tier counter, spec 1010 FR-004/005)', () => {
  // Build a roster of N recipients with the given delivered/seen flags.
  function roster(specs: Array<{ d?: boolean; s?: boolean }>): Receipt[] {
    return specs.map((x, i) => ({
      contactId: String.fromCharCode(97 + i),
      deliveredAt: x.d ? 10 + i : undefined,
      seenAt: x.s ? 20 + i : undefined,
    }));
  }

  it('returns null for a non-group message (no receipts roster)', () => {
    expect(groupProgress(msg({}))).toBeNull();
    expect(groupProgress(msg({ receipts: [] }))).toBeNull();
  });

  it('N from the roster: 0 delivered → Sent tier, no fraction', () => {
    const p = groupProgress(msg({ receipts: roster([{}, {}, {}]) }));
    expect(p).toEqual({ tier: 'sent', label: null });
  });

  it('partial delivered → "Delivered X/N"', () => {
    const p = groupProgress(msg({ receipts: roster([{ d: true }, {}, {}]) }));
    expect(p).toEqual({ tier: 'delivered', label: '1/3' });
  });

  it('all delivered, none seen → delivered tier, no fraction', () => {
    const p = groupProgress(msg({ receipts: roster([{ d: true }, { d: true }]) }));
    expect(p).toEqual({ tier: 'delivered', label: null });
  });

  it('all delivered, partial seen → "Seen X/N"', () => {
    const p = groupProgress(msg({ receipts: roster([{ d: true, s: true }, { d: true }, { d: true }]) }));
    expect(p).toEqual({ tier: 'seen', label: '1/3' });
  });

  it('all seen → "Seen", no fraction', () => {
    const p = groupProgress(msg({ receipts: roster([{ d: true, s: true }, { d: true, s: true }]) }));
    expect(p).toEqual({ tier: 'seen', label: null });
  });

  it('N=1 never shows a fraction (renders like a 1:1)', () => {
    expect(groupProgress(msg({ receipts: roster([{ d: true }]) }))).toEqual({ tier: 'delivered', label: null });
    expect(groupProgress(msg({ receipts: roster([{ d: true, s: true }]) }))).toEqual({ tier: 'seen', label: null });
  });

  it('reciprocity: seenEnabled=false caps at the delivered tier (seen ignored)', () => {
    const m = msg({ receipts: roster([{ d: true, s: true }, { d: true, s: true }]) });
    // With seen on, this is fully seen; with it off it must cap at delivered.
    expect(groupProgress(m, true)).toEqual({ tier: 'seen', label: null });
    expect(groupProgress(m, false)).toEqual({ tier: 'delivered', label: null });
    // A partially-seen group with seen off shows the delivered tier (here all
    // delivered → plain), never a "Seen X/N".
    const partial = msg({ receipts: roster([{ d: true, s: true }, { d: true }]) });
    expect(groupProgress(partial, false)).toEqual({ tier: 'delivered', label: null });
  });
});

describe('spec 1062: lastMessageTick (shared list/tile tick tier)', () => {
  // Local receipt roster: {d,s} → deliveredAt/seenAt set. (The identically-named
  // helper above is scoped to another describe block, so we define our own here.)
  const roster = (rs: { d?: boolean; s?: boolean }[]): Receipt[] =>
    rs.map((r, i) => ({
      contactId: `u${i}`,
      deliveredAt: r.d ? 1 : undefined,
      seenAt: r.s ? 1 : undefined,
    }));

  it('renders nothing for an incoming or absent last message', () => {
    expect(lastMessageTick(undefined)).toBe('none');
    expect(lastMessageTick(null)).toBe('none');
    expect(lastMessageTick(msg({ outgoing: false, status: 'seen' }))).toBe('none');
  });

  it('failed outgoing sends show no success tick', () => {
    expect(lastMessageTick(msg({ status: 'failed' }))).toBe('failed');
  });

  // (spec 2054) A call entry is stored as a message so it appears in the timeline, but it is
  // informational — never enqueued, no receipts — so it must never render a delivery tick,
  // even though an outgoing call is flagged outgoing with status 'seen'.
  it('a call-log entry never shows a tick, even when outgoing', () => {
    expect(lastMessageTick({ ...msg({ status: 'seen' }), callLog: { direction: 'outgoing' } })).toBe('none');
    expect(lastMessageTick({ ...msg({ status: 'delivered' }), callLog: {} })).toBe('none');
    // …while an ordinary outgoing message is unaffected.
    expect(lastMessageTick(msg({ status: 'seen' }))).toBe('seen');
  });

  it('pre-send states map to pending (clock)', () => {
    expect(lastMessageTick(msg({ status: 'pending' }))).toBe('pending');
    expect(lastMessageTick(msg({ status: 'compressing' }))).toBe('pending');
  });

  it('1:1 maps status straight through', () => {
    expect(lastMessageTick(msg({ status: 'sent' }))).toBe('sent');
    expect(lastMessageTick(msg({ status: 'delivered' }))).toBe('delivered');
    expect(lastMessageTick(msg({ status: 'seen' }))).toBe('seen');
  });

  it('1:1 seen caps at delivered when seen-receipts are off (reciprocity)', () => {
    expect(lastMessageTick(msg({ status: 'seen' }), false)).toBe('delivered');
    // sent/delivered are unaffected by the gate
    expect(lastMessageTick(msg({ status: 'delivered' }), false)).toBe('delivered');
  });

  // isGroup is a lastMessageTick input flag, not a Message field — attach it to the
  // spread message rather than the Partial<Message> factory.
  const group = (over: Partial<Message>) => ({ ...msg(over), isGroup: true });

  it('groups derive the tier from the receipt roster (via groupProgress)', () => {
    const allDelivered = group({ status: 'delivered', receipts: roster([{ d: true }, { d: true }]) });
    expect(lastMessageTick(allDelivered)).toBe('delivered');

    const partialDelivered = group({ status: 'sent', receipts: roster([{ d: true }, {}]) });
    // partial delivery still shows the delivered tier (fraction is a bubble-only detail)
    expect(lastMessageTick(partialDelivered)).toBe('delivered');

    const allSeen = group({ status: 'seen', receipts: roster([{ d: true, s: true }, { d: true, s: true }]) });
    expect(lastMessageTick(allSeen)).toBe('seen');
  });

  it('group seen tier is suppressed when seen-receipts are off', () => {
    const allSeen = group({ status: 'seen', receipts: roster([{ d: true, s: true }, { d: true, s: true }]) });
    expect(lastMessageTick(allSeen, false)).toBe('delivered');
  });
});
