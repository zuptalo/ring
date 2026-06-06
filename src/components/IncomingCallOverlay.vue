<template>
  <!-- Global incoming-call UI: a fixed overlay shown over any route while a call
       is ringing. Accept is the user gesture that also unlocks audio playback. -->
  <div v-if="callState === 'incoming' && callMeta" class="incoming">
    <div class="who">
      <ion-avatar class="avatar">
        <img :src="callMeta.avatar" :alt="callMeta.name" />
      </ion-avatar>
      <h2 class="name">{{ callMeta.name }}</h2>
      <p class="kind">
        {{ callMeta.isGroup ? 'Group · ' : '' }}Incoming
        {{ callMeta.kind === 'video' ? 'video' : 'voice' }} call…
      </p>
    </div>
    <div class="actions">
      <button class="btn decline" aria-label="Decline" @click="reject">
        <ion-icon :icon="callOutline" />
      </button>
      <button class="btn accept" aria-label="Accept" @click="accept">
        <ion-icon :icon="callMeta.kind === 'video' ? videocamOutline : callOutline" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IonAvatar, IonIcon } from '@ionic/vue';
import { callOutline, videocamOutline } from 'ionicons/icons';
import { callState, callMeta, acceptCall, rejectCall } from '@/composables/useCall';

function accept(): void {
  void acceptCall();
}
function reject(): void {
  void rejectCall();
}
</script>

<style scoped>
.incoming {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: max(48px, env(safe-area-inset-top)) 24px max(48px, env(safe-area-inset-bottom));
  background: rgba(0, 0, 0, 0.92);
  color: #fff;
  backdrop-filter: blur(8px);
}
.who {
  margin-top: 12vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}
.avatar {
  width: 112px;
  height: 112px;
}
.name {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
}
.kind {
  margin: 0;
  opacity: 0.7;
  font-size: 15px;
}
.actions {
  display: flex;
  gap: 72px;
  align-items: center;
}
.btn {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  color: #fff;
  cursor: pointer;
}
.btn ion-icon {
  font-size: 30px;
}
.decline {
  background: var(--ion-color-danger, #eb445a);
  transform: rotate(135deg);
}
.accept {
  background: var(--ion-color-success, #2dd36f);
}
</style>
