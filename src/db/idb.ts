/**
 * Minimal promise-based IndexedDB wrapper with a change-notification bus.
 * No external dependencies. The bus is what makes queries reactive: any write
 * notifies subscribers of the affected store, and `useLiveQuery` re-runs.
 */

export const STORES = [
  'contacts',
  'chats',
  'messages',
  'calls',
  'media',
  'settings',
  'requests',
  'alerts',
  // E2EE + sync stores (added in DB v4). keyPath 'id' for all.
  'keystore', // identity keys + master key, wrapped at rest
  'prekeys', // one-time prekey usage tracking
  'sessions', // Double Ratchet session state, per chat
  'senderkeys', // group sender-key state
  'outbox', // durable queue of local writes awaiting push
  'tombstones', // soft-delete markers so pull can't resurrect rows
  // v5: user-defined chat filter lists (Chats-tab "lists").
  'chatlists',
  // v9 (spec 0003): the social Wall. `posts` = received/own posts; `postEngagement`
  // = reactions/comments/view-receipts keyed by postId. Both keyPath 'id'.
  'posts',
  'postEngagement',
  // v10 (spec 1024): the resilient-posting outbox — pending posts/chat-media with cached blobs.
  'pendingPosts',
  // v11: per-chat composer drafts (unsent text + caret + reply) so leaving/closing keeps your place.
  'drafts',
  // v12: staged (unsent) chat attachments for a draft — bytes stored inline so they survive a reload.
  'draftMedia',
] as const;
export type StoreName = (typeof STORES)[number];

const DB_NAME = 'ring';
// v8 (spec 1014): the Media record gains optional `posterGrid`/`posterStrip` thumbnail tiers. These
// are additive optional Blob fields on existing records — IndexedDB needs no per-row transform for
// that, so the version bump alone (which documents the schema evolution) is the whole migration;
// existing rows are preserved unchanged and the tiers are filled in by the background backfill.
// v9 (spec 0003): add the social-Wall stores `posts` + `postEngagement` (additive
// createObjectStore in onupgradeneeded; existing data untouched).
// v10 (spec 1024): add the `pendingPosts` outbox store (additive; existing data untouched).
const DB_VERSION = 12;

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Pure forward transform for the v5→v6 "read → seen" rename (spec 1010): a stored
 * message row gets `status 'read'→'seen'`, the scalar `readAt→seenAt`, and each
 * `receipts[].readAt→seenAt`. Every other field is preserved and status never
 * regresses ('read' and 'seen' share the same rank). Returns a NEW row when it
 * changed anything, or `null` when the row already speaks "seen" (so the migration
 * skips a needless write) — never mutates the input. Exported so it's unit-tested
 * without an IndexedDB (see idb.migration.test.ts); the onupgradeneeded cursor
 * below applies it inside the versionchange transaction.
 */
export function migrateMessageToV6(
  row: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null;
  let changed = false;
  const next: Record<string, unknown> = { ...row };

  if (row.status === 'read') {
    next.status = 'seen';
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(row, 'readAt')) {
    if (row.readAt !== undefined) next.seenAt = row.readAt;
    delete next.readAt;
    changed = true;
  }
  if (Array.isArray(row.receipts)) {
    let recChanged = false;
    const recs = (row.receipts as Array<Record<string, unknown>>).map((r) => {
      if (r && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, 'readAt')) {
        recChanged = true;
        const nr: Record<string, unknown> = { ...r };
        if (r.readAt !== undefined) nr.seenAt = r.readAt;
        delete nr.readAt;
        return nr;
      }
      return r;
    });
    if (recChanged) {
      next.receipts = recs;
      changed = true;
    }
  }
  return changed ? next : null;
}

/**
 * Pure forward transform for the v6→v7 backfill (spec 1013). Visibility-driven "Seen" tracks,
 * per INCOMING message, whether this device has reported it Seen (`seenReportedAt`). On upgrade we
 * treat the pre-feature backlog as already reported — stamping each incoming message's
 * `seenReportedAt` with its own `timestamp` — so the not-yet-Seen pill starts at 0 and the client
 * doesn't re-emit Seen for history; new (post-upgrade) incoming messages arrive without the field
 * and get the visibility-driven trigger. Returns a NEW row when it stamps one, or `null` when
 * there's nothing to do (outgoing/own, already stamped, or no numeric timestamp) so the migration
 * skips a needless write — never mutates the input. Exported for unit testing without IndexedDB
 * (idb.migration.test.ts); the onupgradeneeded cursor applies it in the versionchange transaction.
 */
export function migrateMessageToV7(
  row: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null;
  if (row.outgoing === true || row.senderId === 'me') return null; // outgoing/own never carry it
  if (Object.prototype.hasOwnProperty.call(row, 'seenReportedAt') && row.seenReportedAt !== undefined)
    return null; // already reported → idempotent
  if (typeof row.timestamp !== 'number') return null; // nothing sensible to stamp
  return { ...row, seenReportedAt: row.timestamp };
}

// iOS 16.x WebKit has a long-standing bug where `indexedDB.open()` in a
// SERVICE-WORKER context can hang forever — no success, error, OR blocked event
// ever fires (it works on iOS 17+). A push handler that awaits any IDB call then
// stalls until the platform kills the event, showing nothing and getting the
// subscription penalized. The fix is the documented workaround: bound each open
// with a timeout and retry — a warmed-up second attempt typically succeeds where
// the cold first one hung. If every attempt fails, fail FAST (and briefly cache
// that) so callers fall back to a generic notification promptly instead of
// piling up multi-second retries. The main app (iOS 17+, desktop) opens on the
// first try in <100ms, so none of this timing is ever exercised there.
const OPEN_TIMEOUT_MS = 1000; // a real open is <100ms; only a genuine hang reaches this
const OPEN_ATTEMPTS = 3;
const OPEN_RETRY_DELAY_MS = 200;
const OPEN_COOLDOWN_MS = 8000; // after all attempts fail, fail fast for this long
let openCooldownUntil = 0;

/** Apply the schema migrations for a versionchange upgrade. Extracted so the
 *  timeout-guarded open can reuse it verbatim across retries. */
function runUpgrade(req: IDBOpenDBRequest, event: IDBVersionChangeEvent): void {
  const db = req.result;
  if (!db.objectStoreNames.contains('contacts'))
        db.createObjectStore('contacts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chats'))
        db.createObjectStore('chats', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('messages')) {
        const s = db.createObjectStore('messages', { keyPath: 'id' });
        s.createIndex('chatId', 'chatId');
      }
      if (!db.objectStoreNames.contains('calls'))
        db.createObjectStore('calls', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media'))
        db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings'))
        db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('requests'))
        db.createObjectStore('requests', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('alerts'))
        db.createObjectStore('alerts', { keyPath: 'id' });
      // v4: E2EE + sync stores (all keyPath 'id').
      for (const name of ['keystore', 'prekeys', 'sessions', 'senderkeys', 'outbox', 'tombstones']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      // v5: user-defined chat filter lists.
      if (!db.objectStoreNames.contains('chatlists'))
        db.createObjectStore('chatlists', { keyPath: 'id' });
      // v9 (spec 0003): social-Wall stores. `postEngagement` indexes by postId so a
      // post's reactions/comments/views can be read in one range query.
      if (!db.objectStoreNames.contains('posts'))
        db.createObjectStore('posts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('postEngagement')) {
        const s = db.createObjectStore('postEngagement', { keyPath: 'id' });
        s.createIndex('postId', 'postId');
      }
      // v10 (spec 1024): the resilient-posting OUTBOX — pending Wall posts / chat media sends with
      // their own cached working blobs, drained by the upload worker. Named `pendingPosts` to avoid
      // the existing message-sync `outbox` store above.
      if (!db.objectStoreNames.contains('pendingPosts'))
        db.createObjectStore('pendingPosts', { keyPath: 'id' });
      // v11: per-chat composer drafts, keyed by chatId, so an unsent message (text + caret + reply)
      // is restored when you re-open the chat or relaunch the app. Local-only — never synced.
      if (!db.objectStoreNames.contains('drafts'))
        db.createObjectStore('drafts', { keyPath: 'chatId' });
      // v12: staged attachments for a chat draft, keyed by chatId. Bytes are stored inline (not as
      // Blobs) so they read back after a reload on iOS; rebuilt into fresh in-memory files on restore.
      if (!db.objectStoreNames.contains('draftMedia'))
        db.createObjectStore('draftMedia', { keyPath: 'chatId' });
      // Forward message migrations (v6: spec 1010 "read"→"seen" rename; v7: spec 1013
      // seen-reported backfill). They run in ONE cursor pass so a multi-version upgrade
      // (e.g. v5→v7) does not open two racing cursors on the same store that could clobber
      // each other's writes: each applicable transform is applied in order to a row (v6 then
      // v7, so v7 sees the renamed row), then a single update. No-op on a fresh DB (the store
      // was just created empty). Any cursor/update error bubbles to the versionchange
      // transaction, which aborts the whole upgrade atomically — existing message data is left
      // intact at the old version and retried on the next open, never partially migrated.
      const needV6 = event.oldVersion > 0 && event.oldVersion < 6; // spec 1010 rename
      const needV7 = event.oldVersion > 0 && event.oldVersion < 7; // spec 1013 backfill
      if ((needV6 || needV7) && db.objectStoreNames.contains('messages')) {
        const tx = req.transaction; // the active versionchange transaction
        const cursorReq = tx?.objectStore('messages').openCursor();
        if (cursorReq) {
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            let row = cursor.value as Record<string, unknown>;
            let changed = false;
            if (needV6) {
              const v6 = migrateMessageToV6(row);
              if (v6) {
                row = v6;
                changed = true;
              }
            }
            if (needV7) {
              const v7 = migrateMessageToV7(row);
              if (v7) {
                row = v7;
                changed = true;
              }
            }
            if (changed) cursor.update(row); // an update error aborts the upgrade txn
            cursor.continue();
          };
        }
      }
}

/** One open attempt, bounded by a timeout — a hung `indexedDB.open()` (iOS 16 SW)
 *  rejects at the deadline so {@link openDB} can retry a fresh request. */
function openOnce(timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('indexedDB.open timed out'));
    }, timeoutMs);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    req.onupgradeneeded = (event) => runUpgrade(req, event);
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        // We already timed out and moved to a retry — drop this late connection
        // so it can't leak or block the attempt that wins.
        try {
          db.close();
        } catch {
          /* ignore */
        }
        return;
      }
      settled = true;
      clearTimeout(timer);
      // If another connection (another tab, or a "clear site data") needs to
      // upgrade/delete the DB, close ours so it can proceed and drop the cached
      // handle so the next operation reopens a fresh connection.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      // The connection was closed out from under us (e.g. storage cleared).
      // Invalidate the cache so we don't keep reusing a dead handle.
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(req.error ?? new Error('indexedDB.open failed'));
    };
  });
}

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (Date.now() < openCooldownUntil) {
    // A recent open exhausted its retries (IDB wedged — e.g. an iOS 16 SW): fail
    // fast so the caller falls back promptly instead of stalling on more retries.
    return Promise.reject(new Error('indexedDB unavailable'));
  }
  dbPromise = (async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt += 1) {
      try {
        return await openOnce(OPEN_TIMEOUT_MS);
      } catch (err) {
        lastErr = err;
        if (attempt < OPEN_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, OPEN_RETRY_DELAY_MS));
        }
      }
    }
    throw lastErr ?? new Error('indexedDB.open failed');
  })().catch((err) => {
    dbPromise = null; // allow a later retry instead of caching the failure
    openCooldownUntil = Date.now() + OPEN_COOLDOWN_MS;
    throw err;
  });
  return dbPromise;
}

// A request/transaction that never fires a completion event — the iOS-16 SW
// hang's second form, AFTER a successful open (a push handler awaiting it then
// stalls its whole budget and shows nothing). Bound every op: a real one
// completes in well under a second, so this only trips on a genuine platform
// hang, turning it into a recoverable rejection rather than an unbounded await.
// Never exercised on a healthy device (iOS 17+, desktop).
const IDB_OP_TIMEOUT_MS = 1500;

function withOpTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`indexedDB ${label} timed out`)), IDB_OP_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return withOpTimeout(
    new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
    'request',
  );
}

const READ_ATTEMPTS = 2; // one retry: a warmed-up second read usually clears an iOS-16 transaction hang

/** Re-run a READ on a timeout (the iOS-16 SW transaction hang) with a fresh
 *  transaction. Reads are idempotent, so a retry is always safe and often
 *  succeeds once the connection has warmed — the transaction-level sibling of
 *  the open-level retry. A real (non-timeout) error propagates immediately. This
 *  is what lets the SW read its keystore/chats to build a RICH notification on a
 *  flaky old device instead of falling back to a content-free generic. */
async function readRetry<T>(attempt: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < READ_ATTEMPTS; i += 1) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      if (!(err instanceof Error && err.message.includes('timed out'))) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('indexedDB read failed');
}

async function store(
  name: StoreName,
  mode: IDBTransactionMode,
): Promise<IDBObjectStore> {
  try {
    const db = await openDB();
    return db.transaction(name, mode).objectStore(name);
  } catch (e) {
    // The cached connection was closing/closed (storage cleared, another tab
    // upgraded, etc.). Drop the dead handle and reopen once so callers don't see
    // a permanent "database connection is closing" failure until a reload.
    if (e instanceof DOMException && e.name === 'InvalidStateError') {
      dbPromise = null;
      const db = await openDB();
      return db.transaction(name, mode).objectStore(name);
    }
    throw e;
  }
}

/** A read returns `fallback` if the store isn't present yet (version skew). */
async function hasStore(name: StoreName): Promise<boolean> {
  const db = await openDB();
  return db.objectStoreNames.contains(name);
}

export async function getAll<T>(name: StoreName): Promise<T[]> {
  if (!(await hasStore(name))) return [];
  return readRetry(async () => promisify((await store(name, 'readonly')).getAll() as IDBRequest<T[]>));
}

export async function get<T>(
  name: StoreName,
  key: IDBValidKey,
): Promise<T | undefined> {
  if (!(await hasStore(name))) return undefined;
  return readRetry(async () =>
    promisify((await store(name, 'readonly')).get(key) as IDBRequest<T | undefined>),
  );
}

export async function getByIndex<T>(
  name: StoreName,
  index: string,
  key: IDBValidKey,
): Promise<T[]> {
  if (!(await hasStore(name))) return [];
  return readRetry(async () => {
    const os = await store(name, 'readonly');
    return promisify(os.index(index).getAll(key) as IDBRequest<T[]>);
  });
}

export async function count(name: StoreName): Promise<number> {
  if (!(await hasStore(name))) return 0;
  return promisify((await store(name, 'readonly')).count());
}

export async function put<T>(name: StoreName, value: T): Promise<void> {
  const os = await store(name, 'readwrite');
  await promisify(os.put(value));
  notify(name);
}

/** Atomically read a record and, if it still exists, write back fn(current) within
 *  the SAME readwrite transaction, so a concurrent delete that lands between a
 *  separate get and put can't resurrect it. fn returning null/undefined writes
 *  nothing (leaves the record absent/unchanged). */
export async function update<T>(
  name: StoreName,
  key: IDBValidKey,
  fn: (current: T | undefined) => T | null | undefined,
): Promise<void> {
  if (!(await hasStore(name))) return;
  const run = (db: IDBDatabase): Promise<boolean> =>
    new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite'); // may throw InvalidStateError synchronously
      const os = tx.objectStore(name);
      const req = os.get(key) as IDBRequest<T | undefined>;
      let wrote = false;
      req.onsuccess = () => {
        const next = fn(req.result);
        if (next != null) {
          os.put(next);
          wrote = true;
        }
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve(wrote);
      tx.onerror = () => reject(tx.error);
    });
  let wrote: boolean;
  try {
    wrote = await withOpTimeout(run(await openDB()), 'update');
  } catch (e) {
    // Cached connection was closing (storage cleared / other-tab upgrade); drop it
    // and reopen once, like store(), so this doesn't fail until a reload.
    if (e instanceof DOMException && e.name === 'InvalidStateError') {
      dbPromise = null;
      wrote = await withOpTimeout(run(await openDB()), 'update');
    } else {
      throw e;
    }
  }
  if (wrote) notify(name);
}

/** The handle a `transact` callback drives. Reads/writes all ride ONE readwrite
 *  IndexedDB transaction, so everything commits together or nothing does. */
export interface Tx {
  get<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined>;
  put<T>(name: StoreName, value: T): void;
  delete(name: StoreName, key: IDBValidKey): void;
}

/**
 * Run `fn` inside ONE readwrite transaction spanning `names` (spec 1032). This is
 * what makes the service worker's per-frame commit crash-safe: the advanced ratchet
 * session, the message row, the chat read-modify-write, and the exactly-once ledger
 * mark are all-or-nothing — an interruption (worker killed, quota error, thrown
 * callback) leaves either the complete result or no trace, never a half-applied
 * frame. Change-bus notifications fire only after commit, once per touched store;
 * an abort notifies nothing.
 *
 * Constraint inherited from IndexedDB itself: `fn` may await the handle's own
 * `get` (the transaction stays alive across IDB-request microtasks), but awaiting
 * anything else (fetch, timers, crypto) lets the transaction auto-commit early —
 * do all slow work BEFORE calling transact and pass the results in.
 */
export async function transact(names: StoreName[], fn: (tx: Tx) => void | Promise<void>): Promise<void> {
  const run = (db: IDBDatabase): Promise<Set<StoreName>> =>
    new Promise<Set<StoreName>>((resolve, reject) => {
      const tx = db.transaction(names, 'readwrite'); // may throw InvalidStateError synchronously
      const touched = new Set<StoreName>();
      const handle: Tx = {
        get: (name, key) => promisify(tx.objectStore(name).get(key)),
        put: (name, value) => {
          tx.objectStore(name).put(value);
          touched.add(name);
        },
        delete: (name, key) => {
          tx.objectStore(name).delete(key);
          touched.add(name);
        },
      };
      let failed: unknown = null;
      Promise.resolve()
        .then(() => fn(handle))
        .catch((e) => {
          // Abort so nothing lands; reject with the CALLBACK's error (more useful
          // than the generic AbortError the abort event carries).
          failed = e;
          try {
            tx.abort();
          } catch {
            /* already aborted/finished */
          }
        });
      tx.oncomplete = () => resolve(touched);
      tx.onabort = () => reject(failed ?? tx.error ?? new Error('transaction aborted'));
      tx.onerror = () => {
        /* the abort handler reports; individual request errors bubble to onabort */
      };
    });
  let touched: Set<StoreName>;
  try {
    touched = await withOpTimeout(run(await openDB()), 'transact');
  } catch (e) {
    // Cached connection was closing (storage cleared / other-tab upgrade); drop it
    // and reopen once, like store()/update(), so this doesn't fail until a reload.
    if (e instanceof DOMException && e.name === 'InvalidStateError') {
      dbPromise = null;
      touched = await withOpTimeout(run(await openDB()), 'transact');
    } else {
      throw e;
    }
  }
  for (const name of touched) notify(name);
}

export async function bulkPut<T>(name: StoreName, values: T[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const os = tx.objectStore(name);
    for (const v of values) os.put(v);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notify(name);
}

export async function remove(
  name: StoreName,
  key: IDBValidKey,
): Promise<void> {
  const os = await store(name, 'readwrite');
  await promisify(os.delete(key));
  notify(name);
}

export async function clearStore(name: StoreName): Promise<void> {
  const os = await store(name, 'readwrite');
  await promisify(os.clear());
  notify(name);
}

/** Erase every store: a full local factory reset of the on-device database. */
export async function wipeAllStores(): Promise<void> {
  for (const name of STORES) {
    if (await hasStore(name)) await clearStore(name);
  }
}

/* ---- change-notification bus ---- */

const listeners = new Map<StoreName, Set<() => void>>();

function fireLocal(name: StoreName): void {
  listeners.get(name)?.forEach((cb) => cb());
}

/* Cross-context bridge (spec 1032): the listener Map above is module-level, so it
 * never crosses JS contexts — a live page's useLiveQuery was blind to service-worker
 * writes (and tab B to tab A's). Every notify() ALSO posts the store name on
 * BroadcastChannel('ring:idb'); a RECEIVED name fires the LOCAL listeners only and is
 * never re-broadcast, so two bridged contexts can't echo-loop each other. Unknown
 * payloads are ignored (a newer context may know stores this one doesn't). Contexts
 * without BroadcastChannel just skip the bridge (today's in-context behavior). */
const bridge: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ring:idb') : null;
if (bridge) {
  bridge.onmessage = (e: MessageEvent) => {
    const name = e.data as StoreName;
    if ((STORES as readonly string[]).includes(name)) fireLocal(name);
  };
}

function notify(name: StoreName): void {
  fireLocal(name);
  try {
    bridge?.postMessage(name);
  } catch {
    /* a closing channel must never fail a write */
  }
}

/**
 * Manually fire the change bus for a store without writing to it. Used when a
 * derived, in-memory view that `useLiveQuery` depends on changes (e.g. the
 * hidden-chats reveal toggle flips which chats `listChats` returns) so the UI
 * re-queries even though no stored row actually changed.
 */
export function touch(name: StoreName): void {
  notify(name);
}

/** Subscribe to changes on any of the given stores. Returns an unsubscribe fn. */
export function subscribe(names: StoreName[], cb: () => void): () => void {
  for (const n of names) {
    if (!listeners.has(n)) listeners.set(n, new Set());
    listeners.get(n)!.add(cb);
  }
  return () => {
    for (const n of names) listeners.get(n)?.delete(cb);
  };
}
