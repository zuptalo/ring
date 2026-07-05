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
          <user-avatar :src="avatar" :alt="name" />
        </ion-avatar>
        <ion-text>
          <h2>{{ name }}</h2>
        </ion-text>
        <ion-text v-if="username" color="primary"><p class="handle">@{{ username }}</p></ion-text>

        <ion-img v-if="qr" :src="qr" alt="Your contact QR code" style="max-width: 280px; margin: 16px auto;" />
        <ion-spinner v-else-if="loading" name="crescent" />
        <ion-text v-else color="medium"><p>QR code unavailable, register first.</p></ion-text>
      </div>

      <!-- Tap a row to copy it. Username for a friend to search; user ID for an exact add. -->
      <ion-list :inset="true">
        <ion-item v-if="username" button :detail="false" lines="full" @click="copy('Username', `@${username}`, 'username')">
          <ion-label class="ion-text-wrap">
            <p>{{ copiedKey === 'username' ? 'Copied!' : 'Your username — tap to copy' }}</p>
            <h2 class="ring-id">@{{ username }}</h2>
          </ion-label>
        </ion-item>
        <ion-item v-if="userId" button :detail="false" lines="none" @click="copy('User ID', userId, 'userId')">
          <ion-label class="ion-text-wrap">
            <p>{{ copiedKey === 'userId' ? 'Copied!' : 'Your user ID — tap to copy' }}</p>
            <h2 class="ring-id">{{ userId }}</h2>
          </ion-label>
        </ion-item>
      </ion-list>

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
import UserAvatar from '@/components/UserAvatar.vue';
import { onMounted, ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonAvatar, IonText, IonImg, IonSpinner, IonList, IonItem, IonLabel,
} from '@ionic/vue';
import { appToast } from '@/services/toast';
import { getSecret } from '@/db/secrets';
import { initialsAvatar } from '@/db/avatars';
import { getSelfUserId, getSelfUsername } from '@/services/auth';

const name = ref('You');
const avatar = ref(initialsAvatar('You'));
const qr = ref<string | null>(null);
const loading = ref(true);
const username = ref<string | null>(null);
const userId = ref<string | null>(null);
// Which row just copied — drives the per-row checkmark; reset after a beat.
const copiedKey = ref<string | null>(null);

async function copy(label: string, value: string, key: string): Promise<void> {
  if (!value) return;
  try {
    await navigator.clipboard?.writeText(value);
    copiedKey.value = key;
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 1500);
    void appToast({ message: `${label} copied`, duration: 1200 });
  } catch {
    void appToast({ message: 'Copy failed — long-press to select instead', duration: 1600 });
  }
}

onMounted(async () => {
  name.value = await getSecret('profileName', 'You');
  const photo = await getSecret('profileAvatar', '');
  avatar.value = photo || initialsAvatar(name.value);
  username.value = getSelfUsername();
  const uid = getSelfUserId();
  userId.value = uid;
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
/* Show the full 36-char UUID — wrap rather than clip so it's always entirely visible. */
.ring-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.95rem;
  white-space: normal;
  word-break: break-all;
  margin-top: 2px;
}
</style>
