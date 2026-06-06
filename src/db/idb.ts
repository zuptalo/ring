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
] as const;
export type StoreName = (typeof STORES)[number];

const DB_NAME = 'ring';
const DB_VERSION = 4;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
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
