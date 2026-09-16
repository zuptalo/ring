/**
 * Voice-message recording: microphone capture, a live waveform, pause/resume with
 * a hear-it-back preview, and — the part that matters most — one teardown that
 * always runs.
 *
 * Lifted out of ChatDetailPage (spec 1007). It was ~230 lines of the page's 6,900,
 * and it owned five things that outlive a render: a MediaStream, a MediaRecorder,
 * an AudioContext, two intervals and a blob URL. Because the teardown was reachable
 * only from "send" and "cancel", leaving the chat mid-recording released NONE of
 * them — the microphone stayed open, with the OS indicator on, for the rest of the
 * session. Owning that state here lets this file own its own `onUnmounted`, so the
 * page cannot forget it and neither can the next page that reuses this.
 *
 * The composable is deliberately ignorant of chats, messages and sending. It hands
 * back a finished `{ blob, durationSec }` and lets the caller decide what that is;
 * `onStart` / `onStop` exist so the caller can drive its own concerns (the chat
 * uses them for the peer's "recording…" indicator, spec 1009).
 */
import { onUnmounted, ref } from 'vue';
import { nextRate, playWhenReady } from '@/utils/playback';

/** A completed recording, ready to be sent or discarded by the caller. */
export interface VoiceRecording {
  blob: Blob;
  durationSec: number;
}

export interface VoiceRecorderOptions {
  /** Capture started (the mic is live). */
  onStart?: () => void;
  /** Capture ended, for ANY reason — sent, cancelled, or abandoned on leave. */
  onStop?: () => void;
  /** getUserMedia failed: permission blocked, no mic, or already in use. */
  onError?: (err: unknown) => void;
}

/** How many amplitude samples the scrolling waveform keeps. */
export const REC_BARS = 42;

export function useVoiceRecorder(opts: VoiceRecorderOptions = {}) {
  const recording = ref(false);
  const recPaused = ref(false); // paused = preview mode (hear it back before sending)
  const recElapsed = ref('0:00');
  const recBars = ref<number[]>([]); // live amplitude history, scrolling
  const recPlaying = ref(false); // preview playback state (while paused)
  const recRate = ref(1); // preview playback speed

  let recorder: MediaRecorder | null = null;
  let recChunks: BlobPart[] = [];
  let recTimer: number | undefined; // elapsed display
  let recSampler: number | undefined; // waveform sampler
  let recAudioCtx: AudioContext | null = null;
  let recAnalyser: AnalyserNode | null = null;
  let recAccumMs = 0; // active recording time across pauses
  let recSegStart = 0; // current segment start
  let recPreviewEl: HTMLAudioElement | null = null; // plays the recorded-so-far on pause
  let recPreviewUrl: string | null = null;
  let recWantPreview = false; // a requestData() flush is pending → (re)build the preview

  const fmtMs = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  /** Bar height in px for an amplitude in 0..1 — the waveform's only geometry. */
  const barH = (h: number) => `${Math.round(3 + h * 18)}px`;
  const recActiveMs = () => recAccumMs + (recPaused.value ? 0 : Date.now() - recSegStart);

  function tickElapsed(): void {
    recElapsed.value = fmtMs(recActiveMs());
  }

  function sampleWave(): void {
    if (!recAnalyser) return;
    const buf = new Uint8Array(recAnalyser.fftSize);
    recAnalyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const next = [...recBars.value, Math.min(1, rms * 3.2)];
    if (next.length > REC_BARS) next.shift();
    recBars.value = next;
  }

  function startSampler(): void {
    recSampler = window.setInterval(sampleWave, 90);
  }
  function stopSampler(): void {
    if (recSampler) clearInterval(recSampler);
    recSampler = undefined;
  }

  // Build (or rebuild) the preview player from the audio captured so far, so the user
  // can hear what they've recorded while paused. A partial webm/fragmented-mp4 stream
  // (the chunks emitted by the timeslice + requestData flush) is itself playable.
  function buildPreview(): void {
    stopPreview();
    const mime = recorder?.mimeType || 'audio/webm';
    recPreviewUrl = URL.createObjectURL(new Blob(recChunks, { type: mime }));
    if (!recPreviewEl) {
      recPreviewEl = new Audio();
      recPreviewEl.preload = 'auto';
      recPreviewEl.addEventListener('play', () => (recPlaying.value = true));
      recPreviewEl.addEventListener('pause', () => (recPlaying.value = false));
      recPreviewEl.addEventListener('ended', () => (recPlaying.value = false));
    }
    recPreviewEl.src = recPreviewUrl;
    recPreviewEl.playbackRate = recRate.value;
  }
  function stopPreview(): void {
    recPreviewEl?.pause();
    recPlaying.value = false;
    if (recPreviewUrl) {
      URL.revokeObjectURL(recPreviewUrl);
      recPreviewUrl = null;
    }
  }
  function togglePreview(): void {
    if (!recPreviewEl) return;
    if (recPlaying.value) recPreviewEl.pause();
    else void playWhenReady(recPreviewEl);
  }
  function cycleRate(): void {
    recRate.value = nextRate(recRate.value);
    if (recPreviewEl) recPreviewEl.playbackRate = recRate.value;
  }

  /** Release every resource capture holds: the mic tracks, the AudioContext tapping
   *  them, both intervals and the preview blob URL. Safe to call twice. */
  function teardownRec(): void {
    if (recTimer) clearInterval(recTimer);
    recTimer = undefined;
    stopSampler();
    stopPreview();
    recPreviewEl = null;
    recWantPreview = false;
    recorder?.stream.getTracks().forEach((t) => t.stop());
    void recAudioCtx?.close().catch(() => {});
    recAudioCtx = null;
    recAnalyser = null;
  }

  /** Common tail of every way a recording ends. */
  function reset(): void {
    teardownRec();
    recChunks = [];
    recBars.value = [];
    recording.value = false;
    recPaused.value = false;
    recorder = null;
    opts.onStop?.();
  }

  async function start(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const types = ['audio/webm', 'audio/mp4', 'audio/ogg'];
      const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t));
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recChunks = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size) recChunks.push(ev.data);
        // A pause requested a flush so we could preview the recording-so-far.
        if (recWantPreview) {
          recWantPreview = false;
          buildPreview();
        }
      };
      // Timeslice so chunks land continuously — that's what lets us assemble a playable
      // preview blob mid-recording (and keeps "continue from the end" one stream).
      recorder.start(500);
      // Tap the mic stream for a live waveform.
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      recAudioCtx = new AC();
      // A freshly created AudioContext often starts SUSPENDED (autoplay policy), and a
      // suspended context feeds the analyser nothing → getByteTimeDomainData stays at the
      // 128 midline → the waveform reads flat even while you speak. We start recording from
      // a tap, so resuming here is allowed and reliable.
      void recAudioCtx.resume().catch(() => {});
      recAnalyser = recAudioCtx.createAnalyser();
      recAnalyser.fftSize = 512;
      recAudioCtx.createMediaStreamSource(stream).connect(recAnalyser);
      recBars.value = [];
      recPaused.value = false;
      recPlaying.value = false;
      recRate.value = 1;
      recWantPreview = false;
      recAccumMs = 0;
      recSegStart = Date.now();
      recording.value = true;
      recElapsed.value = '0:00';
      recTimer = window.setInterval(tickElapsed, 200);
      startSampler();
      opts.onStart?.();
    } catch (err) {
      // The caller says WHY (permission blocked vs. no mic vs. in use) instead of a
      // dead-end "unavailable": on Android the usual cause is the app's mic permission
      // being off at the OS level, which only the user can turn back on.
      opts.onError?.(err);
    }
  }

  function togglePause(): void {
    if (!recorder) return;
    if (recPaused.value) {
      // Resume = continue the SAME recording from where it left off (mic button).
      stopPreview();
      recorder.resume();
      recPaused.value = false;
      recSegStart = Date.now();
      startSampler();
    } else {
      // Pause = stop capturing and offer a preview (play button + speed). Flush the
      // recorder first so the preview includes audio right up to the pause point.
      recAccumMs += Date.now() - recSegStart;
      recPaused.value = true;
      stopSampler();
      recWantPreview = true;
      try {
        recorder.requestData(); // → ondataavailable → buildPreview()
      } catch {
        recWantPreview = false;
      }
      recorder.pause();
      // Fallback if requestData didn't deliver a chunk (older browsers): build anyway.
      setTimeout(() => {
        if (recWantPreview) {
          recWantPreview = false;
          buildPreview();
        }
      }, 150);
    }
  }

  /** Finalize the recording and hand back the audio. Null when nothing was recording. */
  async function finish(): Promise<VoiceRecording | null> {
    if (!recorder) return null;
    const durationSec = Math.max(1, Math.round(recActiveMs() / 1000));
    const rec = recorder;
    const mime = rec.mimeType || 'audio/webm';
    stopPreview();
    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(recChunks, { type: mime }));
      if (recPaused.value) rec.resume(); // some browsers won't finalize while paused
      rec.stop();
    });
    reset();
    return { blob, durationSec };
  }

  /** Throw the recording away (the user tapped the bin). */
  function cancel(): void {
    if (recorder) {
      recorder.onstop = null;
      if (recPaused.value) recorder.resume();
      recorder.stop();
    }
    reset();
  }

  /** Drop an in-progress recording because the VIEW is going away, not because the
   *  user cancelled it. A no-op when nothing is recording, so it is safe to call on
   *  every leave — which is exactly how it is wired below and by the caller's own
   *  view-leave hook (Ionic keeps a page mounted after it leaves, so unmount alone
   *  would hold the mic open for as long as the page lingers). */
  function abandon(): void {
    if (!recorder && !recording.value) return;
    cancel();
  }

  // The reason this state moved into a composable: teardown now travels with it.
  onUnmounted(abandon);

  return {
    // state
    recording,
    recPaused,
    recElapsed,
    recBars,
    recPlaying,
    recRate,
    // view helpers
    REC_BARS,
    barH,
    // actions
    start,
    togglePause,
    togglePreview,
    cycleRate,
    finish,
    cancel,
    abandon,
  };
}
