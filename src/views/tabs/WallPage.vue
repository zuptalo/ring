<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>Wall</ion-title>
        <ion-buttons slot="end">
          <ion-button aria-label="New post" @click="compose">
            <ion-icon slot="icon-only" :icon="createOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Wall</ion-title>
        </ion-toolbar>
      </ion-header>

      <!-- Empty state -->
      <div v-if="!wall.length" class="empty">
        <ion-icon :icon="sparklesOutline" />
        <p>No posts yet. Share a moment with your friends.</p>
        <ion-button fill="solid" @click="compose">New post</ion-button>
      </div>

      <ion-list v-else :inset="true" lines="full">
        <ion-item
          v-for="p in wall"
          :key="p.id"
          button
          :detail="false"
          @click="open(p.id)"
        >
          <ion-avatar slot="start" class="avatar">
            <img v-if="p.authorAvatar" :src="p.authorAvatar" :alt="p.authorName" />
            <div v-else class="ph">{{ initial(p.authorName) }}</div>
          </ion-avatar>
          <ion-label class="post">
            <div class="head">
              <span class="name">{{ p.authorName }}</span>
              <span v-if="p.authorUsername" class="user">@{{ p.authorUsername }}</span>
              <span class="time">{{ ago(p.createdAt) }}</span>
            </div>
            <div v-if="p.mediaUrl" class="thumb">
              <img v-if="p.kind === 'image'" :src="p.mediaUrl" :alt="p.body || 'Photo'" />
              <video v-else-if="p.kind === 'video'" :src="p.mediaUrl" muted playsinline preload="metadata" />
              <div v-else class="voice"><ion-icon :icon="micOutline" /> Voice message</div>
              <ion-icon v-if="p.kind === 'video'" class="play" :icon="playCircleOutline" />
            </div>
            <p v-if="p.body || p.kind === 'text'" class="body">
              <ion-icon v-if="p.kind !== 'text' && !p.mediaUrl" :icon="kindIcon(p.kind)" class="kind" />
              {{ p.body || (p.mediaUrl ? '' : kindLabel(p.kind)) }}
            </p>
            <span v-if="p.audience === 'close'" class="badge">Close friends</span>
          </ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonList, IonItem, IonAvatar, IonLabel, IonIcon,
} from '@ionic/vue';
import { useRouter } from 'vue-router';
import { createOutline, sparklesOutline, imageOutline, videocamOutline, micOutline, playCircleOutline } from 'ionicons/icons';
import { useWall } from '@/composables/useWall';
import type { Post } from '@/db/types';

const router = useRouter();
const { wall } = useWall();

function compose(): void {
  void router.push('/wall/compose');
}
function open(id: string): void {
  void router.push(`/wall/post/${id}`);
}
function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
function kindIcon(kind: Post['kind']): string {
  return kind === 'image' ? imageOutline : kind === 'video' ? videocamOutline : micOutline;
}
function kindLabel(kind: Post['kind']): string {
  return kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : kind === 'voice' ? 'Voice' : '';
}
// Compact relative time ("now", "5m", "3h", "2d", else a date).
function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(ts).toLocaleDateString();
}
</script>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 56px 24px;
  color: var(--app-text-muted, var(--ion-color-medium));
  text-align: center;
}
.empty ion-icon {
  font-size: 44px;
  color: var(--ion-color-primary);
}
.avatar {
  width: 40px;
  height: 40px;
}
.avatar .ph {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--ion-color-step-150, rgba(120, 120, 128, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}
.post .head {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.post .name {
  font-weight: 600;
}
.post .user,
.post .time {
  color: var(--ion-color-medium);
  font-size: 13px;
}
.post .time {
  margin-left: auto;
}
.post .thumb {
  position: relative;
  margin: 6px 0 2px;
  max-width: 220px;
}
.post .thumb img,
.post .thumb video {
  width: 100%;
  max-height: 220px;
  border-radius: 12px;
  object-fit: cover;
  display: block;
}
.post .thumb .voice {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ion-color-medium);
}
.post .thumb .play {
  position: absolute;
  inset: 0;
  margin: auto;
  font-size: 44px;
  color: rgba(255, 255, 255, 0.92);
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
}
.post .body {
  margin: 2px 0 0;
  white-space: normal;
  color: var(--ion-text-color);
}
.post .kind {
  vertical-align: -2px;
  margin-right: 2px;
  color: var(--ion-color-medium);
}
.post .badge {
  display: inline-block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--ion-color-primary);
}
</style>
