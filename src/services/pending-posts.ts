/**
 * Spec 1024 — the resilient-posting upload worker.
 *
 * The composer dismisses the moment you tap Share; this worker finishes the post in the background
 * by running the normal {@link createPost} pipeline (encode → upload → seal → send) off the CACHED
 * blobs, writing per-item progress back so the Wall's pending card animates. On success createPost
 * writes the real Post and the outbox record (+ blobs) is dropped; an in-session failure flips it to
 * `failed` (Retry / Cancel).
 *
 * Uploads RESUME across a full app close (spec 2036): every item's bytes ride
 * inline in the outbox record, so a leftover 'uploading' post is finished by
 * the next session's drain from a fresh in-memory Blob. (The pre-1024 design
 * couldn't do this — an iOS library File handle doesn't survive a cold start —
 * which is why {@link recoverInterruptedPosts} used to draft-ify everything; it
 * now only drafts legacy records whose items lack inline bytes.)
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

// (spec 2036) Tombstones for outbox rows this module has deleted. writeProgress is
// fired DETACHED from upload callbacks; one in flight across the moment of
// deletion would re-put the row it read earlier — resurrecting the record as
// 'uploading' and making the drain re-post the same (idempotent, but endless)
// attempt. Ids are never reused, so the set only ever grows by one per post.
const dropped = new Set<string>();

/** Delete an outbox row for good: tombstone first so no in-flight progress write
 *  can resurrect it, then remove the record + throttle state. */
async function dropPendingPost(id: string): Promise<void> {
  dropped.add(id);
  await deletePendingPost(id);
  lastProgressWrite.delete(id);
}

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
  let attempt: Promise<unknown> | undefined;
  try {
    const stalled = new Promise<never>((_, reject) => {
      watchdog = setInterval(() => {
        if (Date.now() - lastTick > UPLOAD_STALL_MS) reject(new Error('Upload stalled. Tap Retry to try again.'));
      }, 5_000);
    });
    attempt = createPost({
        // Pass the outbox record's id as the post id so a retry is idempotent: createPost overwrites
        // the same local Post instead of minting a second one. (See the "already made" guard below for
        // the kill-after-send window the stable id alone can't cover.)
        id,
        body: rec.body || undefined,
        audience: rec.audience ?? 'friends',
        lifetime: rec.lifetime ?? '72h',
        media: rec.items.length
          ? rec.items.map((it) => ({
              // Rebuild a fresh in-memory Blob from the inline bytes (always readable, unlike a Blob
              // read back from IDB after a restart). Fall back to a legacy stored Blob if present.
              blob: it.bytes ? new Blob([it.bytes], { type: it.mime }) : (it.blob as Blob),
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
      });
    await Promise.race([attempt, stalled]);
    // createPost wrote the real Post (createdAt = confirmation time) → drop the outbox record + blobs.
    await dropPendingPost(id);
  } catch (err) {
    // (spec 2036) Losing the stall race does NOT cancel createPost — it has no
    // cancellation seam and may very well still finish (the watchdog fired
    // during a long poster/seal step, not a real hang). If the detached attempt
    // eventually succeeds, heal the outbox row so the posted result never sits
    // under a stale 'failed' card — and a concurrent RETRY that collides
    // server-side resolves through the same heal.
    void attempt
      ?.then(async () => {
        await dropPendingPost(id);
      })
      .catch(() => {
        /* the raced-out attempt really failed too — the failed card stands */
      });
    // If the app was killed AFTER the post was already sent but BEFORE we cleaned up, the retry's
    // server insert collides on the (now-existing) post id. The local Post is present, so this isn't
    // a real failure — treat it as success and clear the outbox quietly rather than flash "failed".
    if (await getPost(id)) {
      await dropPendingPost(id);
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
  // "Load failed" is Safari/WebKit's fetch network-failure message (Chromium
  // says "Failed to fetch") — without it an iOS connection drop mid-upload
  // showed the generic "Upload failed" instead of the connection hint.
  if (/network|fetch|offline|timeout|Failed to fetch|Load failed/i.test(msg)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (/stalled/i.test(msg)) {
    return 'Upload stalled. Tap Retry to try again.';
  }
  // Unrecognized failure: KEEP the underlying reason visible. A bare "Upload
  // failed" hides exactly the detail needed to fix a device-specific breakage
  // (e.g. an iOS-only encode/clone error) — the failed card is the only
  // console we have on a phone.
  const detail = msg.length > 120 ? `${msg.slice(0, 117)}…` : msg;
  return detail ? `Upload failed: ${detail} — tap Retry.` : 'Upload failed. Tap Retry to try again.';
}

/** Re-arm a failed post for another drain pass (user tapped Retry). Resets the attempt budget so a
 *  post that exhausted its auto-retries gets a fresh start instead of failing instantly. */
export async function retryPendingPost(id: string): Promise<void> {
  const rec = await getPendingPost(id);
  if (!rec) return;
  dropped.delete(id); // live again — accept progress writes
  rec.status = 'uploading';
  rec.error = undefined;
  rec.attempts = 0;
  await updatePendingPost(rec);
  kickPendingPosts();
}

/** Drop a pending post for good — discards its cached blobs (user tapped Cancel / Discard). */
export async function cancelPendingPost(id: string): Promise<void> {
  await dropPendingPost(id);
}

let recovered = false;

/** Test-only: allow the once-per-session recovery to run again in vitest. */
export function __resetRecoveryForTest(): void {
  recovered = false;
}

/**
 * Run ONCE at app start (after unlock). A pending post still around is left over
 * from a previous session. Since spec 1024 every item's bytes ride INLINE in the
 * record, a leftover 'uploading' post is fully RESUMABLE — the drain rebuilds
 * fresh Blobs and finishes it — so recovery deliberately leaves those alone
 * (spec 2036: it used to flip them to 'interrupted' while the WS-online drain
 * was already re-uploading the same record, and its late write resurrected the
 * row as a zombie draft AFTER the successful post deleted it). Recovery now only:
 *   • cleans up a leftover whose real Post already exists (cleanup was lost);
 *   • drafts records with genuinely unresumable LEGACY items (a stored Blob and
 *     no bytes — unreadable after a restart), keeping caption + byte-backed items;
 *   • discards records with nothing readable to keep;
 *   • kicks the drain for the resumable ones it left behind (the unlock can
 *     come after the WS-online kick already ran and found the keys locked).
 * Every write is re-checked against the record's CURRENT state so a racing
 * completed upload can never be resurrected (FR-002).
 * Returns counts so the caller can let the user know.
 */
export async function recoverInterruptedPosts(): Promise<{ recovered: number; discarded: number }> {
  if (recovered) return { recovered: 0, discarded: 0 };
  recovered = true;
  let recoveredN = 0;
  let discarded = 0;
  let resumable = 0;
  for (const rec of await listPendingPosts()) {
    if (rec.status === 'interrupted' || rec.status === 'canceled') continue;
    if (await getPost(rec.id)) {
      // The upload had actually finished; only the cleanup was lost. Drop the row, keep the post.
      await deletePendingPost(rec.id);
      continue;
    }
    if (rec.items.every((it) => !!it.bytes)) {
      // Fully byte-backed (every post the current composer creates): the drain
      // resumes it as-is. Don't touch the record — two writers on one row was
      // exactly the reported zombie-draft bug.
      resumable += 1;
      continue;
    }
    // Legacy items without inline bytes can't be re-read after a restart: draft
    // what survives (caption + byte-backed items) for the user to finish.
    const usable = rec.items.filter((it) => !!it.bytes);
    // FR-002: re-read before writing — the record may have completed (and been
    // deleted) or changed since the list snapshot; never write over that.
    const fresh = await getPendingPost(rec.id);
    if (!fresh || fresh.status !== rec.status) continue;
    if (rec.body?.trim() || usable.length) {
      fresh.items = usable;
      fresh.status = 'interrupted';
      fresh.error = undefined;
      fresh.attempts = 0;
      await updatePendingPost(fresh);
      recoveredN += 1;
    } else {
      await deletePendingPost(rec.id); // nothing readable to keep
      discarded += 1;
    }
    lastProgressWrite.delete(rec.id);
  }
  if (resumable > 0) kickPendingPosts(); // finish them now if the keys are already unlocked
  return { recovered: recoveredN, discarded };
}

// Throttle the per-item progress writes (~6×/s) so the change-bus + IDB don't thrash during encode.
async function writeProgress(
  id: string,
  p: { phase: 'encoding' | 'uploading'; index: number; total: number; value: number },
): Promise<void> {
  const t = Date.now();
  if (dropped.has(id)) return; // the row is gone for good — never resurrect it
  if (p.value < 1 && (lastProgressWrite.get(id) ?? 0) > t - 150) return;
  lastProgressWrite.set(id, t);
  const rec = await getPendingPost(id);
  if (dropped.has(id)) return; // deleted while we read — the put below would resurrect
  if (!rec || rec.status !== 'uploading' || !rec.items[p.index]) return;
  // encode is the first half of an item, upload the second half. High-water mark:
  // an engine fallback (WebCodecs → ffmpeg) restarts the encode band from 0, and
  // a bar that winds BACKWARDS reads as a broken upload — never regress it.
  const next = p.phase === 'encoding' ? p.value * 0.5 : 0.5 + p.value * 0.5;
  rec.items[p.index].progress = Math.max(rec.items[p.index].progress ?? 0, next);
  await updatePendingPost(rec);
}
