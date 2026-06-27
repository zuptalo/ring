/**
 * Auto-save received media to the device ("Save to Photos", `chats.saveToPhotos`).
 *
 * Ring is a pure PWA. There is no web API to silently write to the OS photo library
 * without a user gesture (the Web Share "Save Image" sheet needs a tap), so the best
 * a web app can do automatically is trigger a download, which the OS routes to its
 * Downloads/Files location. We therefore only act when:
 *   (a) the app is in the FOREGROUND — a programmatic download needs a focused
 *       document and is otherwise blocked; and
 *   (b) the media JUST arrived — never a historical backlog draining on app reopen,
 *       which would dump dozens of files at once.
 * On iOS without a gesture this is effectively a no-op; that's the honest ceiling of
 * a PWA, and the per-message "Save" action (media-save.ts) remains for manual saves.
 */
import { get } from '@/db/idb';

interface SettingRow<T> {
  key: string;
  value: T;
}
async function setting<T>(key: string, fallback: T): Promise<T> {
  const s = await get<SettingRow<T>>('settings', key);
  return s ? s.value : fallback;
}

// Only treat media that arrived within this window as "fresh" — older items are a
// backlog being drained on app reopen and must not trigger a flood of downloads.
const FRESH_MS = 2 * 60 * 1000;

export async function autoSaveIncomingMedia(opts: {
  blob: Blob;
  kind: string;
  mime: string;
  name: string;
  sentAt: number;
}): Promise<void> {
  try {
    if (opts.kind !== 'image' && opts.kind !== 'video') return; // photos & videos only
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    if (Date.now() - opts.sentAt > FRESH_MS) return; // skip the reopen backlog
    if (!(await setting<boolean>('chats.saveToPhotos', false))) return;

    const ext = (opts.mime.split('/')[1] || 'bin').split(';')[0];
    const name = opts.name || `ring-${opts.sentAt}.${ext}`;
    const file = new File([opts.blob], name, { type: opts.mime || opts.blob.type });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    console.warn('[autosave] failed to save incoming media', e);
  }
}
