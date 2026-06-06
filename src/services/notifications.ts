/**
 * Push notification permission (Web Notifications API).
 *
 * This is the browser/PWA permission prompt. On a grant we also register the
 * device's push subscription with the backend (see services/push.ts).
 */
import { applyPushPreference } from './push';

export type PermissionState = NotificationPermission | 'unsupported';

/** Current permission without prompting. */
export function currentPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** True once the user has made a choice (granted or denied) or it's unsupported. */
export function isPermissionDecided(): boolean {
  const p = currentPermission();
  return p !== 'default';
}

/** Prompt the user. Resolves with the resulting state. On a grant, registers a
 *  push subscription with the backend. */
export async function requestPushPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') void applyPushPreference(true);
    return result;
  } catch {
    return 'denied';
  }
}
