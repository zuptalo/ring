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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { callState, callMeta, remoteStream, remoteStreams, audioOutputId } from '@/composables/useCall';

const container = ref<HTMLElement | null>(null);

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
.call-media-sink {
  display: none;
}
</style>
