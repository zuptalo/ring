// Spec 1032 (T007) — the BroadcastChannel bridge on the idb change bus. The bus is a
// module-level Map, so it never crosses JS contexts: a page useLiveQuery is blind to
// service-worker writes (and tab B is blind to tab A). The bridge posts each store
// name on BroadcastChannel('ring:idb'); a RECEIVED name fires local listeners only
// (never re-broadcast), so two bridged contexts can't echo-loop each other.
//
// Node ≥18 ships BroadcastChannel natively (same-thread instances deliver to each
// other), so the "other context" here is simply a second channel instance.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { put, subscribe } from './idb';

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('idb change-bus BroadcastChannel bridge', () => {
  it('a write posts the store name on ring:idb (what another context would receive)', async () => {
    const rx = new BroadcastChannel('ring:idb');
    const received: unknown[] = [];
    rx.onmessage = (e) => received.push(e.data);
    await put('chats', { id: 'bridge-1', unread: 0 });
    await flush();
    rx.close();
    expect(received).toContain('chats');
  });

  it('a received store name fires local subscribers (the SW→page repaint path)', async () => {
    let fired = 0;
    const unsub = subscribe(['messages'], () => fired++);
    const tx = new BroadcastChannel('ring:idb');
    tx.postMessage('messages'); // simulate the SW's bridge after a drain commit
    await flush();
    tx.close();
    unsub();
    expect(fired).toBeGreaterThan(0);
  });

  it('a received message is NOT re-broadcast (no echo loop)', async () => {
    const spyA = new BroadcastChannel('ring:idb');
    const seen: unknown[] = [];
    spyA.onmessage = (e) => seen.push(e.data);
    const sender = new BroadcastChannel('ring:idb');
    sender.postMessage('contacts');
    await flush();
    // The spy sees the ONE original post; if idb.ts re-broadcast on receive, a second
    // 'contacts' (and then an infinite storm) would appear here.
    expect(seen.filter((d) => d === 'contacts').length).toBe(1);
    spyA.close();
    sender.close();
  });

  it('garbage on the channel is ignored (only known store names fire)', async () => {
    let fired = 0;
    const unsub = subscribe(['chats'], () => fired++);
    const tx = new BroadcastChannel('ring:idb');
    tx.postMessage('not-a-store');
    tx.postMessage({ weird: true });
    await flush();
    tx.close();
    unsub();
    expect(fired).toBe(0);
  });
});
