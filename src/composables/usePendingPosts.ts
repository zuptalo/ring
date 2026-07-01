/**
 * Spec 1024 — reactive view of the `pendingPosts` outbox for the Wall's pending cards.
 * Live-queries the store and exposes a small display shape (overall progress + status), so a
 * post that's still uploading shows atop the feed and updates as the worker writes progress.
 */
import { computed, type ComputedRef } from 'vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { listPendingPosts } from '@/db/queries';
import type { OutboxPost } from '@/db/types';

export interface PendingView {
  id: string;
  status: 'uploading' | 'failed' | 'interrupted';
  error?: string;
  count: number; // number of media items
  progress: number; // 0..1 overall (mean of per-item progress)
  body: string;
}

export function usePendingPosts(): { pending: ComputedRef<PendingView[]> } {
  const raw = useLiveQuery(() => listPendingPosts(), ['pendingPosts'], [] as OutboxPost[]);
  const pending = computed<PendingView[]>(() =>
    raw.value
      .filter((p): p is OutboxPost & { status: 'uploading' | 'failed' | 'interrupted' } => p.status !== 'canceled')
      .map((p) => ({
        id: p.id,
        status: p.status,
        error: p.error,
        count: p.items.length,
        progress: p.items.length ? p.items.reduce((s, it) => s + it.progress, 0) / p.items.length : 0,
        body: p.body,
      })),
  );
  return { pending };
}
