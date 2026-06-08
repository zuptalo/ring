<template>
  <!-- Incoming-call ring: a NON-blocking banner at the top so you can keep using the
       app (e.g. finish a chat) while deciding. Accepting is the gesture that unlocks
       audio AND switches to the full-screen call screen. -->
  <div v-if="callState === 'incoming' && callMeta" class="ring-banner">
    <ion-avatar class="ring-avatar">
      <img :src="callMeta.avatar" :alt="callMeta.name" />
    </ion-avatar>
    <div class="ring-text">
      <div class="ring-name">{{ callMeta.name }}</div>
      <div class="ring-kind">
        {{ callMeta.isGroup ? 'Group · ' : '' }}Incoming {{ callMeta.kind === 'video' ? 'video' : 'voice' }} call…
      </div>
    </div>
    <button class="ring-btn decline" aria-label="Decline" @click="reject">
      <ion-icon :icon="callOutline" />
    </button>
    <button class="ring-btn accept" aria-label="Accept" @click="accept">
      <ion-icon :icon="callMeta.kind === 'video' ? videocamOutline : callOutline" />
    </button>
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
.ring-banner {
  position: fixed;
  top: max(8px, env(safe-area-inset-top));
  left: 10px;
  right: 10px;
  max-width: 560px;
  margin: 0 auto;
  z-index: 20000; /* above content + the notification banners */
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 18px;
  color: #fff;
  background: #0a7d5c; /* app green; an incoming call is a "go" action */
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.4);
  animation: ring-in 0.22s ease;
}
@keyframes ring-in {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.ring-avatar {
  flex: none;
  width: 44px;
  height: 44px;
  border: 2px solid rgba(255, 255, 255, 0.8);
}
.ring-text {
  flex: 1;
  min-width: 0;
}
.ring-name {
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ring-kind {
  font-size: 13px;
  opacity: 0.9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ring-btn {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 21px;
  color: #fff;
  cursor: pointer;
}
.ring-btn ion-icon {
  font-size: 21px;
}
.decline {
  background: var(--ion-color-danger, #eb445a);
  transform: rotate(135deg);
}
.accept {
  background: #fff;
  color: #0a7d5c;
}
</style>
