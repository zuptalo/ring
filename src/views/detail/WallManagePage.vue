<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/wall" />
        </ion-buttons>
        <ion-title>Hidden &amp; muted</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Hidden &amp; muted</ion-title>
        </ion-toolbar>
      </ion-header>

      <p class="hint">
        Turn off Hidden to see someone's posts again, or Muted to get their Wall notifications back.
      </p>

      <div v-if="!people.length" class="empty">You haven't hidden or muted anyone.</div>

      <ion-list v-else :inset="true">
        <ion-item v-for="u in people" :key="u.id">
          <ion-avatar slot="start" class="avatar">
            <img v-if="u.avatar" :src="u.avatar" :alt="u.name" />
            <div v-else class="ph">{{ initial(u.name) }}</div>
          </ion-avatar>
          <ion-label>{{ u.name }}</ion-label>
          <div class="toggles" slot="end">
            <label class="t">
              <span>Hidden</span>
              <ion-toggle :checked="u.hidden" @ion-change="onHide(u.id, $event)" />
            </label>
            <label class="t">
              <span>Muted</span>
              <ion-toggle :checked="u.muted" @ion-change="onMute(u.id, $event)" />
            </label>
          </div>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonList, IonItem, IonAvatar, IonLabel, IonToggle,
} from '@ionic/vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { listWallManagedUsers, setWallUserHidden, setWallUserMuted } from '@/db/queries';

const people = useLiveQuery(() => listWallManagedUsers(), ['settings', 'contacts'], []);

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
function onHide(id: string, e: CustomEvent): void {
  void setWallUserHidden(id, (e.detail as { checked?: boolean }).checked ?? false);
}
function onMute(id: string, e: CustomEvent): void {
  void setWallUserMuted(id, (e.detail as { checked?: boolean }).checked ?? false);
}
</script>

<style scoped>
.hint {
  margin: 4px 20px 8px;
  font-size: 13px;
  color: var(--app-text-muted, var(--ion-color-medium));
}
.empty {
  padding: 40px 24px;
  text-align: center;
  color: var(--ion-color-medium);
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
.toggles {
  display: flex;
  gap: 14px;
}
.toggles .t {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--ion-color-medium);
}
</style>
