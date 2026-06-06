/**
 * Secret settings facade: transparent encryption for the user's own
 * zero-knowledge data (Class B), stored alongside ordinary settings.
 *
 * Mirrors getSetting/setSetting but seals the value under the master key before
 * it touches the `settings` store (and, later, the server). Plaintext settings
 * the server must enforce (Class A) and device-local ones (Class C) keep using
 * getSetting/setSetting directly.
 *
 * Storage shape for a secret row: { key, value: { __enc: 1, env: Envelope } }.
 * Reads transparently decrypt; a legacy plaintext value (pre-encryption) is
 * returned as-is so nothing breaks before migration runs.
 */
import { getSetting, setSetting } from '@/db/queries';
import { getMasterKey } from '@/services/crypto/identity';
import { sealJson, openJson, utf8ToBytes, type Envelope } from '@/services/crypto/envelope';

/* ---- classification (single source of truth; consumed by sync later) ---- */

/** Class B: zero-knowledge, encrypted with the master key, syncs as ciphertext. */
export const SECRET_KEYS = ['profileName', 'profileAbout', 'profileAvatar'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export function isSecretKey(key: string): key is SecretKey {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

/* ---- envelope wrapper marker ---- */

interface EncWrapper {
  __enc: 1;
  env: Envelope;
}

function isEnc(v: unknown): v is EncWrapper {
  return typeof v === 'object' && v !== null && (v as { __enc?: unknown }).__enc === 1 && 'env' in v;
}

/**
 * Read a secret. Decrypts with the master key (AAD = the setting key). Returns
 * `fallback` when absent or while the keystore is locked; transparently returns
 * a not-yet-migrated plaintext value.
 */
export async function getSecret<T>(key: SecretKey, fallback: T): Promise<T> {
  const raw = await getSetting<unknown>(key, undefined as unknown);
  if (raw === undefined || raw === null) return fallback;
  if (isEnc(raw)) {
    try {
      return openJson<T>(getMasterKey(), raw.env, utf8ToBytes(key));
    } catch {
      return fallback; // locked, or wrong key, surface the default
    }
  }
  return raw as T; // legacy plaintext
}

/** Write a secret, encrypting it under the master key. Throws if locked. */
export async function setSecret<T>(key: SecretKey, value: T): Promise<void> {
  const env = sealJson(getMasterKey(), value, 'master', utf8ToBytes(key));
  await setSetting<EncWrapper>(key, { __enc: 1, env });
}

/**
 * One-time upgrade: any Class-B value still stored in plaintext (from before
 * encryption existed) gets re-written as ciphertext. Safe to call repeatedly;
 * requires the keystore to be unlocked.
 */
export async function migrateSecrets(): Promise<void> {
  for (const key of SECRET_KEYS) {
    const raw = await getSetting<unknown>(key, undefined as unknown);
    if (raw !== undefined && raw !== null && !isEnc(raw)) {
      await setSecret(key, raw);
    }
  }
}
