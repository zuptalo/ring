/**
 * Device session token mirrored into IndexedDB.
 *
 * The page reads the access token from localStorage (auth.ts), but the **service
 * worker cannot read localStorage**, and it needs the token to drain the relay
 * queue for background decryption. So we mirror the token into the local-only
 * `keystore` store (never synced to the server; cleared on sign-out). This module
 * imports ONLY `idb`, so it's safe to bundle into the service worker.
 */
import { get, put, remove } from '@/db/idb';

interface SessionRecord {
  id: 'session';
  token: string;
  userId: string;
}

/** Mirror the token + user id into IndexedDB so the service worker can read it. */
export async function mirrorSession(token: string, userId: string): Promise<void> {
  await put<SessionRecord>('keystore', { id: 'session', token, userId });
}

/** Read the mirrored access token (used by the service worker). */
export async function readSessionToken(): Promise<string | null> {
  const r = await get<SessionRecord>('keystore', 'session');
  return r?.token ?? null;
}

/** Read the mirrored user id. */
export async function readSessionUserId(): Promise<string | null> {
  const r = await get<SessionRecord>('keystore', 'session');
  return r?.userId ?? null;
}

/** Remove the mirrored session (sign-out / reset). */
export async function clearSession(): Promise<void> {
  await remove('keystore', 'session');
}
