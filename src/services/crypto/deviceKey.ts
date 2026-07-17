/**
 * Device-bound key for passwordless auto-unlock.
 *
 * A non-extractable WebCrypto AES-GCM key, stored in the local-only `keystore`
 * IndexedDB store. It wraps the identity keystore at rest so the app (and the
 * service worker) can unlock without a passcode. "Non-extractable" means JS in
 * this origin can USE it to decrypt but can never read the raw key bytes, so an
 * XSS/extension compromise can't exfiltrate it (only decrypt in place). Present
 * ⟺ auto-unlock is on; enabling a PIN/passkey lock deletes it.
 *
 * This module imports only `idb` + b64 helpers, so it's safe to bundle into the
 * service worker.
 */
import { get, put, remove } from '@/db/idb';
import { bytesToB64url, b64urlToBytes } from './envelope';

interface DeviceKeyRecord {
  id: 'deviceKey';
  key: CryptoKey;
}

/** A serialized AES-GCM ciphertext (b64url iv + ct), stored in the keystore record. */
export interface DeviceWrap {
  iv: string;
  ct: string;
}

/** Read the device key, or null if auto-unlock isn't set up. */
export async function getDeviceKey(): Promise<CryptoKey | null> {
  return (await get<DeviceKeyRecord>('keystore', 'deviceKey'))?.key ?? null;
}

/** Get the device key, generating + persisting one if absent. The generated key
 *  is non-extractable; IndexedDB stores the CryptoKey handle via structured clone. */
export async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  const existing = await getDeviceKey();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await put<DeviceKeyRecord>('keystore', { id: 'deviceKey', key });
  return key;
}

/** Remove the device key (when enabling a PIN/passkey lock or signing out). */
export async function clearDeviceKey(): Promise<void> {
  await remove('keystore', 'deviceKey');
}

/** AES-GCM seal `plaintext` under `key` with a fresh 12-byte IV. */
export async function deviceSeal(key: CryptoKey, plaintext: Uint8Array): Promise<DeviceWrap> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext as unknown as BufferSource),
  );
  return { iv: bytesToB64url(iv), ct: bytesToB64url(ct) };
}

/** AES-GCM open a DeviceWrap; throws if the key is wrong or the data is tampered. */
export async function deviceOpen(key: CryptoKey, wrap: DeviceWrap): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlToBytes(wrap.iv) as unknown as BufferSource },
    key,
    b64urlToBytes(wrap.ct) as unknown as BufferSource,
  );
  return new Uint8Array(pt);
}
