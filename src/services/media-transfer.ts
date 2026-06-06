/**
 * Media E2EE transfer pipeline.
 *
 * Media never goes over the WebSocket and the server never sees plaintext:
 *   1. Encrypt the blob with a random per-file key (AEAD).
 *   2. Upload the CIPHERTEXT to a blob endpoint, getting a blobId.   [backend]
 *   3. Put the per-file key + reference into the message payload, which is
 *      itself sealed by the ratchet/sender-key, so the key is protected by the
 *      message encryption (no separate wrap needed).
 * On receive: decrypt the message → get {blobId, fileKey} → download ciphertext
 * → decrypt → store the plaintext blob locally.
 *
 * The plaintext blob always stays on-device (the `media` store); ciphertext
 * only ever exists in transit / at rest on the server. The blob client here is
 * an in-memory mock standing in for the real HTTP `/blobs` endpoint.
 */
import { randomBytes, aeadSeal, aeadOpen, KEY_BYTES } from './crypto/primitives';
import { packBlob, unpackBlob, bytesToB64url, b64urlToBytes } from './crypto/envelope';
import type { MediaRef } from './crypto/message';
import { apiBaseUrl } from './config';
import { getToken } from './auth';
import { fetchServerConfig } from './api';

/** An upload that failed with an HTTP status (so callers can distinguish a
 *  permanent 413 "too large" from a transient/network failure worth retrying). */
export class BlobUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BlobUploadError';
  }
}

/** The server's per-upload cap (bytes), fetched once + cached. Falls back to the
 *  server's own default (256 MiB) when /config is briefly unreachable. */
const DEFAULT_MAX_BLOB_BYTES = 256 * 1024 * 1024;
let cachedMaxBlobBytes: number | null = null;
export async function getMaxBlobBytes(): Promise<number> {
  if (cachedMaxBlobBytes != null) return cachedMaxBlobBytes;
  try {
    const { maxBlobBytes } = await fetchServerConfig();
    cachedMaxBlobBytes = maxBlobBytes && maxBlobBytes > 0 ? maxBlobBytes : DEFAULT_MAX_BLOB_BYTES;
  } catch {
    cachedMaxBlobBytes = DEFAULT_MAX_BLOB_BYTES; // don't block a send on a config hiccup
  }
  return cachedMaxBlobBytes;
}

// The DOM Blob constructor types want ArrayBufferView<ArrayBuffer>; libsodium's
// Uint8Array is generic over ArrayBufferLike. The bytes are a real ArrayBuffer
// at runtime, so this bridge is safe.
const part = (b: Uint8Array): BlobPart => b as unknown as BlobPart;

/* ---- per-file encryption ---- */

export async function encryptBlob(blob: Blob): Promise<{ ciphertext: Blob; fileKey: Uint8Array }> {
  const plain = new Uint8Array(await blob.arrayBuffer());
  const fileKey = randomBytes(KEY_BYTES);
  const { nonce, ct } = aeadSeal(fileKey, plain);
  const packed = packBlob(nonce, ct);
  return { ciphertext: new Blob([part(packed)], { type: 'application/octet-stream' }), fileKey };
}

export async function decryptBlob(ciphertext: Blob, fileKey: Uint8Array, mime: string): Promise<Blob> {
  const packed = new Uint8Array(await ciphertext.arrayBuffer());
  const { nonce, ct } = unpackBlob(packed);
  const plain = aeadOpen(fileKey, nonce, ct); // throws if key wrong / tampered
  return new Blob([part(plain)], { type: mime });
}

/* ---- blob store (backend: HTTP /v1/blobs) ---- */

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Upload ciphertext to the backend, returns an opaque blob id. Uses XHR so we
 *  can report upload progress (0..1), since fetch can't observe the request body. */
export function uploadBlob(ciphertext: Blob, onProgress?: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBaseUrl()}/v1/blobs`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Don't hang forever on a stalled connection; fail so the job can retry. Scale
    // the budget with size (~1 Mbps floor) so a large attachment on a slow uplink
    // isn't cut off mid-upload (which would burn a retry), capped at 10 minutes.
    const mib = Math.ceil(ciphertext.size / (1024 * 1024));
    xhr.timeout = Math.min(600_000, Math.max(120_000, mib * 8_000));
    if (onProgress) {
      onProgress(0); // show the upload bar immediately (some browsers emit no early event)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((JSON.parse(xhr.responseText) as { blobId: string }).blobId);
        } catch {
          reject(new Error('upload blob: bad response'));
        }
      } else {
        // Carry the status so the caller can treat 413 (too large) as permanent
        // (no point retrying) versus a transient 5xx/network failure.
        reject(new BlobUploadError(`upload blob failed: ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error('upload blob: network error'));
    xhr.ontimeout = () => reject(new Error('upload blob: timed out'));
    xhr.send(ciphertext);
  });
}

/** Download ciphertext by id from the backend, or null if absent (404). */
export async function downloadBlob(blobId: string): Promise<Blob | null> {
  const res = await fetch(`${apiBaseUrl()}/v1/blobs/${encodeURIComponent(blobId)}`, {
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`download blob failed: ${res.status}`);
  return res.blob();
}

/* ---- high-level pipeline ---- */

/** Encrypt + upload a blob; returns the reference to embed in the (sealed) message. */
export async function prepareOutgoingMedia(
  blob: Blob,
  name: string,
  durationSec?: number,
  extra?: { width?: number; height?: number; poster?: string; quality?: string },
  onUploadProgress?: (p: number) => void,
): Promise<MediaRef> {
  const { ciphertext, fileKey } = await encryptBlob(blob);
  const blobId = await uploadBlob(ciphertext, onUploadProgress);
  return {
    blobId,
    fileKey: bytesToB64url(fileKey),
    mime: blob.type || 'application/octet-stream',
    size: blob.size,
    name,
    durationSec,
    width: extra?.width,
    height: extra?.height,
    poster: extra?.poster,
    quality: extra?.quality,
  };
}

/** Download + decrypt the media a message refers to; null if the blob is gone. */
export async function receiveIncomingMedia(ref: MediaRef): Promise<Blob | null> {
  const ciphertext = await downloadBlob(ref.blobId);
  if (!ciphertext) return null;
  return decryptBlob(ciphertext, b64urlToBytes(ref.fileKey), ref.mime);
}
