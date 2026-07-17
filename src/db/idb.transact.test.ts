// Spec 1032 (T005) — the atomic multi-store transaction helper that makes the SW's
// per-frame commit all-or-nothing: the advanced ratchet session, the message row,
// the chat read-modify-write, and the exactly-once ledger mark either ALL land or
// NONE do. Runs against fake-indexeddb (real IDB transaction semantics, in-process),
// because atomicity is exactly the part an in-memory Map mock can't prove.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { transact, get, put, subscribe, type StoreName } from './idb';

// A fresh DB per test file run is enough; per-test we just use distinct keys.
const STORES: StoreName[] = ['sessions', 'messages', 'chats', 'settings'];

interface Row {
  id: string;
  [k: string]: unknown;
}

describe('transact: all-or-nothing commit across stores', () => {
  it('commits writes to every named store in one transaction', async () => {
    await transact(STORES, (tx) => {
      tx.put('sessions', { id: 'c1', rk: 'advanced' });
      tx.put('messages', { id: 'm1', chatId: 'c1', body: 'hi' });
      tx.put('chats', { id: 'c1', unread: 1 });
      tx.put('settings', { key: 'inboundSeenIds', value: ['m1'] });
    });
    expect((await get<Row>('sessions', 'c1'))?.rk).toBe('advanced');
    expect((await get<Row>('messages', 'm1'))?.body).toBe('hi');
    expect((await get<Row>('chats', 'c1'))?.unread).toBe(1);
    expect((await get<{ key: string; value: string[] }>('settings', 'inboundSeenIds'))?.value).toEqual(['m1']);
  });

  it('a throwing callback aborts: zero writes land in ANY store', async () => {
    await put('chats', { id: 'c2', unread: 0 });
    await expect(
      transact(STORES, (tx) => {
        tx.put('messages', { id: 'm2', chatId: 'c2', body: 'lost' });
        tx.put('chats', { id: 'c2', unread: 1 });
        throw new Error('mid-transaction failure');
      }),
    ).rejects.toThrow('mid-transaction failure');
    expect(await get<Row>('messages', 'm2')).toBeUndefined();
    expect((await get<Row>('chats', 'c2'))?.unread).toBe(0); // RMW rolled back
  });

  it('an async callback can read-modify-write within the same transaction', async () => {
    await put('chats', { id: 'c3', unread: 4 });
    await transact(['chats', 'settings'], async (tx) => {
      const chat = await tx.get<Row>('chats', 'c3');
      tx.put('chats', { ...chat, unread: (chat?.unread as number) + 1 });
      const seen = ((await tx.get<{ key: string; value: string[] }>('settings', 'seen-c3'))?.value ?? []) as string[];
      tx.put('settings', { key: 'seen-c3', value: [...seen, 'm3'] });
    });
    expect((await get<Row>('chats', 'c3'))?.unread).toBe(5);
    expect((await get<{ key: string; value: string[] }>('settings', 'seen-c3'))?.value).toEqual(['m3']);
  });

  it('an async throw after a read still aborts everything', async () => {
    await put('chats', { id: 'c4', unread: 7 });
    await expect(
      transact(['chats', 'messages'], async (tx) => {
        const chat = await tx.get<Row>('chats', 'c4');
        tx.put('chats', { ...chat, unread: 8 });
        tx.put('messages', { id: 'm4', chatId: 'c4' });
        throw new Error('late failure');
      }),
    ).rejects.toThrow('late failure');
    expect((await get<Row>('chats', 'c4'))?.unread).toBe(7);
    expect(await get<Row>('messages', 'm4')).toBeUndefined();
  });
});

describe('transact: change-bus notification discipline', () => {
  let fired: string[];
  let unsub: () => void;

  beforeEach(() => {
    fired = [];
    unsub = subscribe(STORES, () => {
      /* per-store capture below */
    });
    unsub();
    const subs = STORES.map((name) => subscribe([name], () => fired.push(name)));
    unsub = () => subs.forEach((u) => u());
  });

  it('fires once per TOUCHED store, only after commit', async () => {
    await transact(STORES, (tx) => {
      tx.put('messages', { id: 'm5', chatId: 'c5' });
      tx.put('chats', { id: 'c5', unread: 1 });
      // sessions + settings deliberately untouched
    });
    expect(fired.sort()).toEqual(['chats', 'messages']);
    unsub();
  });

  it('fires nothing when the transaction aborts', async () => {
    await expect(
      transact(STORES, (tx) => {
        tx.put('messages', { id: 'm6', chatId: 'c6' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(fired).toEqual([]);
    unsub();
  });
});
