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
] as const;
export type StoreName = (typeof STORES)[number];

const DB_NAME = 'ring';
// v8 (spec 1014): the Media record gains optional `posterGrid`/`posterStrip` thumbnail tiers. These
// are additive optional Blob fields on existing records — IndexedDB needs no per-row transform for
// that, so the version bump alone (which documents the schema evolution) is the whole migration;
// existing rows are preserved unchanged and the tiers are filled in by the background backfill.
// v9 (spec 0003): add the social-Wall stores `posts` + `postEngagement` (additive
// createObjectStore in onupgradeneeded; existing data untouched).
const DB_VERSION = 9;

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

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
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
    };
    req.onsuccess = () => {
      const db = req.result;
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
      dbPromise = null; // allow a later retry instead of caching the failure
      reject(req.error);
    };
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
  return promisify((await store(name, 'readonly')).getAll() as IDBRequest<T[]>);
}

export async function get<T>(
  name: StoreName,
  key: IDBValidKey,
): Promise<T | undefined> {
  if (!(await hasStore(name))) return undefined;
  return promisify(
    (await store(name, 'readonly')).get(key) as IDBRequest<T | undefined>,
  );
}

export async function getByIndex<T>(
  name: StoreName,
  index: string,
  key: IDBValidKey,
): Promise<T[]> {
  if (!(await hasStore(name))) return [];
  const os = await store(name, 'readonly');
  return promisify(os.index(index).getAll(key) as IDBRequest<T[]>);
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
    wrote = await run(await openDB());
  } catch (e) {
    // Cached connection was closing (storage cleared / other-tab upgrade); drop it
    // and reopen once, like store(), so this doesn't fail until a reload.
    if (e instanceof DOMException && e.name === 'InvalidStateError') {
      dbPromise = null;
      wrote = await run(await openDB());
    } else {
      throw e;
    }
  }
  if (wrote) notify(name);
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

function notify(name: StoreName): void {
  listeners.get(name)?.forEach((cb) => cb());
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
