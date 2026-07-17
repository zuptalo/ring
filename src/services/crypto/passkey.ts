/**
 * Passkey unlock via WebAuthn PRF (pure PWA, no Capacitor / native bridge).
 *
 * WHY THIS SHAPE
 * The keystore is unlocked by *deriving* a key from the PIN (Argon2id), not by a
 * password check. A plain WebAuthn assertion only yields a signature, so it
 * cannot decrypt anything on its own. The PRF extension (the WebAuthn surfacing
 * of the authenticator's `hmac-secret`) returns a stable 32-byte secret, but only
 * after the passkey's user-verification step. That secret is real key material.
 *
 * So passkey unlock is a strictly-additive *convenience layer over the PIN*:
 *   enroll : derive a key from the PRF output, seal the (already-verified) PIN
 *            under it, persist the sealed blob + credential id locally.
 *   unlock : passkey assertion, PRF output, unseal the PIN, then hand it to the
 *            existing identity.unlock(pin) path (which also merges replenished
 *            one-time prekeys, etc.).
 *
 * The PIN therefore remains the source of truth; the passkey never replaces it
 * and never replaces the recovery code. Disabling just deletes the local blob.
 *
 * PROVIDER NOTE
 * We do NOT pin authenticatorAttachment: the platform's own passkey UI then
 * offers every provider, the device authenticator, iCloud Keychain / Apple
 * Passwords, and password managers (e.g. Bitwarden) via the desktop extension or
 * iOS autofill. Whichever provider is chosen must support the PRF extension; if
 * it doesn't, enroll returns 'prf-unsupported' and the caller falls back to PIN.
 */
import { ready, randomBytes, hkdf, KEY_BYTES } from './primitives';
import { sealJson, openJson, bytesToB64url, b64urlToBytes, utf8ToBytes, type Envelope } from './envelope';
import { verifyPin, unlock as unlockIdentity } from './identity';
import { get, put, remove } from '@/db/idb';

/* ---- persisted passkey record (keystore store, id: 'biometric') ---- */

interface PasskeyRecord {
  id: 'biometric'; // stable store key (kept from the original biometric record)
  createdAt: number;
  credentialId: string; // b64url raw credential id, feeds allowCredentials on unlock
  prfSalt: string; // b64url PRF eval input; MUST be identical on enroll & unlock
  hkdfSalt: string; // b64url domain-separation salt for HKDF over the PRF output
  wrapped: Envelope; // the PIN, sealed under the PRF-derived key
}

const RECORD_ID = 'biometric';
const HKDF_INFO = utf8ToBytes('ring-webauthn-prf-unlock-v1');

/* ---- capability detection ---- */

/** WebAuthn present (needed for the passkey path). PRF support itself can only be
 *  confirmed by actually enrolling (see enrollPasskey's return value). */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof navigator.credentials?.create === 'function'
  );
}

/** Whether a passkey credential has been enrolled on this device. */
export async function isPasskeyEnrolled(): Promise<boolean> {
  return !!(await get<PasskeyRecord>('keystore', RECORD_ID));
}

/* ---- WebAuthn plumbing ---------------------------------------------------- */

// The DOM lib types don't yet describe the PRF extension; type the slice we use.
interface PrfExtOutput {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

// libsodium returns Uint8Array<ArrayBufferLike>; the DOM's BufferSource wants a
// plain ArrayBuffer. Copy out the exact bytes so WebAuthn accepts our buffers.
function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function rpId(): string {
  // Passkeys are scoped to the RP id; the page origin must be a registrable
  // suffix of it. hostname is the safe default (works on localhost and the
  // deployed origin alike).
  return window.location.hostname;
}

function prfSecretFrom(extOut: PrfExtOutput): Uint8Array | null {
  const first = extOut.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

/** HKDF the 32-byte PRF output into the AEAD key that seals/opens the PIN. */
function deriveWrapKey(prfSecret: Uint8Array, hkdfSalt: Uint8Array): Uint8Array {
  return hkdf(prfSecret, KEY_BYTES, hkdfSalt, HKDF_INFO);
}

/* ---- enroll --------------------------------------------------------------- */

export type EnrollResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-pin' | 'prf-unsupported' | 'user-cancelled' | 'error'; message?: string };

/**
 * Enroll this device for passkey unlock. Must be called with a PIN that is already
 * known-good (e.g. immediately after a successful create/unlock); it is re-verified
 * here defensively. Creating the credential prompts the passkey provider once.
 * Returns ok:false with a reason instead of throwing for the expected failure
 * modes so the UI can react (notably 'prf-unsupported').
 */
export async function enrollPasskey(pin: string): Promise<EnrollResult> {
  await ready();
  if (!isWebAuthnAvailable()) return { ok: false, reason: 'prf-unsupported' };
  if (!(await verifyPin(pin))) return { ok: false, reason: 'wrong-pin' };

  const prfSalt = randomBytes(32);
  const hkdfSalt = randomBytes(KEY_BYTES);

  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: ab(randomBytes(32)), // not server-verified, see file header
        rp: { id: rpId(), name: 'Ring' },
        user: { id: ab(randomBytes(16)), name: 'ring-device', displayName: 'Ring device' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          // No authenticatorAttachment: let the platform's passkey UI offer every
          // provider (device, iCloud Keychain, password managers). Managers store
          // discoverable passkeys, so prefer a resident key.
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt } } } as unknown as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return { ok: false, reason: 'error', message: 'no credential returned' };

    const credentialId = new Uint8Array(cred.rawId);
    const createExt = cred.getClientExtensionResults() as PrfExtOutput;

    // Some providers return the PRF output during create(); others only report
    // prf.enabled and require a follow-up get() to actually produce it.
    let prfSecret = prfSecretFrom(createExt);
    if (!prfSecret) {
      if (createExt.prf?.enabled === false) return { ok: false, reason: 'prf-unsupported' };
      prfSecret = await evaluatePrf(credentialId, prfSalt);
    }
    if (!prfSecret) return { ok: false, reason: 'prf-unsupported' };

    const wrapKey = deriveWrapKey(prfSecret, hkdfSalt);
    const record: PasskeyRecord = {
      id: RECORD_ID,
      createdAt: Date.now(),
      credentialId: bytesToB64url(credentialId),
      prfSalt: bytesToB64url(prfSalt),
      hkdfSalt: bytesToB64url(hkdfSalt),
      wrapped: sealJson(wrapKey, pin, 'passkey-pin'),
    };
    await put('keystore', record);
    return { ok: true };
  } catch (e) {
    return { ok: false, ...classify(e) };
  }
}

/* ---- unlock --------------------------------------------------------------- */

export type PasskeyUnlockResult =
  | { ok: true }
  | { ok: false; reason: 'not-enrolled' | 'prf-unsupported' | 'user-cancelled' | 'stale' | 'error'; message?: string };

/**
 * Prompt the passkey, recover the PIN, and unlock the identity keystore. On
 * 'stale' the sealed PIN no longer opens the keystore (e.g. the PIN was changed
 * via recovery); the caller should drop the enrollment and fall back to the PIN.
 */
export async function unlockWithPasskey(): Promise<PasskeyUnlockResult> {
  await ready();
  const rec = await get<PasskeyRecord>('keystore', RECORD_ID);
  if (!rec) return { ok: false, reason: 'not-enrolled' };

  try {
    const prfSecret = await evaluatePrf(b64urlToBytes(rec.credentialId), b64urlToBytes(rec.prfSalt));
    if (!prfSecret) return { ok: false, reason: 'prf-unsupported' };

    const wrapKey = deriveWrapKey(prfSecret, b64urlToBytes(rec.hkdfSalt));
    let pin: string;
    try {
      pin = openJson<string>(wrapKey, rec.wrapped); // AEAD fails if the key is wrong
    } catch {
      return { ok: false, reason: 'error', message: 'could not decrypt stored PIN' };
    }

    if (!(await verifyPin(pin))) {
      await disablePasskey(); // the PIN changed under us; this enrollment is dead
      return { ok: false, reason: 'stale' };
    }
    await unlockIdentity(pin);
    return { ok: true };
  } catch (e) {
    return { ok: false, ...classify(e) };
  }
}

/** Run a PRF assertion against a known credential; returns the PRF output (or
 *  null if the provider didn't produce one, i.e. PRF unsupported). */
async function evaluatePrf(credentialId: Uint8Array, prfSalt: Uint8Array): Promise<Uint8Array | null> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: ab(randomBytes(32)),
      rpId: rpId(),
      allowCredentials: [{ type: 'public-key', id: ab(credentialId) }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as unknown as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) return null;
  return prfSecretFrom(assertion.getClientExtensionResults() as PrfExtOutput);
}

/* ---- disable -------------------------------------------------------------- */

/** Remove passkey unlock from this device (deletes the sealed PIN blob). The
 *  passkey itself lives in the provider's store; the user can delete it there. */
export async function disablePasskey(): Promise<void> {
  await remove('keystore', RECORD_ID);
}

/* ---- error classification ------------------------------------------------- */

function classify(e: unknown): { reason: 'user-cancelled' | 'error'; message?: string } {
  if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
    return { reason: 'user-cancelled' };
  }
  return { reason: 'error', message: e instanceof Error ? e.message : String(e) };
}
