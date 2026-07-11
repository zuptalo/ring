/**
 * Turn a getUserMedia / MediaRecorder failure into a plain-language sentence the user
 * can act on.
 *
 * Every mic/camera acquisition in the app used to swallow the DOMException in a bare
 * `catch {}` and show a flat "Microphone unavailable", which hid the one thing the user
 * actually needs to know: WHY. On Android especially, the common cause is that the
 * installed app's microphone permission is switched off at the OS level — the web layer
 * can't grant that; only the user can, in device/browser settings. A generic "unavailable"
 * gives them nowhere to go. This branches on the standard DOMException `name`
 * (see MDN: MediaDevices.getUserMedia exceptions) to name the fix.
 */
export type MediaKind = 'microphone' | 'camera' | 'media';

function errName(err: unknown): string {
  if (err instanceof DOMException) return err.name;
  if (err && typeof err === 'object' && 'name' in err) return String((err as { name: unknown }).name);
  return '';
}

export function describeMediaError(err: unknown, kind: MediaKind = 'microphone'): string {
  // Capitalised subject for sentence starts, lowercase for mid-sentence.
  const Subject = kind === 'camera' ? 'Camera' : kind === 'media' ? 'Camera or microphone' : 'Microphone';
  const subject = kind === 'camera' ? 'camera' : kind === 'media' ? 'camera and microphone' : 'microphone';
  switch (errName(err)) {
    case 'NotAllowedError':
    case 'SecurityError':
      // Permission denied. On an installed Android PWA this is usually the app's OS-level
      // mic/camera permission being off — not something the page can re-request silently.
      return `${Subject} access is blocked. Allow ${subject} for Ring in your device and browser settings, then try again.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${subject === 'camera and microphone' ? 'camera or microphone' : subject} was found on this device.`;
    case 'NotReadableError':
    case 'AbortError':
      // The device exists but another app (or a stuck tab) is holding it.
      return `Your ${subject === 'camera and microphone' ? 'camera or microphone' : subject} is in use by another app. Close it and try again.`;
    default:
      return `${Subject} unavailable. Check that Ring has permission to use it.`;
  }
}
