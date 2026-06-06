<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/contacts" />
        </ion-buttons>
        <ion-title>Scan QR</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true" class="ion-padding">
      <div class="scan-wrap">
        <!-- Camera preview for QR scanning (decoded by ZXing). -->
        <video ref="videoEl" class="scan-video" muted playsinline></video>
      </div>
      <ion-text class="ion-text-center" :color="error ? 'danger' : 'medium'">
        <p>{{ error || "Point your camera at a friend's Ring QR code." }}</p>
      </ion-text>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonText, onIonViewDidEnter, onIonViewWillLeave, toastController,
} from '@ionic/vue';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { requestFriend } from '@/db/queries';

const router = useRouter();
const videoEl = ref<HTMLVideoElement | null>(null);
const error = ref('');
let controls: IScannerControls | null = null;
let handled = false;

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

// Accepts `ring:<uuid>`, a bare uuid, or any string containing one.
function parseRingId(text: string): string | null {
  const m = text.match(UUID_RE);
  return m ? m[0] : null;
}

async function onDecoded(text: string): Promise<void> {
  if (handled) return;
  const id = parseRingId(text);
  if (!id) {
    error.value = "That doesn't look like a Ring code.";
    return;
  }
  handled = true;
  stopCamera();
  await requestFriend(id);
  void toastController.create({ message: 'Friend request sent', duration: 1400 }).then((t) => t.present());
  router.replace('/tabs/contacts');
}

function stopCamera(): void {
  controls?.stop();
  controls = null;
}

onIonViewDidEnter(async () => {
  handled = false;
  error.value = '';
  if (!videoEl.value) return;
  try {
    const reader = new BrowserQRCodeReader();
    controls = await reader.decodeFromConstraints(
      { video: { facingMode: 'environment' } },
      videoEl.value,
      (result) => {
        if (result) void onDecoded(result.getText());
      },
    );
  } catch {
    error.value = 'Camera unavailable. Allow camera access and make sure you opened the app over HTTPS.';
  }
});

onIonViewWillLeave(() => stopCamera());
</script>

<style scoped>
.scan-wrap {
  display: flex;
  justify-content: center;
}
.scan-video {
  width: 100%;
  max-width: 360px;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 12px;
  background: #000;
}
</style>
