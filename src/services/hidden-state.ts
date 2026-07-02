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
    // On a reload the warm chat list can paint before the keystore unlocks, so
    // the first load attempt fails closed (unloaded). Once it finally succeeds,
    // nudge the lists to re-query with the now-known set so any chat that was
    // briefly shown gets excluded. Deferred to a microtask to avoid re-entering
    // the in-flight query. The relock hook runs too: a cold start can deep-link
    // INSIDE a hidden chat before the set decrypts (the router's door guard
    // fails open on an unknown set), and this is the moment the router can
    // finally see it and kick out (spec 1027 FR-009).
    queueMicrotask(() => {
      refreshLists();
      relockHook?.();
    });
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

/**
 * Whether the hidden set is DEFINITIVELY known (a successful load, or no hidden
 * set configured at all — both leave `loaded` true). False means we couldn't
 * decrypt it yet (keystore still locked at open), so callers must NOT trust the
 * empty cache as "nothing hidden": they fail closed until this flips true. The
 * load's success path nudges the lists to re-query (see `ensureHiddenLoaded`), so
 * the fail-closed window lasts only until the keystore unlocks.
 */
export function isHiddenKnown(): boolean {
  return loaded;
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
  // The router's door guard fails open at cold start (the set is unknown when
  // the first navigation resolves), so a deep link can land INSIDE a hidden
  // chat before the set decrypts. Re-run the kick-out check the moment the set
  // is known (and after every mutation — hiding a chat from inside it must
  // close it too). The registered callback ignores active reveal sessions.
  relockHook?.();
}

/** Is a reveal session currently active? */
export function isRevealed(): boolean {
  return revealed;
}

// Fired on every transition INTO the locked state (spec 1027, FR-009). The
// router registers a callback that leaves an open hidden conversation
// immediately — grace expiry, manual relock, keystore auto-lock, or a wipe must
// never leave hidden content on screen. Registered from the router module (this
// leaf imports nothing heavy, and the router importing the leaf keeps the
// dependency direction clean).
let relockHook: (() => void) | null = null;

/** Register the relock callback (router kick-out). Replaces any previous one. */
export function registerRelockHook(fn: () => void): void {
  relockHook = fn;
}

/** Flip the reveal session. Refreshes the lists when it actually changes. */
export function setRevealed(v: boolean): void {
  if (revealed !== v) {
    revealed = v;
    refreshLists();
    if (!v) relockHook?.();
  }
}

/** Drop all in-memory state (on lock / wipe / reset). Always counts as a
 *  relock: even without an active reveal session an open hidden chat (e.g. a
 *  stale deep link) must be left when the keystore locks. */
export function clearHiddenState(): void {
  // Order matters: the relock hook decides the kick-out by testing whether the
  // CURRENT route's id is hidden, so it must run while `ids` still holds the
  // set AND `revealed` is already false (the hook early-returns while revealed).
  // Clearing `ids` first would make `isHiddenId` always false → the kick-out
  // would silently no-op on the keystore-lock/wipe path (spec 1027 FR-009).
  revealed = false;
  relockHook?.();
  ids = new Set();
  loaded = false;
  refreshLists();
}
