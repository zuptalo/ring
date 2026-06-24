/**
 * In-memory cache of fetched Noto Lottie animation data, keyed by emoji codepoints (spec 1017).
 *
 * A given codepoint's animation is immutable and served from our own first-party proxy
 * (`/v1/emoji/{codepoints}/lottie.json`), so once fetched it is reused for the rest of the session
 * — no repeat network request as the emoji scrolls in/out of view or shows up in another chat.
 * Concurrent requests for the same codepoints are de-duped. A bounded LRU cap keeps memory in
 * check. Cross-SESSION persistence is handled separately by the service worker's runtime cache for
 * `/v1/emoji/*`; this layer is the fast same-session path.
 *
 * Pure-ish and unit-testable: it only depends on `fetch`, which tests can stub.
 */

const MAX_ENTRIES = 256;

// Value is the parsed Lottie object, or `null` to NEGATIVE-cache "this emoji has no animation"
// (a 404) so we don't refetch a known-missing glyph every time. A transient network error is NOT
// cached, so it can be retried later.
const cache = new Map<string, unknown | null>();
const inflight = new Map<string, Promise<unknown | null>>();

function remember(key: string, value: unknown | null): void {
  cache.delete(key); // re-insert so it becomes most-recently-used
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value; // Map preserves insertion order → oldest first
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * Fetch (or return the cached) Lottie animation data for an emoji's codepoints. Resolves to the
 * parsed animation object, or `null` when there is no animation (404) or the fetch failed — the
 * caller falls back to the native glyph. De-dupes concurrent loads of the same codepoints.
 */
export async function loadEmojiLottie(codepoints: string): Promise<unknown | null> {
  if (cache.has(codepoints)) return cache.get(codepoints) ?? null;
  const pending = inflight.get(codepoints);
  if (pending) return pending;

  const p = (async (): Promise<unknown | null> => {
    try {
      const res = await fetch(`/v1/emoji/${codepoints}/lottie.json`);
      if (!res.ok) {
        remember(codepoints, null); // known-missing → negative cache (don't refetch the 404)
        return null;
      }
      const data = await res.json();
      remember(codepoints, data);
      return data;
    } catch {
      return null; // transient error: do NOT cache, so a later view can retry
    } finally {
      inflight.delete(codepoints);
    }
  })();
  inflight.set(codepoints, p);
  return p;
}

/** Test/maintenance helper: drop the in-memory cache (does not touch the service-worker cache). */
export function clearEmojiCache(): void {
  cache.clear();
  inflight.clear();
}

/** Test introspection: number of cached codepoints (including negative entries). */
export function emojiCacheSize(): number {
  return cache.size;
}
