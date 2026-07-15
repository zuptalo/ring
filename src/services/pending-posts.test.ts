/**
 * Spec 2036 — startup recovery must not fight the resumed upload.
 *
 * Since spec 1024 every composer item carries inline bytes, so a leftover
 * 'uploading' record is fully resumable by the drain. The reported zombie-draft
 * bug: recovery flipped such a record to 'interrupted' while the WS-online
 * drain was re-uploading it, and its late write resurrected the row after the
 * successful post had deleted it — a posted video PLUS a stale "Post didn't
 * finish" card. These tests pin the new recovery rules against a mocked outbox.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Item {
  bytes?: Uint8Array;
  blob?: unknown;
  kind: string;
  mime?: string;
  progress?: number;
}
interface Rec {
  id: string;
  status: string;
  body?: string;
  items: Item[];
  attempts: number;
  error?: string;
}

const H = vi.hoisted(() => ({
  outbox: new Map<string, Rec>(),
  posts: new Set<string>(),
  // Simulates a concurrent upload completing (deleting the row) exactly at the
  // recovery's re-read — the FR-002 race window.
  deleteOnNextGet: new Set<string>(),
}));

vi.mock('@/db/queries', () => ({
  createPost: vi.fn(async () => ({ id: 'p' })),
  listPendingPosts: async () => [...H.outbox.values()].map((r) => ({ ...r, items: [...r.items] })),
  getPendingPost: async (id: string) => {
    if (H.deleteOnNextGet.delete(id)) {
      H.outbox.delete(id);
      return undefined;
    }
    const r = H.outbox.get(id);
    return r ? { ...r, items: [...r.items] } : undefined;
  },
  getPost: async (id: string) => (H.posts.has(id) ? { id } : undefined),
  updatePendingPost: async (rec: Rec) => {
    H.outbox.set(rec.id, { ...rec, items: [...rec.items] });
  },
  deletePendingPost: async (id: string) => {
    H.outbox.delete(id);
  },
}));

import { recoverInterruptedPosts, __resetRecoveryForTest } from './pending-posts';

const bytes = () => new Uint8Array([1, 2, 3]);

beforeEach(() => {
  H.outbox.clear();
  H.posts.clear();
  H.deleteOnNextGet.clear();
  __resetRecoveryForTest();
});

describe('recoverInterruptedPosts (spec 2036)', () => {
  it('leaves fully byte-backed uploading records alone (the drain resumes them)', async () => {
    H.outbox.set('a', { id: 'a', status: 'uploading', body: 'hi', attempts: 1, items: [{ kind: 'video', bytes: bytes() }] });
    const res = await recoverInterruptedPosts();
    expect(res).toEqual({ recovered: 0, discarded: 0 });
    expect(H.outbox.get('a')?.status).toBe('uploading'); // untouched
  });

  it('cleans up a leftover whose real post already exists', async () => {
    H.outbox.set('a', { id: 'a', status: 'uploading', attempts: 1, items: [{ kind: 'video', bytes: bytes() }] });
    H.posts.add('a');
    await recoverInterruptedPosts();
    expect(H.outbox.has('a')).toBe(false);
  });

  it('drafts only records with unresumable legacy items, keeping what survives', async () => {
    H.outbox.set('a', {
      id: 'a',
      status: 'uploading',
      body: 'caption',
      attempts: 2,
      items: [{ kind: 'image', blob: {} }, { kind: 'voice', bytes: bytes() }],
    });
    const res = await recoverInterruptedPosts();
    expect(res.recovered).toBe(1);
    const rec = H.outbox.get('a');
    expect(rec?.status).toBe('interrupted');
    expect(rec?.items).toHaveLength(1); // the legacy blob item was dropped
    expect(rec?.attempts).toBe(0);
  });

  it('discards a legacy-media-only record with no caption', async () => {
    H.outbox.set('a', { id: 'a', status: 'uploading', attempts: 1, items: [{ kind: 'image', blob: {} }] });
    const res = await recoverInterruptedPosts();
    expect(res.discarded).toBe(1);
    expect(H.outbox.has('a')).toBe(false);
  });

  it('never resurrects a record that completed after the list snapshot (FR-002)', async () => {
    // A legacy-item record that a concurrent upload finishes (deletes) between
    // the recovery's list read and its write: patch getPendingPost to simulate
    // the deletion happening mid-pass.
    H.outbox.set('a', {
      id: 'a',
      status: 'uploading',
      body: 'caption',
      attempts: 1,
      items: [{ kind: 'image', blob: {} }],
    });
    H.deleteOnNextGet.add('a'); // the upload completes right at the re-read
    await recoverInterruptedPosts();
    expect(H.outbox.has('a')).toBe(false); // stayed deleted — no zombie draft
  });
});
