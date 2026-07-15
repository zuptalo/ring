/** Spec 2039 — the boot-loop guard's pure rules + the safe-mode drain gate. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isCrashLoop, MAX_CRASHY_BOOTS, inSafeMode, __setSafeModeForTest } from './boot-guard';

const H = vi.hoisted(() => ({ outbox: new Map<string, { id: string; status: string; attempts: number; items: unknown[] }>() }));

vi.mock('@/db/idb', () => ({ get: async () => undefined, put: async () => undefined, remove: async () => undefined }));
vi.mock('@/db/queries', () => ({
  createPost: vi.fn(async () => ({ id: 'p' })),
  listPendingPosts: async () => [...H.outbox.values()],
  getPendingPost: async (id: string) => H.outbox.get(id),
  getPost: async () => undefined,
  updatePendingPost: async (r: never) => {
    H.outbox.set((r as { id: string }).id, r);
  },
  deletePendingPost: async (id: string) => {
    H.outbox.delete(id);
  },
}));

import { kickPendingPosts } from './pending-posts';

beforeEach(() => {
  H.outbox.clear();
  __setSafeModeForTest(false);
});

describe('boot-loop guard (spec 2039)', () => {
  it('trips at the crashy-boot threshold, not before', () => {
    expect(isCrashLoop(0)).toBe(false);
    expect(isCrashLoop(MAX_CRASHY_BOOTS - 1)).toBe(false);
    expect(isCrashLoop(MAX_CRASHY_BOOTS)).toBe(true);
    expect(isCrashLoop(MAX_CRASHY_BOOTS + 5)).toBe(true);
  });

  it('safe mode gates the automatic drain (no upload starts on a safe boot)', async () => {
    const q = await import('@/db/queries');
    H.outbox.set('a', { id: 'a', status: 'uploading', attempts: 0, items: [] });
    __setSafeModeForTest(true);
    expect(inSafeMode()).toBe(true);
    kickPendingPosts();
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(q.createPost)).not.toHaveBeenCalled();
    expect(H.outbox.get('a')?.status).toBe('uploading'); // untouched, waits for a healthy boot
  });
});
