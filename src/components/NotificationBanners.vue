<template>
  <!-- In-app notification banners: a green (app-brand) card with the chat avatar +
       name + preview, tap to open. Green so it reads clearly in light AND dark
       themes; white text on a deep emerald for legibility, with the vibrant icon
       green as the edge + avatar accent. -->
  <div class="nb-stack">
    <div
      v-for="b in banners"
      :key="b.id"
      class="nb"
      role="button"
      tabindex="0"
      @click="open(b)"
      @keydown.enter="open(b)"
    >
      <div class="nb-avatar">
        <img v-if="b.avatar" :src="b.avatar" :alt="b.name" />
        <ion-icon v-else :icon="b.kind === 'request' ? personAddOutline : chatbubbleEllipsesOutline" />
      </div>
      <div class="nb-text">
        <div class="nb-name">{{ b.name }}</div>
        <div class="nb-body">{{ b.body }}</div>
      </div>
      <button class="nb-close" aria-label="Dismiss" @click.stop="dismissBanner(b.id)">
        <ion-icon :icon="closeOutline" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { closeOutline, personAddOutline, chatbubbleEllipsesOutline } from 'ionicons/icons';
import router from '@/router';
import { notifyBanners, dismissBanner, type NotifyBanner } from '@/services/notify';

const banners = notifyBanners;
function open(b: NotifyBanner): void {
  dismissBanner(b.id);
  void router.push(b.url);
}
</script>

<style scoped>
.nb-stack {
  position: fixed;
  top: max(8px, env(safe-area-inset-top));
  left: 0;
  right: 0;
  /* Below the incoming-call overlay (20000), above ordinary content + tabs. */
  z-index: 19000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px;
  pointer-events: none; /* only the cards catch taps, not the gaps */
}
.nb {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 10px 12px;
  border-radius: 14px;
  border-left: 4px solid var(--ion-color-primary, #10b981);
  color: #fff;
  /* Deep emerald: clearly the app's green, dark enough for crisp white text in any
     theme (white-on-#10b981 alone fails contrast). */
  background: #0a7d5c;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  animation: nb-in 0.22s ease;
}
@keyframes nb-in {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.nb-avatar {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.2);
  border: 2px solid var(--ion-color-primary, #10b981);
}
.nb-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.nb-avatar ion-icon {
  font-size: 22px;
  color: #fff;
}
.nb-text {
  flex: 1;
  min-width: 0;
}
.nb-name {
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nb-body {
  font-size: 14px;
  opacity: 0.94;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nb-close {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  cursor: pointer;
}
.nb-close ion-icon {
  font-size: 18px;
}
</style>
