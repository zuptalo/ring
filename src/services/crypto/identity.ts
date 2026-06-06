/**
 * Identity & keystore.
 *
 * Owns the device's long-term cryptographic identity and the symmetric master
 * key used for the user's own zero-knowledge data:
 *   - Ed25519 keypair  (signing, authenticates the signed prekey / bundle)
 *   - X25519  keypair  (Diffie-Hellman, X3DH, see ratchet.ts)
 *   - a signed prekey + a pool of one-time prekeys (consumed by X3DH)
 *   - a 256-bit master key (encrypts profile/secret settings)
 *
 * At rest every secret is wrapped (AEAD) under a key derived from the user's
 * PIN via Argon2id; only public keys are stored in the clear. A second wrap
 * under an Argon2id key derived from a one-time recovery code lets identity +
 * master key be restored on a new device (the wrap blob is uploaded to the
 * server later, backend).
 *
 * The crypto core (generate/wrap/unwrap) is exported as pure functions so it is
 * testable with no IndexedDB; the stateful service layer persists via the idb
 * wrapper and exposes reactive `isInitialized` / `isUnlocked`.
 */
import { ref, readonly } from 'vue';
import {
  ready,
  randomBytes,
  x25519Keypair,
  ed25519Keypair,
  sign,
  verify,
  sha256,
  argon2id,
  ARGON_SALT_BYTES,
  KEY_BYTES,
  type KeyPair,
} from './primitives';
import {
  sealJson,
  openJson,
  bytesToB64url,
  b64urlToBytes,
  utf8ToBytes,
  type Envelope,
} from './envelope';
import { get, put, clearStore } from '@/db/idb';
import {
  getDeviceKey,
  getOrCreateDeviceKey,
  clearDeviceKey,
  deviceSeal,
  deviceOpen,
  type DeviceWrap,
} from './deviceKey';

const ONE_TIME_PREKEY_COUNT = 20;

/* ---- in-memory (unlocked) shapes ---- */

export interface PreKey {
  id: string;
  keypair: KeyPair;
}

export interface SecretBundle {
  ed: KeyPair; // Ed25519 identity
  x: KeyPair; // X25519 identity
  signedPreKey: { id: string; keypair: KeyPair; sig: Uint8Array };
  oneTimePreKeys: PreKey[];
  masterKey: Uint8Array;
}

/* ---- public bundle (published to peers / server) ---- */

export interface PublicBundle {
  edPub: string; // b64url
  xPub: string; // b64url
  signedPreKey: { id: string; pub: string; sig: string };
  oneTimePreKeys: { id: string; pub: string }[];
}

/* ---- persisted keystore record (id: 'identity') ---- */

interface KeystoreRecord {
  id: 'identity';
  createdAt: number;
  publicBundle: PublicBundle;
  // PIN wrap, present only when the user has opted into a passcode/passkey lock.
  // Absent under the default (passwordless) posture, where deviceWrapped is used.
  pinSalt?: string; // b64url
  wrapped?: Envelope; // SecretBundle sealed under the PIN-derived key
  pinLength?: number; // digits in the PIN (4 or 6) → the unlock pad auto-verifies at it
  // Device-key wrap: the SecretBundle sealed under the non-extractable device key
  // (WebCrypto AES-GCM). Present ⟺ auto-unlock is on (and the service worker can
  // decrypt). Mutually exclusive with a PIN lock.
  deviceWrapped?: DeviceWrap;
  recoverySalt: string; // b64url
  recoveryWrapped: Envelope; // {master, ed, x} sealed under the recovery-code key
  recoveryLookup?: string; // one-way hash of the recovery code (uploaded so a new
  // device can find this account from the code). Optional: records created before
  // new-device restore landed won't have it (they become restorable after the
  // recovery code is next rotated).
}

/** Recovered identity core (from the recovery wrap), enough to re-establish the
 *  account on a new device. */
export interface RecoveredCore {
  ed: KeyPair;
  x: KeyPair;
  masterKey: Uint8Array;
}

/* ---------- pure crypto core (no IndexedDB; unit-testable) ---------- */

function uid(): string {
  return bytesToB64url(randomBytes(9));
}

/** Generate a signed prekey (bound to `ed`) plus a pool of one-time prekeys. */
function generatePreKeyBundle(
  ed: KeyPair,
  prekeyCount = ONE_TIME_PREKEY_COUNT,
): Pick<SecretBundle, 'signedPreKey' | 'oneTimePreKeys'> {
  const spk = x25519Keypair();
  const sig = sign(ed.privateKey, spk.publicKey); // bind the prekey to the identity
  const oneTimePreKeys: PreKey[] = [];
  for (let i = 0; i < prekeyCount; i++) oneTimePreKeys.push({ id: uid(), keypair: x25519Keypair() });
  return { signedPreKey: { id: uid(), keypair: spk, sig }, oneTimePreKeys };
}

/** Generate a fresh, complete identity (called once at registration). */
export function generateIdentityMaterial(prekeyCount = ONE_TIME_PREKEY_COUNT): SecretBundle {
  const ed = ed25519Keypair();
  const x = x25519Keypair();
  return {
    ed,
    x,
    ...generatePreKeyBundle(ed, prekeyCount),
    masterKey: randomBytes(KEY_BYTES),
  };
}

/** Normalize a typed recovery code to the canonical XXXX-XXXX-… form. */
function normalizeRecoveryCode(code: string): string {
  const clean = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (clean.match(/.{1,4}/g) ?? []).join('-');
}

/**
 * One-way lookup id derived from the recovery code. Uploaded alongside the
 * recovery wrap so a NEW device can find the account from the code alone. It is a
 * domain-separated hash, NOT the Argon2id key that seals the wrap, so the server
 * learns nothing that helps decrypt anything (zero-knowledge preserved), it just
 * gets an opaque high-entropy handle.
 */
export function recoveryLookupId(code: string): string {
  return bytesToB64url(sha256(utf8ToBytes('ring-recovery-lookup-v1|' + normalizeRecoveryCode(code))));
}

/** Verify the signed prekey signature chains to the identity key. */
export function verifySignedPreKey(b: Pick<SecretBundle, 'ed' | 'signedPreKey'>): boolean {
  return verify(b.ed.publicKey, b.signedPreKey.keypair.publicKey, b.signedPreKey.sig);
}

export function publicBundleOf(b: SecretBundle): PublicBundle {
  return {
    edPub: bytesToB64url(b.ed.publicKey),
    xPub: bytesToB64url(b.x.publicKey),
    signedPreKey: {
      id: b.signedPreKey.id,
      pub: bytesToB64url(b.signedPreKey.keypair.publicKey),
      sig: bytesToB64url(b.signedPreKey.sig),
    },
    oneTimePreKeys: b.oneTimePreKeys.map((p) => ({ id: p.id, pub: bytesToB64url(p.keypair.publicKey) })),
  };
}

/** Safety-number style fingerprint of the public identity (hex, grouped). */
export function fingerprintOf(b: Pick<SecretBundle, 'ed' | 'x'>): string {
  const h = sha256(concat(b.ed.publicKey, b.x.publicKey));
  const hex = Array.from(h.subarray(0, 15), (n) => n.toString(16).padStart(2, '0')).join('');
  return (hex.match(/.{1,5}/g) ?? []).join(' ');
}

// --- (de)serialization to a JSON-safe shape for sealing ---

interface SecretJson {
  ed: { pub: string; priv: string };
  x: { pub: string; priv: string };
  spk: { id: string; pub: string; priv: string; sig: string };
  otk: { id: string; pub: string; priv: string }[];
  master: string;
}

function serialize(b: SecretBundle): SecretJson {
  const kp = (k: KeyPair) => ({ pub: bytesToB64url(k.publicKey), priv: bytesToB64url(k.privateKey) });
  return {
    ed: kp(b.ed),
    x: kp(b.x),
    spk: { id: b.signedPreKey.id, ...kp(b.signedPreKey.keypair), sig: bytesToB64url(b.signedPreKey.sig) },
    otk: b.oneTimePreKeys.map((p) => ({ id: p.id, ...kp(p.keypair) })),
    master: bytesToB64url(b.masterKey),
  };
}

function deserialize(j: SecretJson): SecretBundle {
  const kp = (k: { pub: string; priv: string }): KeyPair => ({
    publicKey: b64urlToBytes(k.pub),
    privateKey: b64urlToBytes(k.priv),
  });
  return {
    ed: kp(j.ed),
    x: kp(j.x),
    signedPreKey: { id: j.spk.id, keypair: kp(j.spk), sig: b64urlToBytes(j.spk.sig) },
    oneTimePreKeys: j.otk.map((p) => ({ id: p.id, keypair: kp(p) })),
    masterKey: b64urlToBytes(j.master),
  };
}

/** Wrap the full secret bundle under a passphrase (PIN). */
export function wrapSecret(b: SecretBundle, passphrase: string): { salt: string; env: Envelope } {
  const salt = randomBytes(ARGON_SALT_BYTES);
  const key = argon2id(passphrase, salt);
  return { salt: bytesToB64url(salt), env: sealJson(key, serialize(b), 'pin') };
}

/** Unwrap a secret bundle; throws if the passphrase is wrong (AEAD fails). */
export function unwrapSecret(env: Envelope, saltB64: string, passphrase: string): SecretBundle {
  const key = argon2id(passphrase, b64urlToBytes(saltB64));
  return deserialize(openJson<SecretJson>(key, env));
}

/** Seal the secret bundle under the (non-extractable) device key for auto-unlock. */
async function wrapForDevice(b: SecretBundle): Promise<DeviceWrap> {
  const key = await getOrCreateDeviceKey();
  const bytes = utf8ToBytes(JSON.stringify(serialize(b)));
  return deviceSeal(key, bytes);
}

/** Unseal the device-wrapped bundle; throws if the device key is missing/wrong. */
async function openFromDevice(wrap: DeviceWrap): Promise<SecretBundle> {
  const key = await getDeviceKey();
  if (!key) throw new Error('no device key');
  const bytes = await deviceOpen(key, wrap);
  return deserialize(JSON.parse(new TextDecoder().decode(bytes)) as SecretJson);
}

// Recovery wrap: only identity + master key (enough to restore identity, not history).
interface RecoveryJson {
  ed: { pub: string; priv: string };
  x: { pub: string; priv: string };
  master: string;
}

export function generateRecoveryCode(): string {
  const hex = Array.from(randomBytes(16), (n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  return (hex.match(/.{1,4}/g) ?? []).join('-');
}

export function wrapRecovery(b: SecretBundle, code: string): { salt: string; env: Envelope } {
  const salt = randomBytes(ARGON_SALT_BYTES);
  const key = argon2id(code, salt);
  const payload: RecoveryJson = {
    ed: { pub: bytesToB64url(b.ed.publicKey), priv: bytesToB64url(b.ed.privateKey) },
    x: { pub: bytesToB64url(b.x.publicKey), priv: bytesToB64url(b.x.privateKey) },
    master: bytesToB64url(b.masterKey),
  };
  return { salt: bytesToB64url(salt), env: sealJson(key, payload, 'recovery') };
}

export function unwrapRecovery(
  env: Envelope,
  saltB64: string,
  code: string,
): { ed: KeyPair; x: KeyPair; masterKey: Uint8Array } {
  const key = argon2id(code, b64urlToBytes(saltB64));
  const j = openJson<RecoveryJson>(key, env);
  return {
    ed: { publicKey: b64urlToBytes(j.ed.pub), privateKey: b64urlToBytes(j.ed.priv) },
    x: { publicKey: b64urlToBytes(j.x.pub), privateKey: b64urlToBytes(j.x.priv) },
    masterKey: b64urlToBytes(j.master),
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/* ---------- stateful service (IndexedDB + reactive state) ---------- */

const initialized = ref(false);
const unlockedRef = ref(false);
export const isInitialized = readonly(initialized);
export const isUnlocked = readonly(unlockedRef);

// Held only in memory while unlocked; cleared on lock()/wipe().
let unlocked: SecretBundle | null = null;

/** Populate `isInitialized` from storage; call once at app start. */
export async function loadIdentityState(): Promise<void> {
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  initialized.value = !!rec;
}

export function isUnlockedNow(): boolean {
  return unlocked !== null;
}

/**
 * Create the identity for this device, protected by `pin`. Returns the one-time
 * recovery code (show it once; it cannot be recovered later). Leaves the
 * identity unlocked in memory.
 */
// Coalesce concurrent identity creation (e.g. the KeyGuard auto-create racing an
// explicit create) so two bundles can't be generated for the same device, which
// would mismatch the published public keys.
let creatingIdentity: Promise<string> | null = null;

export function ensureIdentity(pin?: string): Promise<string> {
  if (creatingIdentity) return creatingIdentity;
  creatingIdentity = createIdentity(pin).finally(() => {
    creatingIdentity = null;
  });
  return creatingIdentity;
}

async function createIdentity(pin?: string): Promise<string> {
  await ready();
  const existing = await get<KeystoreRecord>('keystore', 'identity');
  if (existing) throw new Error('Identity already exists on this device.');

  const bundle = generateIdentityMaterial();
  const recoveryCode = generateRecoveryCode();
  const { salt: recoverySalt, env: recoveryWrapped } = wrapRecovery(bundle, recoveryCode);

  const record: KeystoreRecord = {
    id: 'identity',
    createdAt: Date.now(),
    publicBundle: publicBundleOf(bundle),
    recoverySalt,
    recoveryWrapped,
    recoveryLookup: recoveryLookupId(recoveryCode),
  };
  if (pin) {
    // Opted into a passcode lock at creation: PIN-wrap, no device auto-unlock.
    const { salt: pinSalt, env: wrapped } = wrapSecret(bundle, pin);
    record.pinSalt = pinSalt;
    record.wrapped = wrapped;
    record.pinLength = pin.length;
  } else {
    // Default passwordless posture: wrap under the device key so the app (and the
    // service worker) auto-unlock without a passcode.
    record.deviceWrapped = await wrapForDevice(bundle);
  }
  await put('keystore', record);
  unlocked = bundle;
  initialized.value = true;
  unlockedRef.value = true;
  return recoveryCode;
}

/**
 * Install an identity restored from a recovery wrap on a NEW device, protected by
 * `pin`. Mints a fresh prekey bundle (the old device's one-time keys may be
 * depleted) but keeps the SAME recovery wrap (so the user's recovery code stays
 * valid). Leaves the keystore unlocked. Throws if a keystore already exists.
 */
export async function installRestored(
  core: RecoveredCore,
  recoverySalt: string,
  recoveryWrapped: Envelope,
  recoveryLookup: string,
  pin?: string,
): Promise<void> {
  await ready();
  if (await get<KeystoreRecord>('keystore', 'identity')) {
    throw new Error('Identity already exists on this device.');
  }
  const bundle: SecretBundle = {
    ed: core.ed,
    x: core.x,
    ...generatePreKeyBundle(core.ed),
    masterKey: core.masterKey,
  };
  const record: KeystoreRecord = {
    id: 'identity',
    createdAt: Date.now(),
    publicBundle: publicBundleOf(bundle),
    recoverySalt,
    recoveryWrapped,
    recoveryLookup,
  };
  if (pin) {
    const { salt: pinSalt, env: wrapped } = wrapSecret(bundle, pin);
    record.pinSalt = pinSalt;
    record.wrapped = wrapped;
    record.pinLength = pin.length;
  } else {
    record.deviceWrapped = await wrapForDevice(bundle);
  }
  await put('keystore', record);
  unlocked = bundle;
  initialized.value = true;
  unlockedRef.value = true;
}

/** Check a PIN against the stored keystore without changing lock state. Used by
 *  the passkey enroll path, which must confirm the PIN is correct before sealing
 *  it under the PRF-derived key. */
export async function verifyPin(pin: string): Promise<boolean> {
  await ready();
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  if (!rec?.wrapped || !rec.pinSalt) return false;
  try {
    unwrapSecret(rec.wrapped, rec.pinSalt, pin); // throws if the PIN is wrong
    return true;
  } catch {
    return false;
  }
}

/** After unwrapping, merge the separately-persisted replenished one-time prekeys
 *  (saved under the master key) so the X3DH responder can still find them. */
async function mergeExtraOtks(bundle: SecretBundle): Promise<void> {
  const extra = await loadExtraOtks(bundle.masterKey);
  if (extra.length) bundle.oneTimePreKeys.push(...extra);
}

/** Decrypt the keystore with the PIN; throws on a wrong PIN (or if no PIN lock is
 *  set, the account is on the passwordless device-key posture). */
export async function unlock(pin: string): Promise<void> {
  await ready();
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  if (!rec) throw new Error('No identity on this device.');
  if (!rec.wrapped || !rec.pinSalt) throw new Error('No passcode set on this device.');
  // unwrapSecret throws if the PIN is wrong (AEAD authentication fails).
  unlocked = unwrapSecret(rec.wrapped, rec.pinSalt, pin);
  await mergeExtraOtks(unlocked);
  unlockedRef.value = true;
}

/** Auto-unlock via the device key (no passcode). Returns false when the account is
 *  PIN-locked (no deviceWrapped); the caller then shows the passcode gate. Used
 *  on boot by the page AND on push by the service worker (separate module copies). */
export async function attemptDeviceUnlock(): Promise<boolean> {
  await ready();
  if (unlocked) return true;
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  if (!rec?.deviceWrapped) return false;
  try {
    const bundle = await openFromDevice(rec.deviceWrapped);
    await mergeExtraOtks(bundle);
    unlocked = bundle;
    initialized.value = true;
    unlockedRef.value = true;
    return true;
  } catch {
    return false; // device key missing/rotated → fall back to the gate
  }
}

/** Whether this device auto-unlocks (no passcode lock set). */
export async function hasDeviceUnlock(): Promise<boolean> {
  return !!(await get<KeystoreRecord>('keystore', 'identity'))?.deviceWrapped;
}

/** Whether a passcode/passkey lock is enabled (at-rest protection on; the service
 *  worker can't decrypt → notifications fall back to content-free). */
export async function isLockEnabled(): Promise<boolean> {
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  return !!rec?.wrapped && !rec.deviceWrapped;
}

/** Turn ON a passcode lock: PIN-wrap the (currently unlocked) bundle and remove the
 *  device auto-unlock (so at-rest protection is real and the SW can no longer
 *  decrypt). Requires the keystore unlocked. */
export async function enableLock(pin: string): Promise<void> {
  if (!unlocked) throw new Error('Unlock first.');
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  if (!rec) throw new Error('No identity on this device.');
  const { salt: pinSalt, env: wrapped } = wrapSecret(unlocked, pin);
  rec.pinSalt = pinSalt;
  rec.wrapped = wrapped;
  rec.pinLength = pin.length; // so the unlock pad auto-verifies at this length
  delete rec.deviceWrapped;
  await put('keystore', rec);
  await clearDeviceKey();
}

/** Turn OFF the passcode lock: re-enable device auto-unlock. Verifies the PIN. */
export async function disableLock(pin: string): Promise<void> {
  await ready();
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  if (!rec?.wrapped || !rec.pinSalt) return; // already passwordless
  const bundle = unwrapSecret(rec.wrapped, rec.pinSalt, pin); // throws on wrong PIN
  rec.deviceWrapped = await wrapForDevice(bundle);
  delete rec.wrapped;
  delete rec.pinSalt;
  delete rec.pinLength;
  await put('keystore', rec);
  if (!unlocked) {
    await mergeExtraOtks(bundle);
    unlocked = bundle;
    unlockedRef.value = true;
  }
}

/** The digit-length of the set PIN (4 or 6), or null when passwordless. Lets the
 *  unlock pad auto-verify the instant that many digits are entered. */
export async function getPinLength(): Promise<number | null> {
  await ready();
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  return rec?.wrapped && rec.pinLength ? rec.pinLength : null;
}

export function lock(): void {
  unlocked = null;
  unlockedRef.value = false;
}

/** Destroy all key material on this device (sign-out / reset). */
export async function wipeIdentity(): Promise<void> {
  lock();
  await clearStore('keystore');
  await clearStore('prekeys');
  initialized.value = false;
}

/** Check a recovery code against the stored recovery wrap (no state change). */
export async function verifyRecoveryCode(code: string): Promise<boolean> {
  await ready();
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  if (!rec) return false;
  try {
    unwrapRecovery(rec.recoveryWrapped, rec.recoverySalt, normalizeRecoveryCode(code));
    return true;
  } catch {
    return false;
  }
}

/**
 * Recover from a forgotten passcode using the recovery code: re-derive the
 * identity + master key, mint fresh prekeys, and leave the keystore unlocked. A
 * NEW recovery code is issued (the old one stops working) and returned so it can
 * be shown to the user. The web token and all encrypted data are preserved, no
 * re-registration.
 *
 * `newPin` is OPTIONAL: with no pin the account returns to the default passwordless
 * device-key posture (a passcode is opt-in later in Settings); with a pin it stays
 * PIN-locked. Recovery never forces a passcode.
 */
export async function recoverWithCode(code: string, newPin?: string): Promise<string> {
  await ready();
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  if (!rec) throw new Error('No identity on this device.');
  const norm = normalizeRecoveryCode(code);
  const { ed, x, masterKey } = unwrapRecovery(rec.recoveryWrapped, rec.recoverySalt, norm); // throws if wrong
  const bundle: SecretBundle = { ed, x, ...generatePreKeyBundle(ed), masterKey };
  // Rotate the recovery code: the old one no longer unwraps anything.
  const newRecoveryCode = generateRecoveryCode();
  const { salt: recoverySalt, env: recoveryWrapped } = wrapRecovery(bundle, newRecoveryCode);
  const record: KeystoreRecord = {
    id: 'identity',
    createdAt: rec.createdAt,
    publicBundle: publicBundleOf(bundle),
    recoverySalt,
    recoveryWrapped,
    recoveryLookup: recoveryLookupId(newRecoveryCode),
  };
  if (newPin) {
    const { salt: pinSalt, env: wrapped } = wrapSecret(bundle, newPin);
    record.pinSalt = pinSalt;
    record.wrapped = wrapped;
    record.pinLength = newPin.length;
  } else {
    // Default passwordless posture: wrap under the device key (auto-unlock).
    record.deviceWrapped = await wrapForDevice(bundle);
  }
  await put('keystore', record);
  unlocked = bundle;
  initialized.value = true;
  unlockedRef.value = true;
  return newRecoveryCode;
}

/**
 * Rotate the recovery code on demand, WITHOUT needing the old one: re-wrap the
 * (already-unlocked) identity + master key under a freshly-generated code, update
 * the keystore record, and return the new code to show the user. The old code
 * stops working. Requires the keystore to be unlocked. The caller must re-upload
 * the new wrap to the server (see ownsync.syncRecoveryWrap) so a new device can
 * restore with it. Unlike recoverWithCode, this neither touches the PIN wrap nor
 * rotates prekeys; only the recovery wrap changes.
 */
export async function rotateRecoveryCode(): Promise<string> {
  const b = requireUnlocked();
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  if (!rec) throw new Error('No identity on this device.');
  const newRecoveryCode = generateRecoveryCode();
  const { salt: recoverySalt, env: recoveryWrapped } = wrapRecovery(b, newRecoveryCode);
  await put('keystore', {
    ...rec,
    recoverySalt,
    recoveryWrapped,
    recoveryLookup: recoveryLookupId(newRecoveryCode),
  } as KeystoreRecord);
  return newRecoveryCode;
}

/* ---- accessors (require unlock) ---- */

function requireUnlocked(): SecretBundle {
  if (!unlocked) throw new Error('Keystore is locked.');
  return unlocked;
}

export function getMasterKey(): Uint8Array {
  return requireUnlocked().masterKey;
}

export function getIdentityKeys(): { ed: KeyPair; x: KeyPair } {
  const b = requireUnlocked();
  return { ed: b.ed, x: b.x };
}

/** This device's current signed prekey (id + keypair), the responder side of
 *  X3DH needs the private half. */
export function getSignedPreKey(): { id: string; keypair: KeyPair } {
  const b = requireUnlocked();
  return { id: b.signedPreKey.id, keypair: b.signedPreKey.keypair };
}

/** Look up a one-time prekey's keypair by id (for the X3DH responder). Returns
 *  null if it isn't in the keystore (e.g. rotated away). */
export function getOneTimePreKeyById(id: string): KeyPair | null {
  const b = requireUnlocked();
  return b.oneTimePreKeys.find((p) => p.id === id)?.keypair ?? null;
}

/* ---- one-time prekey replenishment ---- */

// Replenished one-time prekeys can't go back into the PIN-wrapped bundle (that
// would need the PIN, which we don't keep after unlock). Instead their private
// halves are persisted in a side record sealed under the MASTER key (available
// while unlocked), and merged into the in-memory pool on unlock.
interface ExtraOtkJson { id: string; pub: string; priv: string }
interface ExtraOtkRecord { id: 'otk-extra'; sealed: Envelope }

async function loadExtraOtks(masterKey: Uint8Array): Promise<PreKey[]> {
  const rec = await get<ExtraOtkRecord>('keystore', 'otk-extra');
  if (!rec) return [];
  try {
    const arr = openJson<ExtraOtkJson[]>(masterKey, rec.sealed);
    return arr.map((p) => ({
      id: p.id,
      keypair: { publicKey: b64urlToBytes(p.pub), privateKey: b64urlToBytes(p.priv) },
    }));
  } catch {
    return []; // wrong key / corrupt, ignore rather than break unlock
  }
}

async function persistExtraOtks(masterKey: Uint8Array, list: PreKey[]): Promise<void> {
  const arr: ExtraOtkJson[] = list.map((p) => ({
    id: p.id,
    pub: bytesToB64url(p.keypair.publicKey),
    priv: bytesToB64url(p.keypair.privateKey),
  }));
  await put<ExtraOtkRecord>('keystore', { id: 'otk-extra', sealed: sealJson(masterKey, arr, 'otk') });
}

/**
 * Generate `count` fresh one-time prekeys, persist their private halves under the
 * master key (so they survive lock/reload and the X3DH responder can use them),
 * and return the public halves to upload to the server. Requires unlock.
 */
export async function replenishOneTimePreKeys(count: number): Promise<{ id: string; pub: string }[]> {
  const b = requireUnlocked();
  if (count <= 0) return [];
  const fresh: PreKey[] = [];
  for (let i = 0; i < count; i++) fresh.push({ id: uid(), keypair: x25519Keypair() });
  b.oneTimePreKeys.push(...fresh); // usable immediately this session
  const existing = await loadExtraOtks(b.masterKey);
  await persistExtraOtks(b.masterKey, [...existing, ...fresh]); // durable for future sessions
  return fresh.map((p) => ({ id: p.id, pub: bytesToB64url(p.keypair.publicKey) }));
}

export async function getPublicBundle(): Promise<PublicBundle | null> {
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  return rec?.publicBundle ?? null;
}

/** The stored recovery wrap (salt + sealed envelope) for upload to the backend,
 *  so a reinstalled/new device can restore via the recovery code. Readable
 *  without unlocking (it's sealed under the recovery code, not the PIN). */
export async function getRecoveryWrapForUpload(): Promise<{ salt: string; envelope: Envelope; lookup: string } | null> {
  const rec = await get<KeystoreRecord>('keystore', 'identity');
  if (!rec) return null;
  return { salt: rec.recoverySalt, envelope: rec.recoveryWrapped, lookup: rec.recoveryLookup ?? '' };
}

/**
 * Build the proof for new-device restore: unwrap the fetched recovery wrap with
 * the typed `code` (throws if it doesn't match), then sign the server's challenge
 * with the recovered identity key. Returns the recovered core (to install under a
 * new passcode) and the b64url signature (to send to /v1/recovery/complete).
 */
export function buildRecoveryProof(
  env: Envelope,
  saltB64: string,
  code: string,
  challengeB64: string,
): { core: RecoveredCore; signature: string } {
  const core = unwrapRecovery(env, saltB64, normalizeRecoveryCode(code));
  const signature = bytesToB64url(sign(core.ed.privateKey, b64urlToBytes(challengeB64)));
  return { core, signature };
}

export function fingerprint(): string {
  return fingerprintOf(requireUnlocked());
}

/**
 * Restore identity + master key from a recovery code (used on a new device once
 * the wrap blob is fetched from the server, backend). Returns the recovered
 * material; the caller re-wraps it under a fresh PIN.
 */
export function restoreWithRecovery(
  rec: Pick<KeystoreRecord, 'recoveryWrapped' | 'recoverySalt'>,
  code: string,
): { ed: KeyPair; x: KeyPair; masterKey: Uint8Array } {
  return unwrapRecovery(rec.recoveryWrapped, rec.recoverySalt, code);
}

export { utf8ToBytes };
