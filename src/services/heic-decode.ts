/**
 * (spec 2050) Lazy wrapper around the wasm HEIC/HEIF decoder (heic2any, MIT).
 *
 * Dynamically imported so the ~wasm decoder loads ONLY when a HEIC image is actually
 * sent — no cost to the main bundle for everyone else. Runs entirely on-device (no
 * network), so the zero-knowledge boundary is intact. Converts to JPEG, which every
 * target browser can render (raw HEIC renders only on Safari).
 *
 * Throws on a genuine decode failure so the caller fails the send honestly rather than
 * uploading raw HEIC that most recipients couldn't view.
 */
export async function decodeHeicToJpeg(blob: Blob, quality = 0.9): Promise<Blob> {
  const heic2any = (await import('heic2any')).default;
  const out = await heic2any({ blob, toType: 'image/jpeg', quality });
  const result = Array.isArray(out) ? out[0] : out;
  if (!(result instanceof Blob) || result.size === 0) {
    throw new Error('HEIC decode produced no image');
  }
  return result;
}
