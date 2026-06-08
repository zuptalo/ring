/**
 * Save chat media to the device.
 *
 * Ring is a pure PWA (no Capacitor / native Photos or Files access), so we save
 * via the Web Share sheet when the platform supports sharing files - on iOS that
 * surfaces "Save Image" / "Save Video" / "Save to Files", which is the only way to
 * land a photo in the Photos library from a web app. Where file-sharing isn't
 * available (most desktops, some Androids) we fall back to a direct download, which
 * the OS routes to its Downloads / Files location. Documents and any non-media take
 * the same path (the share sheet's "Save to Files", else a download).
 */
import { getMessage, downloadMessageMedia } from '@/db/queries';
import { get } from '@/db/idb';
import type { Media } from '@/db/types';

export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'empty';

function fallbackName(mime: string, at: number): string {
  const ext = mime.includes('/') ? mime.split('/')[1].split(';')[0] : 'bin';
  return `ring-${at}.${ext}`;
}

// Resolve a message's decrypted media into a File, downloading it first if it was
// only kept as a deferred reference (e.g. a not-yet-fetched video). Returns null for
// messages with no saveable media.
async function fileForMessage(id: string): Promise<File | null> {
  let m = await getMessage(id);
  if (!m) return null;
  if (!m.mediaId && m.pendingMedia) {
    try {
      await downloadMessageMedia(id);
    } catch {
      return null;
    }
    m = await getMessage(id);
  }
  if (!m?.mediaId) return null;
  const media = await get<Media>('media', m.mediaId);
  if (!media?.blob) return null;
  const type = media.mime || media.blob.type || 'application/octet-stream';
  const name = media.name || fallbackName(type, media.updatedAt || m.timestamp);
  return new File([media.blob], name, { type });
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Save the media of one or more messages to the device (a single image/video/file,
 * or a whole album when several ids are passed). Returns how it was handled so the
 * caller can show the right confirmation.
 */
export async function saveMessagesMedia(ids: string[]): Promise<SaveResult> {
  const files: File[] = [];
  for (const id of ids) {
    const f = await fileForMessage(id);
    if (f) files.push(f);
  }
  if (!files.length) return 'empty';

  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files })) {
    try {
      await nav.share({ files });
      return 'shared';
    } catch (e) {
      // User dismissed the share sheet: respect that, don't also download.
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // Any other failure (e.g. share unsupported for this set) -> fall back.
    }
  }
  for (const f of files) downloadFile(f);
  return 'downloaded';
}
