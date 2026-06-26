/**
 * Hidden-chats in-memory state (the leaf module).
 *
 * Why this exists separately from `hidden-chats.ts`: the data layer
 * (`queries.ts` → `listChats`, `listCallGroups`) needs to know, synchronously
 * and on every query, which conversation ids are hidden and whether a reveal
 * session is currently active. The full `hidden-chats` service depends on
 * `queries.ts` (for settings/group/delete helpers), so if `queries.ts` imported
 * it back we'd have a cycle. This leaf holds only the in-memory cache + the
 * reveal flag, imports nothing heavy, and gets its decryptor injected by
 * `hidden-chats.ts` at load via `registerHiddenLoader`. The data layer imports
 * only this leaf.
 *
 * Nothing here is persisted — the cache mirrors the at-rest (master-key-wrapped)
 * hidden set, and the reveal flag is deliberately memory-only so a full app
 * close always re-locks (spec FR-005 / SC-009).
 */
import { touch } from '@/db/idb';

let ids = new Set<string>();
let loaded = false;
let revealed = false;
let loader: (() => Promise<Set<string>>) | null = null;

/** Re-run any `useLiveQuery` watching the chat/call lists (no row changed). */
function refreshLists(): void {
  touch('chats');
  touch('calls');
}

/**
 * Injected by `hidden-chats.ts` so this leaf can lazily load the decrypted set
 * without importing the heavy service (avoids a `queries.ts` import cycle).
 */
export function registerHiddenLoader(fn: () => Promise<Set<string>>): void {
  loader = fn;
}

/** Ensure the cache is populated from at-rest storage (once). Safe when locked. */
export async function ensureHiddenLoaded(): Promise<Set<string>> {
  if (loaded) return ids;
  // The decryptor lives in `hidden-chats.ts` (which depends on `queries.ts`). If
  // nothing has imported it yet — e.g. the warm-store path queries chats before
  // any hidden-chats UI mounts — pull it in lazily so the loader is always
  // registered before the first read. A dynamic import keeps the static
  // dependency graph acyclic (data layer → this leaf only).
  if (!loader) {
    try {
      await import('@/services/hidden-chats');
    } catch {
      /* best-effort registration */
    }
  }
  if (!loader) return ids; // still none → stay unloaded, retry on next call
  try {
    ids = await loader();
    loaded = true; // cache only on a successful decrypt — see below
  } catch {
    // Locked / corrupt: do NOT mark loaded (so we retry once unlocked) and keep
    // the last-known set rather than an empty one. This fails closed — a
    // transient decrypt failure never reveals a previously-hidden chat.
  }
  return ids;
}

/** Synchronous read of the current cached hidden-id set. */
export function hiddenIdsSync(): Set<string> {
  return ids;
}

/** True if `id` is currently hidden (per the cache). */
export function isHiddenId(id: string): boolean {
  return ids.has(id);
}

/** Replace the cache (called by the service after a mutation/load). */
export function setHiddenIdsCache(next: Iterable<string>): void {
  ids = new Set(next);
  loaded = true;
  refreshLists();
}

/** Is a reveal session currently active? */
export function isRevealed(): boolean {
  return revealed;
}

/** Flip the reveal session. Refreshes the lists when it actually changes. */
export function setRevealed(v: boolean): void {
  if (revealed !== v) {
    revealed = v;
    refreshLists();
  }
}

/** Drop all in-memory state (on lock / wipe / reset). */
export function clearHiddenState(): void {
  ids = new Set();
  loaded = false;
  revealed = false;
  refreshLists();
}
