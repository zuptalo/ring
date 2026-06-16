<template>
  <!-- Hovering audio mini-controller (spec 1007 US3), mirroring the minimized-call
       pill. Shown whenever audio is playing through the global player, from anywhere
       in the app; offers play/pause and stop. A thin progress rail fills as it plays. -->
  <div v-if="track" class="audio-mini" role="group" aria-label="Now playing">
    <div class="am-cover" :class="{ voice: track.isVoice }">
      <img v-if="track.coverUrl" :src="track.coverUrl" alt="" />
      <ion-icon v-else :icon="track.isVoice ? mic : musicalNotes" />
    </div>
    <div class="am-info">
      <div class="am-title">{{ track.title }}</div>
      <div v-if="track.subtitle" class="am-sub">{{ track.subtitle }}</div>
    </div>
    <button class="am-btn" :aria-label="audioPlaying ? 'Pause' : 'Play'" @click="toggleAudioPlayback">
      <ion-icon :icon="audioPlaying ? pause : play" />
    </button>
    <button class="am-btn am-stop" aria-label="Stop" @click="stopAudio">
      <ion-icon :icon="stop" />
    </button>
    <div class="am-rail"><div class="am-prog" :style="{ width: audioProgress * 100 + '%' }" /></div>
  </div>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { play, pause, stop, mic, musicalNotes } from 'ionicons/icons';
import {
  audioTrack as track, audioPlaying, audioProgress, toggleAudioPlayback, stopAudio,
} from '@/composables/useAudioPlayer';
</script>

<style scoped>
/* Sits above the tab bar / safe-area, mirroring the minimized-call pill's placement
   and surface. Stock tokens only (Constitution XI). */
.audio-mini {
  position: fixed;
  left: 8px;
  right: 8px;
  bottom: calc(var(--ion-safe-area-bottom, 0px) + 64px);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 14px;
  background: var(--ion-color-step-100, #f2f2f7);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
  max-width: 520px;
  margin: 0 auto;
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
  background: var(--ion-color-primary);
  color: #fff;
  font-size: 20px;
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
  color: var(--ion-text-color);
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
.am-stop {
  background: var(--ion-color-step-300, #c7c7cc);
  color: var(--ion-text-color);
}
.am-rail {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 3px;
  height: 2px;
  border-radius: 1px;
  background: var(--ion-color-step-200, rgba(0, 0, 0, 0.1));
}
.am-prog {
  height: 100%;
  border-radius: 1px;
  background: var(--ion-color-primary);
}
</style>
