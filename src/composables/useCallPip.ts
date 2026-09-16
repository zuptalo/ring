/**
 * Picture-in-Picture for an ongoing video call, so the call keeps showing in an
 * OS-level floating window when the PWA is sent to the background, with the browser's
 * native "back to tab" control to return.
 *
 * Driven from a single, globally-persistent <video> (owned by CallMediaSink) that
 * always carries the primary remote feed, so PiP works from any screen - full call,
 * minimized, or anywhere in the app - and survives navigation.
 *
 * Two entry paths, since browsers differ:
 *  - Auto on background: registered via the mediaSession `enterpictureinpicture`
 *    action, which installed PWAs (Chromium) invoke automatically when the tab hides.
 *  - Manual: `toggleCallPip()` from a user gesture (a button), reliable wherever PiP is
 *    supported. We also make a best-effort attempt on visibilitychange.
 * All attempts are guarded + swallow errors, since PiP can be unavailable (iOS PWAs,
 * permission/gesture rules) - it's an enhancement, never required for the call.
 */
import { ref } from 'vue';
import { callState, callMeta } from '@/composables/useCall';

const ACTIVE = ['dialing', 'remote-ringing', 'connecting', 'connected'];

// The persistent source <video> (set by CallMediaSink) and whether PiP is currently on.
let sourceVideo: HTMLVideoElement | null = null;
export const pipActive = ref(false);

/** Whether the browser exposes Picture-in-Picture at all. */
export function pipSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    // pictureInPictureEnabled is false when disabled by policy; absent on iOS PWAs.
    (document as unknown as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true
  );
}

function inVideoCall(): boolean {
  return ACTIVE.includes(callState.value) && callMeta.value?.kind === 'video';
}

async function enter(): Promise<void> {
  const el = sourceVideo as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
  if (!el || !el.requestPictureInPicture || !pipSupported()) return;
  if (document.pictureInPictureElement || !inVideoCall()) return;
  // The element must be playing with a frame ready or the request rejects.
  if (el.readyState < 2) {
    try {
      await el.play();
    } catch {
      /* autoplay/gesture rules - the manual button path will still work */
    }
  }
  try {
    await el.requestPictureInPicture();
  } catch {
    /* needs a user gesture, or unsupported - ignore */
  }
}

async function exit(): Promise<void> {
  const doc = document as unknown as { pictureInPictureElement?: Element; exitPictureInPicture?: () => Promise<void> };
  if (doc.pictureInPictureElement && doc.exitPictureInPicture) {
    try {
      await doc.exitPictureInPicture();
    } catch {
      /* ignore */
    }
  }
}

/** Toggle PiP from a user gesture (a button). */
export async function toggleCallPip(): Promise<void> {
  if (document.pictureInPictureElement) await exit();
  else await enter();
}

function onVisibility(): void {
  // Best-effort auto-PiP when the app is hidden during a video call (works where the
  // browser allows it without a gesture; the mediaSession action covers installed PWAs).
  if (document.hidden && inVideoCall()) void enter();
}

// Two separate latches on purpose. The document/mediaSession wiring belongs to the
// app and is done once; the enter/leave listeners belong to the ELEMENT and can only
// be attached once there is one. A single `wired` flag conflated them: called with a
// null video (a ref not yet populated, a remount ordering change) it latched anyway,
// and no later call could ever attach the element listeners — PiP would still open
// but `pipActive` would never flip, so the UI would show the wrong state forever.
let appWired = false;
let wiredVideo: HTMLVideoElement | null = null;

/** Wire the persistent source video + auto-PiP triggers. Called by CallMediaSink. */
export function initCallPip(video: HTMLVideoElement | null): void {
  sourceVideo = video;
  if (typeof document === 'undefined') return;

  if (video && video !== wiredVideo) {
    wiredVideo = video;
    video.addEventListener('enterpictureinpicture', () => (pipActive.value = true));
    video.addEventListener('leavepictureinpicture', () => (pipActive.value = false));
  }

  if (appWired) return;
  appWired = true;
  document.addEventListener('visibilitychange', onVisibility);
  try {
    navigator.mediaSession?.setActionHandler(
      'enterpictureinpicture' as MediaSessionAction,
      () => void enter(),
    );
  } catch {
    /* action unsupported on this browser */
  }
}
