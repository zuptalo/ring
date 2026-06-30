<template>
  <!-- Hovering audio mini-controller (spec 1007 US3), mirroring the minimized-call
       pill. It exists so audio keeps playing — and stays controllable — AFTER you leave
       the chat. While you're INSIDE the chat that owns the playing audio, the in-message
       player is the control, so this hides itself (track.chatId === current chat). Once
       you leave, it reappears COLLAPSED (a compact pill) and can be expanded on demand. -->
  <div
    v-if="track && !inOwningChat && track.id !== controllerHiddenForId"
    class="audio-mini"
    :class="{ collapsed: !expanded }"
    role="group"
    aria-label="Now playing"
  >
    <div class="am-cover" :class="{ voice: track.isVoice }">
      <img v-if="track.coverUrl" :src="track.coverUrl" alt="" />
      <ion-icon v-else :icon="track.isVoice ? mic : musicalNotes" />
    </div>
    <div v-if="expanded" class="am-info">
      <div class="am-title">{{ track.title }}</div>
      <div v-if="track.subtitle" class="am-sub">{{ track.subtitle }}</div>
    </div>
    <button class="am-btn" :aria-label="audioPlaying ? 'Pause' : 'Play'" @click="toggleAudioPlayback">
      <ion-icon :icon="audioPlaying ? pause : play" />
    </button>
    <button v-if="expanded" class="am-btn am-stop" aria-label="Stop" @click="stopAudio">
      <ion-icon :icon="stop" />
    </button>
    <button class="am-toggle" :aria-label="expanded ? 'Collapse' : 'Expand'" @click="expanded = !expanded">
      <ion-icon :icon="expanded ? chevronDownOutline : chevronUpOutline" />
    </button>
    <div class="am-rail"><div class="am-prog" :style="{ width: audioProgress * 100 + '%' }" /></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { IonIcon } from '@ionic/vue';
import { play, pause, stop, mic, musicalNotes, chevronUpOutline, chevronDownOutline } from 'ionicons/icons';
import {
  audioTrack as track, audioPlaying, audioProgress, toggleAudioPlayback, stopAudio, controllerHiddenForId,
} from '@/composables/useAudioPlayer';

const route = useRoute();

// Hide while viewing the chat the audio belongs to — there the in-message player owns
// the controls. Reactive on the route, so it appears/disappears as you enter/leave.
const inOwningChat = computed(
  // Exact conversation view only — NOT its /media, /info, /starred sub-pages, where the
  // in-message player isn't on screen and this control should still be available.
  () => !!track.value?.chatId && route.path === `/chat/${track.value.chatId}`,
);

// Start collapsed every time a new track begins (it should reappear minimized when you
// leave the chat, expandable only on demand).
const expanded = ref(false);
watch(() => track.value?.id, () => { expanded.value = false; });
</script>

<style scoped>
/* Sits above the tab bar / safe-area, mirroring the minimized-call pill's placement.
   Uses the app's own theme tokens (this codebase doesn't define Ionic's stepped colors,
   so --ion-color-step-* silently fell back to light values and never went dark). */
.audio-mini {
  position: fixed;
  bottom: calc(var(--ion-safe-area-bottom, 0px) + 64px);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 14px;
  /* Soft brand-green tint (the outgoing-bubble green) with a slim hairline border,
     matching the chat bubbles. */
  background: var(--app-bubble-out);
  border: 1px solid var(--app-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
  /* Expanded: a full-width bar, centered. */
  left: 8px;
  right: 8px;
  max-width: 520px;
  margin: 0 auto;
}
/* Collapsed: a compact pill that hugs its content at the bottom-left. */
.audio-mini.collapsed {
  right: auto;
  width: auto;
  max-width: calc(100% - 16px);
  gap: 8px;
  padding: 6px 8px;
}
.am-cover {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  /* No filled square — the mic / music-note icon sits directly on the green pill so it
     reads as part of the controller, not a button. (Album art, when present, still fills
     this box.) */
  background: transparent;
  color: var(--ion-color-primary);
  font-size: 24px;
}
.audio-mini.collapsed .am-cover {
  width: 30px;
  height: 34px;
  font-size: 22px;
}
.am-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.am-info {
  flex: 1;
  min-width: 0;
}
.am-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--app-text);
}
.am-sub {
  font-size: 12px;
  color: var(--app-text-muted, #8e8e93);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.am-btn {
  flex: none;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: var(--ion-color-primary);
  color: #fff;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.audio-mini.collapsed .am-btn {
  width: 34px;
  height: 34px;
  font-size: 18px;
}
.am-stop {
  background: var(--app-border);
  color: var(--app-text);
}
.am-toggle {
  flex: none;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--app-text-muted, #8e8e93);
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.am-rail {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 3px;
  height: 2px;
  border-radius: 1px;
  background: var(--app-border);
}
.am-prog {
  height: 100%;
  border-radius: 1px;
  background: var(--ion-color-primary);
}
</style>
