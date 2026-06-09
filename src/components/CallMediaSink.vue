<template>
  <!-- Globally mounted (App.vue), independent of the route, so remote call audio keeps
       playing when the call screen is minimised and the user browses the app. One
       hidden <audio> per remote feed; the visible call <video>s stay muted so audio
       never double-plays. Using <audio> (not <video>) also lets iOS route an
       audio-only call to the earpiece. setSinkId follows the chosen output on Chromium
       (a no-op on iOS, where the OS owns the route). -->
  <div ref="container" class="call-media-sink" aria-hidden="true">
    <audio
      v-for="s in playStreams"
      :key="s.id"
      :ref="(el) => attachAudio(el as HTMLAudioElement | null, s)"
      autoplay
      playsinline
    />
    <!-- Persistent source for Picture-in-Picture: always carries the primary remote
         feed (muted - audio plays via the sinks above) so PiP can be entered from any
         screen and survives navigation. Kept on-screen but 1px so the browser still
         allows requestPictureInPicture (display:none would block it). -->
    <video ref="pipVideo" class="pip-source" muted autoplay playsinline />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { callState, callMeta, remoteStream, remoteStreams, audioOutputId, activeSpeakers } from '@/composables/useCall';
import { initCallPip } from '@/composables/useCallPip';

const container = ref<HTMLElement | null>(null);
const pipVideo = ref<HTMLVideoElement | null>(null);

// The single feed shown in Picture-in-Picture: the peer (1:1), or for a group the
// current active speaker (falling back to the first participant). Only ever set for a
// VIDEO call - attaching a remote stream to a <video> in an audio-only call can force
// iOS to the loudspeaker, and PiP isn't offered there anyway.
const pipStream = computed<MediaStream | null>(() => {
  if (!ACTIVE.includes(callState.value) || callMeta.value?.kind !== 'video') return null;
  if (!callMeta.value?.isGroup) return remoteStream.value;
  const speaking = remoteStreams.value.find((s) => activeSpeakers.value.includes(s.id));
  return speaking ?? remoteStreams.value[0] ?? null;
});
watch([pipVideo, pipStream], () => {
  const el = pipVideo.value;
  if (!el) return;
  if (el.srcObject !== (pipStream.value ?? null)) el.srcObject = pipStream.value;
  if (pipStream.value) void el.play?.().catch(() => {});
});
onMounted(() => initCallPip(pipVideo.value));

// Active call states in which there is remote media to play.
const ACTIVE = ['dialing', 'remote-ringing', 'connecting', 'connected'];

// The remote feeds to play: the single peer (1:1) or every participant (group). Empty
// when no call is active (so the elements unmount and release the streams).
const playStreams = computed<MediaStream[]>(() => {
  if (!ACTIVE.includes(callState.value)) return [];
  if (callMeta.value?.isGroup) return remoteStreams.value;
  return remoteStream.value ? [remoteStream.value] : [];
});

function applySink(el: HTMLAudioElement): void {
  const sink = (el as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId;
  if (sink) void sink.call(el, audioOutputId.value).catch(() => {});
}

function attachAudio(el: HTMLAudioElement | null, stream: MediaStream): void {
  if (!el) return;
  if (el.srcObject !== stream) el.srcObject = stream;
  el.muted = false;
  void el.play?.().catch(() => {});
  applySink(el);
}

// Re-point every sink when the user changes the output device (Chromium).
watch(audioOutputId, () => {
  container.value?.querySelectorAll('audio').forEach((el) => applySink(el as HTMLAudioElement));
});
</script>

<style scoped>
/* The audio sinks can be fully hidden, but the PiP source <video> must stay rendered
   (not display:none) for the browser to allow requestPictureInPicture - so keep it a
   1px, transparent, non-interactive sliver in the corner. */
.call-media-sink {
  position: fixed;
  left: 0;
  bottom: 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  z-index: -1;
}
.pip-source {
  width: 1px;
  height: 1px;
}
</style>
