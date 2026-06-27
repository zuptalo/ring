/**
 * Soft-delete markers. Deletes used to be hard removes, which a server pull
 * would happily resurrect. A tombstone records "(store, recordId) was deleted
 * at deletedAt"; the sync merge drops any incoming record that a newer-or-equal
 * tombstone covers. Tombstones themselves sync (so other devices honor them).
 *
 * EXCEPTION — `localOnly` tombstones (spec 1019): a Hidden Chats PIN reset wipes
 * hidden conversations on THIS device and must block them from re-downloading,
 * WITHOUT telling the server or the user's other devices (where the conversation
 * may still be wanted). A `localOnly` tombstone is honored by the ingest check
 * but excluded from `listTombstones()` so it is never uploaded.
 */
import { get, getAll, put, remove, type StoreName } from './idb';

export interface Tombstone {
  id: string; // `${store}:${recordId}`
  store: string;
  recordId: string;
  deletedAt: number;
  localOnly?: boolean; // never uploaded (device-local re-sync block)
}

function key(store: string, recordId: string): string {
  return `${store}:${recordId}`;
}

/** Mark a record deleted (idempotent; keeps the latest deletedAt). */
export async function recordTombstone(
  store: StoreName,
  recordId: string,
  deletedAt = Date.now(),
  localOnly = false,
): Promise<void> {
  const t: Tombstone = { id: key(store, recordId), store, recordId, deletedAt };
  if (localOnly) t.localOnly = true;
  await put<Tombstone>('tombstones', t);
}

/** True if a tombstone covers this record at or after `updatedAt`. Honors both
 *  synced and localOnly tombstones (the ingest block applies to both). */
export async function isTombstoned(
  store: string,
  recordId: string,
  updatedAt: number,
): Promise<boolean> {
  const t = await get<Tombstone>('tombstones', key(store, recordId));
  return !!t && t.deletedAt >= updatedAt;
}

/** True if ANY tombstone exists for this record, regardless of timestamp. Used by
 *  the directory mirror, where the incoming record's `updatedAt` is the peer's
 *  unrelated profile-edit time, NOT a delete-vs-edit race on OUR timeline: a peer
 *  bumping their profile after we deleted them must not resurrect the contact. A
 *  deletion is intentional and absolute until an explicit re-add lifts it (see
 *  `clearTombstone`), so here we treat the mere presence of a tombstone as "gone". */
export async function hasTombstone(store: string, recordId: string): Promise<boolean> {
  return !!(await get<Tombstone>('tombstones', key(store, recordId)));
}

/** Lift a tombstone — the record is intentionally being brought back (e.g. re-adding
 *  a previously-deleted contact). Without this, the directory mirror's `hasTombstone`
 *  guard would keep skipping the re-add forever. */
export async function clearTombstone(store: StoreName, recordId: string): Promise<void> {
  await remove('tombstones', key(store, recordId));
}

/** All UPLOADABLE tombstones — excludes localOnly (device-local) markers so a
 *  Hidden Chats reset never propagates its wipe to the server or other devices. */
export async function listTombstones(): Promise<Tombstone[]> {
  return (await getAll<Tombstone>('tombstones')).filter((t) => !t.localOnly);
}
