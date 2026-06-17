import { describe, it, expect } from 'vitest';
import { migrateMessageToV6 } from './idb';

// The DB_VERSION 5→6 forward transform (spec 1010): read → seen on every stored
// message. Tested as a pure function (no IndexedDB needed); the onupgradeneeded
// cursor applies it inside the versionchange transaction, so a throw here aborts
// the whole upgrade atomically (data intact at v5, retried next open).

describe('migrateMessageToV6 (read → seen forward migration)', () => {
  it('maps a 1:1 message status read→seen and readAt→seenAt, preserving all else', () => {
    const row = {
      id: 'm1',
      chatId: 'c1',
      senderId: 'me',
      body: 'hi',
      kind: 'text',
      status: 'read',
      timestamp: 1000,
      sentAt: 1001,
      deliveredAt: 1002,
      readAt: 1003,
      outgoing: true,
      updatedAt: 2000,
    };
    const out = migrateMessageToV6(row)!;
    expect(out.status).toBe('seen');
    expect(out.seenAt).toBe(1003);
    expect('readAt' in out).toBe(false);
    // Everything else is preserved untouched.
    expect(out.deliveredAt).toBe(1002);
    expect(out.sentAt).toBe(1001);
    expect(out.body).toBe('hi');
    expect(out.timestamp).toBe(1000);
    expect(out.updatedAt).toBe(2000);
  });

  it('maps each receipts[].readAt→seenAt on a group message', () => {
    const row = {
      id: 'g1',
      status: 'read',
      receipts: [
        { contactId: 'a', deliveredAt: 10, readAt: 20 },
        { contactId: 'b', deliveredAt: 11 },
        { contactId: 'c', deliveredAt: 12, readAt: 22 },
      ],
      readAt: 22,
    };
    const out = migrateMessageToV6(row)!;
    expect(out.status).toBe('seen');
    expect(out.seenAt).toBe(22);
    const recs = out.receipts as Array<Record<string, unknown>>;
    expect(recs[0]).toEqual({ contactId: 'a', deliveredAt: 10, seenAt: 20 });
    expect(recs[1]).toEqual({ contactId: 'b', deliveredAt: 11 }); // no read → unchanged
    expect(recs[2]).toEqual({ contactId: 'c', deliveredAt: 12, seenAt: 22 });
    expect(recs.every((r) => !('readAt' in r))).toBe(true);
  });

  it('does not regress status: a delivered/sent/pending message is left as-is (null)', () => {
    expect(migrateMessageToV6({ id: 'm', status: 'delivered', deliveredAt: 5 })).toBeNull();
    expect(migrateMessageToV6({ id: 'm', status: 'sent', sentAt: 5 })).toBeNull();
    expect(migrateMessageToV6({ id: 'm', status: 'pending' })).toBeNull();
  });

  it('is idempotent: an already-migrated (seen) row needs no rewrite (null)', () => {
    expect(
      migrateMessageToV6({ id: 'm', status: 'seen', seenAt: 30, receipts: [{ contactId: 'a', seenAt: 30 }] }),
    ).toBeNull();
  });

  it('migrates a group row whose status is not "read" but whose receipts still carry readAt', () => {
    // e.g. an outgoing group message still at 'delivered' with one member's readAt set.
    const out = migrateMessageToV6({
      id: 'g',
      status: 'delivered',
      receipts: [{ contactId: 'a', deliveredAt: 10, readAt: 20 }, { contactId: 'b', deliveredAt: 11 }],
    })!;
    expect(out.status).toBe('delivered'); // unchanged
    expect((out.receipts as Array<Record<string, unknown>>)[0]).toEqual({
      contactId: 'a',
      deliveredAt: 10,
      seenAt: 20,
    });
  });

  it('never mutates the input row (so an aborted upgrade leaves data intact)', () => {
    const row = { id: 'm', status: 'read', readAt: 5, receipts: [{ contactId: 'a', readAt: 9 }] };
    const snapshot = JSON.parse(JSON.stringify(row));
    migrateMessageToV6(row);
    expect(row).toEqual(snapshot); // input object untouched
  });

  it('handles malformed / empty input without throwing', () => {
    expect(migrateMessageToV6(null)).toBeNull();
    expect(migrateMessageToV6(undefined)).toBeNull();
    expect(migrateMessageToV6({})).toBeNull();
  });
});
