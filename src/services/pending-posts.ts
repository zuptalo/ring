/**
 * Spec 1024 — the resilient-posting upload worker.
 *
 * Drains the `pendingPosts` outbox: for each pending post it runs the normal {@link createPost}
 * pipeline (encode → upload → seal → send) off its CACHED blobs, writing per-item progress back so
 * the Wall's pending card animates. On success the real Post is written by createPost and the
 * pending record (+ its cached blobs) is dropped; on failure the record flips to `failed` and is
 * retained for retry. The composer dismisses BEFORE this runs — that's the whole point.
 *
 * One drain at a time (a simple in-process guard); the post itself is processed sequentially so
 * bandwidth + progress stay predictable. Resume is just "drain again": an `uploading` record that
 * was interrupted is picked up on the next kick (app start / reconnect).
 */
import {
  createPost,
  listPendingPosts,
  getPendingPost,
  getPost,
  updatePendingPost,
  deletePendingPost,
} from '@/db/queries';

let draining = false;

/** Fire-and-forget kick — safe to call repeatedly (enqueue, app start, reconnect). */
export function kickPendingPosts(): void {
  void drainPendingPosts();
}

/** Process every `uploading` pending post once, sequentially. */
export async function drainPendingPosts(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const queue = (await listPendingPosts()).filter((p) => p.status === 'uploading');
    for (const rec of queue) await uploadOne(rec.id);
  } finally {
    draining = false;
  }
}

const lastProgressWrite = new Map<string, number>();

async function uploadOne(id: string): Promise<void> {
  const rec = await getPendingPost(id);
  if (!rec || rec.status !== 'uploading') return; // canceled / already gone
  rec.attempts += 1;
  await updatePendingPost(rec);
  try {
    await createPost({
      // Pass the outbox record's id as the post id so a retry is idempotent: createPost overwrites
      // the same local Post instead of minting a second one. (See the "already made" guard below for
      // the kill-after-send window the stable id alone can't cover.)
      id,
      body: rec.body || undefined,
      audience: rec.audience ?? 'friends',
      lifetime: rec.lifetime ?? '72h',
      media: rec.items.length
        ? rec.items.map((it) => ({
            blob: it.blob,
            kind: it.kind,
            name: it.name,
            durationSec: it.durationSec,
            quality: 'hd' as const,
          }))
        : undefined,
      onProgress: (p) => {
        void writeProgress(id, p);
      },
    });
    // createPost wrote the real Post (createdAt = confirmation time) → drop the outbox record + blobs.
    await deletePendingPost(id);
    lastProgressWrite.delete(id);
  } catch (err) {
    // If the app was killed AFTER the post was already sent but BEFORE we cleaned up, the retry's
    // server insert collides on the (now-existing) post id. The local Post is present, so this isn't
    // a real failure — treat it as success and clear the outbox quietly rather than flash "failed".
    if (await getPost(id)) {
      await deletePendingPost(id);
      lastProgressWrite.delete(id);
      return;
    }
    const cur = await getPendingPost(id);
    if (cur && cur.status === 'uploading') {
      cur.status = 'failed';
      cur.error = friendlyError(err);
      await updatePendingPost(cur);
    }
  }
}

/** Map a raw upload error to a short, user-facing reason for the pending card. */
function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/quota|storage|exceeded|QuotaExceeded/i.test(msg) || (err as { name?: string })?.name === 'QuotaExceededError') {
    return 'Not enough storage — free up space and retry.';
  }
  if (/network|fetch|offline|timeout|Failed to fetch/i.test(msg)) {
    return "Couldn't reach the server — check your connection and retry.";
  }
  return 'Upload failed — tap retry.';
}

/** Re-arm a failed post for another drain pass (user tapped Retry). */
export async function retryPendingPost(id: string): Promise<void> {
  const rec = await getPendingPost(id);
  if (!rec) return;
  rec.status = 'uploading';
  rec.error = undefined;
  await updatePendingPost(rec);
  kickPendingPosts();
}

/** Drop a pending post for good — discards its cached blobs (user tapped Cancel). */
export async function cancelPendingPost(id: string): Promise<void> {
  await deletePendingPost(id);
  lastProgressWrite.delete(id);
}

// Throttle the per-item progress writes (~6×/s) so the change-bus + IDB don't thrash during encode.
async function writeProgress(
  id: string,
  p: { phase: 'encoding' | 'uploading'; index: number; total: number; value: number },
): Promise<void> {
  const t = Date.now();
  if (p.value < 1 && (lastProgressWrite.get(id) ?? 0) > t - 150) return;
  lastProgressWrite.set(id, t);
  const rec = await getPendingPost(id);
  if (!rec || rec.status !== 'uploading' || !rec.items[p.index]) return;
  // encode is the first half of an item, upload the second half.
  rec.items[p.index].progress = p.phase === 'encoding' ? p.value * 0.5 : 0.5 + p.value * 0.5;
  await updatePendingPost(rec);
}
