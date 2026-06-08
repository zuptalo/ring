<template>
  <!-- In-app notification banners (iOS/Telegram style): a neutral translucent card
       with the chat avatar + bold name + preview and a small grab handle. Tap to
       open; auto-dismisses. Readable in both light and dark themes. -->
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
      <div class="nb-main">
        <div class="nb-avatar">
          <img v-if="b.avatar" :src="b.avatar" :alt="b.name" />
          <ion-icon v-else :icon="b.kind === 'request' ? personAddOutline : chatbubbleEllipsesOutline" />
        </div>
        <div class="nb-text">
          <div class="nb-name">{{ b.name }}</div>
          <div class="nb-body">{{ b.body }}</div>
        </div>
      </div>
      <span class="nb-handle" aria-hidden="true" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { personAddOutline, chatbubbleEllipsesOutline } from 'ionicons/icons';
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
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 10px 14px 6px;
  border-radius: 18px;
  color: #fff;
  /* Neutral translucent slate (light theme); a darker charcoal in dark theme below.
     Self-contained + white text so it stays legible over any background. */
  background: rgba(58, 60, 66, 0.92);
  backdrop-filter: blur(18px) saturate(180%);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.32);
  cursor: pointer;
  animation: nb-in 0.22s ease;
}
@media (prefers-color-scheme: dark) {
  .nb {
    background: rgba(44, 44, 48, 0.82);
  }
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
.nb-main {
  display: flex;
  align-items: center;
  gap: 12px;
}
.nb-avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.16);
}
.nb-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.nb-avatar ion-icon {
  font-size: 20px;
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
  opacity: 0.88;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Decorative grab handle, like the screenshots. */
.nb-handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  margin: 2px auto 0;
  background: rgba(255, 255, 255, 0.4);
}
</style>
