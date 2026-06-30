/**
 * Spec 1024 (US3) — a lightweight, best-effort on-device storage check.
 *
 * Before we cache a post's media into the `pendingPosts` outbox (which holds plaintext blobs until
 * the upload confirms), we sanity-check there's headroom. We need MORE than the raw bytes: the
 * outbox copy, the encode scratch, and the eventual encrypted media all coexist briefly — so we ask
 * for `bytes × HEADROOM` and never less than a small floor (tiny posts shouldn't trip the guard on a
 * nearly-full disk where the estimate is noisy).
 *
 * This is advisory only. `navigator.storage.estimate()` is heuristic, rounded, and absent on some
 * browsers — when we can't get a reading we DON'T block (returning `true`), because a false "no room"
 * that stops a real post is worse than letting the actual quota error surface and fail the upload.
 */

/** Reserve this multiple of the raw payload to cover the cached copy + encode scratch + sealed output. */
const HEADROOM = 2.5;
/** Never block a post smaller than this — small posts fit even when the estimate looks tight. */
const FLOOR_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Whether there's plausibly room to stage `bytes` of new media on the device.
 * Returns `true` when storage can't be estimated (don't block on missing data).
 */
export async function hasRoomFor(bytes: number): Promise<boolean> {
  if (bytes <= 0) return true;
  const est = await readEstimate();
  if (!est) return true; // unsupported / threw → don't block; let a real quota error surface instead
  const { quota, usage } = est;
  if (!quota) return true; // a 0/undefined quota is meaningless — treat as unknown
  const free = quota - usage;
  return free >= Math.max(bytes * HEADROOM, FLOOR_BYTES);
}

async function readEstimate(): Promise<{ quota: number; usage: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    return { quota, usage };
  } catch {
    return null;
  }
}
