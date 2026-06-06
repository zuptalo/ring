/**
 * Soft-delete markers. Deletes used to be hard removes, which a server pull
 * would happily resurrect. A tombstone records "(store, recordId) was deleted
 * at deletedAt"; the sync merge drops any incoming record that a newer-or-equal
 * tombstone covers. Tombstones themselves sync (so other devices honor them).
 */
import { get, getAll, put, type StoreName } from './idb';

export interface Tombstone {
  id: string; // `${store}:${recordId}`
  store: string;
  recordId: string;
  deletedAt: number;
}

function key(store: string, recordId: string): string {
  return `${store}:${recordId}`;
}

/** Mark a record deleted (idempotent; keeps the latest deletedAt). */
export async function recordTombstone(
  store: StoreName,
  recordId: string,
  deletedAt = Date.now(),
): Promise<void> {
  await put<Tombstone>('tombstones', { id: key(store, recordId), store, recordId, deletedAt });
}

/** True if a tombstone covers this record at or after `updatedAt`. */
export async function isTombstoned(
  store: string,
  recordId: string,
  updatedAt: number,
): Promise<boolean> {
  const t = await get<Tombstone>('tombstones', key(store, recordId));
  return !!t && t.deletedAt >= updatedAt;
}

export function listTombstones(): Promise<Tombstone[]> {
  return getAll<Tombstone>('tombstones');
}
