// Spec 1019 (US7/FR-016): a local-only tombstone must block re-sync ingest yet
// never be uploaded (so a Hidden Chats reset doesn't propagate to other devices).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = vi.hoisted(() => ({ m: new Map<string, any>() }));
vi.mock('./idb', () => ({
  get: async (_s: string, key: string) => store.m.get(key),
  getAll: async () => [...store.m.values()],
  put: async (_s: string, row: any) => {
    store.m.set(row.id, row);
  },
  remove: async (_s: string, key: string) => {
    store.m.delete(key);
  },
}));

import {
  recordTombstone, isTombstoned, listTombstones, hasTombstone, clearTombstone,
} from './tombstones';

beforeEach(() => store.m.clear());

describe('tombstones', () => {
  it('a normal tombstone is uploadable and blocks ingest', async () => {
    await recordTombstone('chats', 'c1', 1000);
    expect(await isTombstoned('chats', 'c1', 500)).toBe(true); // covers older record
    expect(await isTombstoned('chats', 'c1', 2000)).toBe(false); // newer record wins
    expect((await listTombstones()).map((t) => t.recordId)).toContain('c1');
  });

  it('a localOnly tombstone blocks ingest but is NEVER uploaded (FR-016)', async () => {
    await recordTombstone('chats', 'hidden1', Number.MAX_SAFE_INTEGER, true);
    // Honored by the ingest block, even against a future updatedAt (permanent block).
    expect(await isTombstoned('chats', 'hidden1', Date.now())).toBe(true);
    // Excluded from the uploadable set → never propagates to the server/other devices.
    expect((await listTombstones()).map((t) => t.recordId)).not.toContain('hidden1');
  });

  // hasTombstone is the directory-mirror guard: a deleted contact must stay deleted
  // even when the directory re-offers it with a NEWER profile timestamp (the peer
  // edited their profile after we deleted them). Unlike isTombstoned, it ignores time.
  it('hasTombstone is timestamp-independent (directory mirror guard)', async () => {
    expect(await hasTombstone('contacts', 'u1')).toBe(false);
    await recordTombstone('contacts', 'u1', 1000);
    expect(await hasTombstone('contacts', 'u1')).toBe(true);
    // A directory record dated AFTER the delete still does not pass the guard,
    // whereas the time-based isTombstoned would (wrongly) let it through.
    expect(await isTombstoned('contacts', 'u1', 5000)).toBe(false);
    expect(await hasTombstone('contacts', 'u1')).toBe(true);
  });

  // clearTombstone lifts the marker so an intentional re-add can restore the record.
  it('clearTombstone removes the marker so a re-add is allowed again', async () => {
    await recordTombstone('contacts', 'u2', 1000);
    expect(await hasTombstone('contacts', 'u2')).toBe(true);
    await clearTombstone('contacts', 'u2');
    expect(await hasTombstone('contacts', 'u2')).toBe(false);
    expect(await isTombstoned('contacts', 'u2', 1)).toBe(false);
  });
});
