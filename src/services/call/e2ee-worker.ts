/**
 * Group-call media E2EE worker for the STANDARD RTCRtpScriptTransform API (Safari /
 * iOS 15.4+, and modern Chrome). It runs the same AES-GCM per-frame transform as the
 * main-thread insertable-streams path (e2ee.ts) using the shared frame format
 * (e2ee-format.ts), so an iOS client interoperates with a Chromium client in the
 * same encrypted group call - the SFU forwards opaque [epoch|iv|ciphertext] either
 * way.
 *
 * Keys arrive from the main thread via postMessage (raw bytes per epoch); they never
 * leave the device. The worker holds its own key set. A frame for an epoch we lack a
 * key for is dropped and a 'missing' message is posted back so the session can ask
 * the key master to resend.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference lib="webworker" />
import { EPOCH_BYTES, HEADER, writeEpoch, readEpoch } from './e2ee-format';

const keys = new Map<number, CryptoKey>();
let current = -1;

async function setKey(epoch: number, raw: Uint8Array): Promise<void> {
  const key = await crypto.subtle.importKey('raw', raw as unknown as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  keys.set(epoch, key);
  if (epoch > current) current = epoch;
}

async function encrypt(chunk: any, controller: TransformStreamDefaultController): Promise<void> {
  const key = current >= 0 ? keys.get(current) : undefined;
  if (!key) return; // no key yet → drop rather than leak plaintext
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, chunk.data));
  const out = new Uint8Array(HEADER + ct.length);
  writeEpoch(out, current);
  out.set(iv, EPOCH_BYTES);
  out.set(ct, HEADER);
  chunk.data = out.buffer;
  controller.enqueue(chunk);
}

async function decrypt(chunk: any, controller: TransformStreamDefaultController): Promise<void> {
  const data = new Uint8Array(chunk.data);
  if (data.length < HEADER) return;
  const epoch = readEpoch(data);
  const key = keys.get(epoch);
  if (!key) {
    (self as any).postMessage({ type: 'missing', epoch }); // ask the session to resend
    return;
  }
  const iv = data.subarray(EPOCH_BYTES, HEADER);
  const ct = data.subarray(HEADER);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    chunk.data = pt;
    controller.enqueue(chunk);
  } catch {
    /* wrong/rotated key → drop */
  }
}

// Main thread → worker: key updates (raw bytes per epoch).
self.onmessage = (e: MessageEvent): void => {
  const m = e.data;
  if (m?.type === 'key' && typeof m.epoch === 'number' && m.raw) {
    void setKey(m.epoch, new Uint8Array(m.raw as ArrayBuffer));
  }
};

// Per-transform entry point: pipe the encoded frames through encrypt or decrypt,
// chosen by the `operation` we passed when constructing the RTCRtpScriptTransform.
(self as any).onrtctransform = (event: any): void => {
  const t = event.transformer;
  const fn = t.options?.operation === 'encrypt' ? encrypt : decrypt;
  void t.readable.pipeThrough(new TransformStream({ transform: fn })).pipeTo(t.writable);
};
