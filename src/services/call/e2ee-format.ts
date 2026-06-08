/**
 * The on-wire encrypted-frame format for group-call media E2EE, shared by the
 * main-thread insertable-streams path (e2ee.ts, Chromium) and the worker-based
 * RTCRtpScriptTransform path (e2ee-worker.ts, Safari/iOS). Keeping the layout in one
 * place guarantees the two paths produce byte-identical frames, so a Chromium client
 * and an iOS client interoperate in the same E2EE call:
 *
 *     [ epoch:6 (48-bit big-endian) ][ iv:12 ][ AES-GCM ciphertext+tag ]
 */

// 48-bit epoch (Date.now()-based, globally monotonic, never collides on a key-master
// handover) + 12-byte AES-GCM IV.
export const EPOCH_BYTES = 6;
export const HEADER = EPOCH_BYTES + 12;

export function writeEpoch(buf: Uint8Array, epoch: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, EPOCH_BYTES);
  view.setUint16(0, Math.floor(epoch / 0x100000000) & 0xffff); // high 16 bits
  view.setUint32(2, epoch >>> 0); // low 32 bits
}

export function readEpoch(buf: Uint8Array): number {
  const view = new DataView(buf.buffer, buf.byteOffset, EPOCH_BYTES);
  return view.getUint16(0) * 0x100000000 + view.getUint32(2);
}
