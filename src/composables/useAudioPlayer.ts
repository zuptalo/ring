/**
 * Global, single-source audio playback (spec 1007, US3). One shared HTMLAudioElement
 * plays voice messages and music app-wide, so:
 *  - only ONE audio source ever plays (starting another replaces it — FR-009),
 *  - playback CONTINUES when you navigate away from the chat/message (the element
 *    lives at module scope, not in any component — FR-007),
 *  - it never loops (FR-007),
 *  - a hovering controller (MinimizedAudio, mirroring the minimized-call UI) and the
 *    in-chat players all drive and reflect this one reactive state.
 *
 * The in-chat players (VoicePlayer / AudioCard) are thin views: they call `playAudio`
 * with their track and read `audioCurId` to know whether they're the active one.
 */
import { ref } from 'vue';
import { nextRate, playWhenReady } from '@/utils/playback';

export interface AudioTrackMeta {
  id: string; // the message id — the unit of "now playing"
  url: string;
  title: string;
  subtitle?: string;
  coverUrl?: string;
  isVoice?: boolean;
  // The chat this audio belongs to. Lets the hovering controller (MinimizedAudio) hide
  // itself while you're INSIDE that chat — there the in-message player is the control —
  // and reappear (collapsed) once you leave. Absent → the controller always shows.
  chatId?: string;
}

const el = new Audio();
el.loop = false; // never loop (FR-007)

export const audioCurId = ref<string | null>(null);
export const audioPlaying = ref(false);
export const audioProgress = ref(0); // 0..1
export const audioRate = ref(1);
export const audioTrack = ref<AudioTrackMeta | null>(null);
// The id of a track whose OWN inline player is currently on screen (a Wall voice post the user
// is looking at) — the floating controller hides for it, since the inline player is right there.
// Cleared the moment that player scrolls/swipes out of view, so the floater takes over. Only the
// Wall sets this (chat keeps its existing "hide while in the owning chat" behaviour).
export const controllerHiddenForId = ref<string | null>(null);

// Optional, caller-scoped "what to do when the track ends" (e.g. the chat's playlist
// auto-advance). Cleared when the owning view goes away so a finished track just stops.
let endedCb: (() => void) | null = null;

el.addEventListener('timeupdate', () => {
  audioProgress.value = el.duration ? el.currentTime / el.duration : 0;
});
el.addEventListener('play', () => (audioPlaying.value = true));
el.addEventListener('pause', () => (audioPlaying.value = false));
el.addEventListener('ended', () => {
  audioPlaying.value = false;
  audioProgress.value = 0;
  const cb = endedCb;
  if (cb) cb();
  else stopAudio();
});

/** Play a track — or toggle play/pause if it's already the current one. Any other
 *  audio is replaced (single source). */
export function playAudio(meta: AudioTrackMeta, onEnded?: () => void): void {
  if (audioCurId.value === meta.id) {
    toggleAudioPlayback();
    return;
  }
  el.src = meta.url;
  el.playbackRate = audioRate.value;
  audioCurId.value = meta.id;
  audioProgress.value = 0;
  audioTrack.value = meta;
  endedCb = onEnded ?? null;
  void playWhenReady(el);
}

export function toggleAudioPlayback(): void {
  if (el.paused) void playWhenReady(el);
  else el.pause();
}

export function seekAudioFrac(frac: number): void {
  if (el.duration) el.currentTime = Math.min(1, Math.max(0, frac)) * el.duration;
}

export function cycleAudioRate(): void {
  audioRate.value = nextRate(audioRate.value);
  el.playbackRate = audioRate.value;
}

/** Stop playback entirely and clear the now-playing state (hides the controller). */
export function stopAudio(): void {
  el.pause();
  el.removeAttribute('src');
  el.load();
  audioCurId.value = null;
  audioPlaying.value = false;
  audioProgress.value = 0;
  audioTrack.value = null;
  endedCb = null;
}

/** Forget the (chat-scoped) ended callback WITHOUT stopping playback — used when the
 *  chat unmounts so the audio keeps playing but its playlist auto-advance stops. */
export function detachAudioEnded(): void {
  endedCb = null;
}

/** Stop + clear the player IF `url` is the source it's currently playing. Call this right
 *  before revoking a blob URL — e.g. the voice post being played is deleted/expired — so the
 *  floating controller doesn't linger over a now-dead source (it would otherwise show a stuck
 *  track and error on the revoked blob). Resets all now-playing state (hides the controller). */
export function stopIfPlaying(url: string): void {
  if (url && audioTrack.value?.url === url) stopAudio();
}

// Last-resort: if the element itself errors on its source (e.g. the blob was revoked out from
// under it), don't sit in a stuck "playing" state — tear the player down and hide the controller.
el.addEventListener('error', () => {
  if (audioTrack.value) stopAudio();
});
