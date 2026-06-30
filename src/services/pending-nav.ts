import { get, put } from '@/db/idb';
import type { Setting } from '@/db/types';

/**
 * Pending-navigation handshake for cold launches from a notification.
 *
 * On iOS, a fully-closed PWA opened via `clients.openWindow(path)` ignores the path and lands
 * on the app's default tab — so a tapped Wall/notification deep-link was lost. Instead the
 * service worker stashes the target here before opening the window, and the app consumes it
 * once it's unlocked and routes there. A tiny leaf module so both the SW bundle and the app can
 * import it without pulling in heavy deps or creating a cycle.
 */
const KEY = 'sw.pendingNav';
// Only honor a very fresh target: a stale one (a launch that never happened, or a target left
// over from a previous session) must not hijack a later manual open.
const MAX_AGE_MS = 60_000;

/** SW side: stash the tapped notification's target just before opening the window. */
export async function setPendingNav(url: string): Promise<void> {
  await put<Setting<{ url: string; ts: number }>>('settings', { key: KEY, value: { url, ts: Date.now() } });
}

/** App side: read AND clear the stash. Returns the url only if it was set within MAX_AGE_MS. */
export async function takePendingNav(): Promise<string | null> {
  const s = await get<Setting<{ url: string; ts: number } | null>>('settings', KEY);
  const v = s?.value ?? null;
  if (!v) return null;
  await put<Setting<null>>('settings', { key: KEY, value: null });
  return Date.now() - v.ts < MAX_AGE_MS ? v.url : null;
}
