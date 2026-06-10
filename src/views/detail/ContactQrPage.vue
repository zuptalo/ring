<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/settings" />
        </ion-buttons>
        <ion-title>QR code</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true" class="ion-padding">
      <div class="ion-text-center ion-padding">
        <ion-avatar style="margin: 8px auto 12px; width: 64px; height: 64px;">
          <img :src="avatar" :alt="name" />
        </ion-avatar>
        <ion-text>
          <h2>{{ name }}</h2>
        </ion-text>
        <ion-text v-if="username" color="primary"><p class="handle">@{{ username }}</p></ion-text>

        <ion-img v-if="qr" :src="qr" alt="Your contact QR code" style="max-width: 280px; margin: 16px auto;" />
        <ion-spinner v-else-if="loading" name="crescent" />
        <ion-text v-else color="medium"><p>QR code unavailable, register first.</p></ion-text>
      </div>

      <ion-list v-if="username" :inset="true">
        <ion-item lines="none">
          <ion-label class="ion-text-center">
            <p>Your username</p>
            <h2 class="ring-id">@{{ username }}</h2>
          </ion-label>
        </ion-item>
      </ion-list>
      <div v-if="username" class="ion-text-center">
        <ion-button size="small" fill="outline" @click="copyHandle">
          {{ copied ? 'Copied' : 'Copy' }}
        </ion-button>
      </div>

      <ion-list :inset="true">
        <ion-item lines="none">
          <ion-label class="ion-text-wrap">
            <p>To add you, have someone open Contacts, tap the add button (＋), and choose “Scan a friend's QR”.</p>
          </ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonAvatar, IonText, IonImg, IonSpinner, IonList, IonItem, IonLabel,
  IonButton, toastController,
} from '@ionic/vue';
import { getSecret } from '@/db/secrets';
import { initialsAvatar } from '@/db/avatars';
import { getSelfUserId, getSelfUsername } from '@/services/auth';

const name = ref('You');
const avatar = ref(initialsAvatar('You'));
const qr = ref<string | null>(null);
const loading = ref(true);
const username = ref<string | null>(null);
const copied = ref(false);

function copyHandle(): void {
  if (!username.value) return;
  void navigator.clipboard?.writeText(`@${username.value}`);
  copied.value = true;
  void toastController.create({ message: 'Username copied', duration: 1200, position: 'top' }).then((t) => t.present());
}

onMounted(async () => {
  name.value = await getSecret('profileName', 'You');
  const photo = await getSecret('profileAvatar', '');
  avatar.value = photo || initialsAvatar(name.value);
  username.value = getSelfUsername();
  const uid = getSelfUserId();
  if (!uid) {
    loading.value = false;
    return;
  }
  // Encode the Ring ID so a scan adds this exact account (see ScanPage).
  const payload = `ring:${uid}`;
  try {
    // Dynamic import keeps a missing/optional dep from breaking the route.
    const QRCode = (await import('qrcode')).default;
    qr.value = await QRCode.toDataURL(payload, { margin: 1, width: 280 });
  } catch {
    qr.value = null;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
/* Render the 36-char UUID on a single line (no wrapping). */
.ring-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  white-space: nowrap;
  margin-top: 2px;
}
</style>
