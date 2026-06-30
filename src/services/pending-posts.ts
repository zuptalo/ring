/**
 * Spec 1024 — the resilient-posting upload worker.
 *
 * The composer dismisses the moment you tap Share; this worker finishes the post in the background
 * by running the normal {@link createPost} pipeline (encode → upload → seal → send) off the CACHED
 * blobs, writing per-item progress back so the Wall's pending card animates. On success createPost
 * writes the real Post and the outbox record (+ blobs) is dropped; an in-session failure flips it to
 * `failed` (Retry / Cancel).
 *
 * IMPORTANT: the upload is an IN-SESSION job. We do NOT try to resume it across a full app close — an
 * iOS library File handle doesn't survive a cold start, so a "resumed" upload just stalls forever on
 * unreadable bytes. Instead {@link recoverInterruptedPosts} runs once at startup and turns any
 * leftover post into a draft (caption + in-app voice notes kept; library media dropped to re-add).
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

/** Fire-and-forget kick — safe to call repeatedly (enqueue, in-session Retry). */
export function kickPendingPosts(): void {
  void drainPendingPosts();
}

/** Process every `uploading` pending post, sequentially, until none remain. */
export async function drainPendingPosts(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    // Loop until the outbox is dry: a post enqueued WHILE we were draining (its kick was a no-op
    // because `draining` was set) must still get picked up in the same pass.
    for (;;) {
      const queue = (await listPendingPosts()).filter((p) => p.status === 'uploading');
      if (!queue.length) break;
      for (const rec of queue) await uploadOne(rec.id);
    }
  } finally {
    draining = false;
  }
}

const lastProgressWrite = new Map<string, number>();

// If an upload makes NO progress for this long it's treated as stalled and fails (→ Retry/Cancel),
// rather than spinning at 0% forever and wedging the single-drain worker behind it. A real upload
// reports progress well within this window (encode + the immediate onProgress(0) on upload start);
// only a genuine hang — e.g. reading an unreadable cached blob — goes silent this long.
const UPLOAD_STALL_MS = 45_000;

async function uploadOne(id: string): Promise<void> {
  const rec = await getPendingPost(id);
  if (!rec || rec.status !== 'uploading') return; // canceled / interrupted / already gone
  rec.attempts += 1;
  await updatePendingPost(rec);
  let lastTick = Date.now();
  let watchdog: ReturnType<typeof setInterval> | undefined;
  try {
    const stalled = new Promise<never>((_, reject) => {
      watchdog = setInterval(() => {
        if (Date.now() - lastTick > UPLOAD_STALL_MS) reject(new Error('Upload stalled. Tap Retry to try again.'));
      }, 5_000);
    });
    await Promise.race([
      createPost({
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
          lastTick = Date.now(); // each progress event keeps the watchdog from firing
          void writeProgress(id, p);
        },
      }),
      stalled,
    ]);
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
  } finally {
    clearInterval(watchdog); // stop the stall-watchdog whether we finished, failed, or timed out
  }
}

/** Map a raw upload error to a short, user-facing reason for the pending card. */
function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/quota|storage|exceeded|QuotaExceeded/i.test(msg) || (err as { name?: string })?.name === 'QuotaExceededError') {
    return 'Not enough storage. Free up space and try again.';
  }
  if (/network|fetch|offline|timeout|Failed to fetch/i.test(msg)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (/stalled/i.test(msg)) {
    return 'Upload stalled. Tap Retry to try again.';
  }
  return 'Upload failed. Tap Retry to try again.';
}

/** Re-arm a failed post for another drain pass (user tapped Retry). Resets the attempt budget so a
 *  post that exhausted its auto-retries gets a fresh start instead of failing instantly. */
export async function retryPendingPost(id: string): Promise<void> {
  const rec = await getPendingPost(id);
  if (!rec) return;
  rec.status = 'uploading';
  rec.error = undefined;
  rec.attempts = 0;
  await updatePendingPost(rec);
  kickPendingPosts();
}

/** Drop a pending post for good — discards its cached blobs (user tapped Cancel / Discard). */
export async function cancelPendingPost(id: string): Promise<void> {
  await deletePendingPost(id);
  lastProgressWrite.delete(id);
}

let recovered = false;

/**
 * Run ONCE at app start (after unlock). Any pending post still around is left over from a previous
 * session — its in-flight upload died when the app was fully closed. We can't reliably finish it
 * (library File handles don't survive a cold start), so rather than stall:
 *   • if the upload had actually completed before the app died (the real Post already exists), just
 *     clean the leftover outbox row — no duplicate, no draft;
 *   • else keep the caption + any in-app VOICE recordings (memory-backed → they survive) and flip the
 *     record to `interrupted`, so the Wall offers "Finish" (reopen composer) + re-add the media;
 *   • a post with nothing worth keeping (library media only, no caption) is discarded.
 * Returns counts so the caller can let the user know.
 */
export async function recoverInterruptedPosts(): Promise<{ recovered: number; discarded: number }> {
  if (recovered) return { recovered: 0, discarded: 0 };
  recovered = true;
  let recoveredN = 0;
  let discarded = 0;
  for (const rec of await listPendingPosts()) {
    if (rec.status === 'interrupted' || rec.status === 'canceled') continue;
    if (await getPost(rec.id)) {
      // The upload had actually finished; only the cleanup was lost. Drop the row, keep the post.
      await deletePendingPost(rec.id);
      continue;
    }
    const voice = rec.items.filter((it) => it.kind === 'voice');
    const droppedMedia = rec.items.some((it) => it.kind !== 'voice');
    if (rec.body?.trim() || voice.length) {
      rec.items = voice; // keep in-app recordings; library photos/videos can't be re-read → drop them
      rec.status = 'interrupted';
      rec.error = undefined;
      rec.droppedMedia = droppedMedia;
      rec.attempts = 0;
      await updatePendingPost(rec);
      recoveredN += 1;
    } else {
      await deletePendingPost(rec.id); // pure library-media post with no caption — nothing to keep
      discarded += 1;
    }
    lastProgressWrite.delete(rec.id);
  }
  return { recovered: recoveredN, discarded };
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
