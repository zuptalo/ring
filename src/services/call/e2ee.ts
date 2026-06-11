/**
 * End-to-end media encryption for group calls via WebRTC Insertable Streams.
 *
 * The SFU forwards RTP it cannot read: clients add an AES-GCM layer to each
 * encoded media frame *under* SRTP. The SFU still sees RTP headers (for routing)
 * but the frame payload is opaque. Frame layout we write:
 *
 *     [ epoch:6 ][ iv:12 ][ AES-GCM ciphertext+tag ]
 *
 * The group media key is distributed peer-to-peer over the E2EE message channel
 * (services/call/groupkey) and never reaches the server.
 *
 * Uses the Chromium `createEncodedStreams` API (main-thread). Browsers without
 * it (Safari/Firefox use the standard RTCRtpScriptTransform worker API) are
 * gated out of group calls. 1:1 calls, natively E2EE via DTLS-SRTP, work
 * everywhere.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { EPOCH_BYTES, HEADER, writeEpoch, readEpoch } from './e2ee-format';

/** Which encoded-frame transform API this browser exposes for per-frame E2EE:
 *  'insertable' = Chromium's createEncodedStreams (main thread); 'script' = the
 *  standard worker-based RTCRtpScriptTransform (Safari/iOS 15.4+, modern Chrome).
 *  We prefer 'insertable' where present so the established Chromium path is unchanged,
 *  and fall back to 'script' (which is what enables iOS). Both emit identical frames,
 *  so a mix of clients interoperate in one call. */
export function getTransformAPI(): 'insertable' | 'script' | null {
  if (typeof RTCRtpSender === 'undefined') return null;
  if (
    typeof (RTCRtpSender.prototype as any).createEncodedStreams === 'function' &&
    typeof (RTCRtpReceiver.prototype as any).createEncodedStreams === 'function'
  ) {
    return 'insertable';
  }
  if (typeof (globalThis as any).RTCRtpScriptTransform === 'function' && 'transform' in RTCRtpSender.prototype) {
    return 'script';
  }
  return null;
}

/** Whether this browser can run encrypted group calls (either transform API). */
export function supportsMediaE2EE(): boolean {
  return getTransformAPI() !== null;
}

/** Per-call key set, addressable by epoch (so rekeys overlap cleanly). */
export class Keyring {
  private keys = new Map<number, CryptoKey>();
  /** Epoch used for *encrypting* outbound frames (the latest known). */
  current = -1;

  async set(epoch: number, raw: Uint8Array): Promise<void> {
    const key = await crypto.subtle.importKey(
      'raw',
      raw as unknown as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
    this.keys.set(epoch, key);
    if (epoch > this.current) this.current = epoch;
  }

  get(epoch: number): CryptoKey | undefined {
    return this.keys.get(epoch);
  }

  currentKey(): CryptoKey | undefined {
    return this.current >= 0 ? this.keys.get(this.current) : undefined;
  }
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export const keyToB64 = b64;
export const keyFromB64 = unb64;

// The frame layout (6-byte epoch + 12-byte IV + AES-GCM ciphertext) lives in the
// shared e2ee-format module so the insertable-streams path here and the worker
// (RTCRtpScriptTransform) path emit byte-identical frames and interoperate.

/** Encrypt transform: AES-GCM the whole encoded payload with the current key. */
function encryptTransform(keyring: Keyring) {
  return async (chunk: any, controller: TransformStreamDefaultController): Promise<void> => {
    const key = keyring.currentKey();
    if (!key) {
      // No key yet (haven't received it); drop the frame rather than leak
      // plaintext to the SFU. Resolves once the key arrives.
      return;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, chunk.data));
    const out = new Uint8Array(HEADER + ct.length);
    writeEpoch(out, keyring.current);
    out.set(iv, EPOCH_BYTES);
    out.set(ct, HEADER);
    chunk.data = out.buffer;
    controller.enqueue(chunk);
  };
}

/** Decrypt transform: select the key by epoch and AES-GCM-open the frame. Calls
 *  onMissingKey(epoch) (so the session can request a resend) when we lack the key. */
function decryptTransform(
  keyring: Keyring,
  onMissingKey?: (epoch: number) => void,
  onDecrypt?: (ok: boolean) => void, // DIAG(call-video): per-frame ok/fail tally
) {
  return async (chunk: any, controller: TransformStreamDefaultController): Promise<void> => {
    const data = new Uint8Array(chunk.data);
    if (data.length < HEADER) return; // too short to be a valid frame
    const epoch = readEpoch(data);
    const key = keyring.get(epoch);
    if (!key) {
      onMissingKey?.(epoch); // haven't received this epoch's key, ask the master
      return;
    }
    const iv = data.subarray(EPOCH_BYTES, HEADER);
    const ct = data.subarray(HEADER);
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      chunk.data = pt;
      controller.enqueue(chunk);
      onDecrypt?.(true);
    } catch {
      /* undecryptable (wrong/rotated key, or corrupted ciphertext), drop */
      onDecrypt?.(false);
    }
  };
}

/** Wire AES-GCM encryption onto an outbound RTP sender. */
export function attachSenderE2EE(sender: RTCRtpSender, keyring: Keyring): void {
  const streams = (sender as any).createEncodedStreams();
  streams.readable
    .pipeThrough(new TransformStream({ transform: encryptTransform(keyring) }))
    .pipeTo(streams.writable);
}

/** Wire AES-GCM decryption onto an inbound RTP receiver. */
export function attachReceiverE2EE(
  receiver: RTCRtpReceiver,
  keyring: Keyring,
  onMissingKey?: (epoch: number) => void,
  onDecrypt?: (kind: string, ok: boolean) => void, // DIAG(call-video)
): void {
  const streams = (receiver as any).createEncodedStreams();
  const kind = receiver.track?.kind ?? '?';
  streams.readable
    .pipeThrough(
      new TransformStream({ transform: decryptTransform(keyring, onMissingKey, (ok) => onDecrypt?.(kind, ok)) }),
    )
    .pipeTo(streams.writable);
}
