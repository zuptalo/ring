<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/settings" />
        </ion-buttons>
        <ion-title>About</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div class="about">
        <!-- Brand block: the Ring mark (emerald badge + shielded ring). -->
        <div class="brand">
          <div class="brand-badge">
            <svg viewBox="0 0 100 100" width="56" height="56" aria-hidden="true">
              <path style="fill: #fff" d="M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z" />
              <circle cx="50" cy="49" r="18" style="fill: none; stroke: var(--ion-color-primary); stroke-width: 7" />
            </svg>
          </div>
          <h1>Ring</h1>
          <p class="version">Version {{ appVersion }}</p>
        </div>

        <ion-list :inset="true">
          <ion-item lines="none">
            <ion-label class="ion-text-wrap maker">
              <h2>Made by Zuptalo, with love for privacy 🔒</h2>
              <p>
                I built Ring because I wanted a messenger that doesn't watch you. No
                phone number, no ads, nobody in the middle reading your stuff. Your
                messages, calls and keys live on your device and nowhere else. Private
                messaging shouldn't be a luxury, so here it is.
              </p>
            </ion-label>
          </ion-item>
        </ion-list>

        <!-- Appreciation. A local button (no remote Liberapay script/pixel) so just
             opening this page never leaks your IP. You only reach out if you tap. -->
        <ion-list :inset="true">
          <ion-item lines="none">
            <ion-label class="ion-text-wrap beer">
              <h2>Like it? 🍺</h2>
              <p>
                If Ring kept you off some creepier app and you figure the late nights
                were worth it, you can throw a beer my way. No pressure though, a nice
                message is just as good.
              </p>
            </ion-label>
          </ion-item>
          <ion-item button :detail="false" lines="none" @click="buyBeer">
            <ion-icon slot="start" :icon="beerOutline" color="primary" />
            <ion-label color="primary">Buy me a beer (Liberapay)</ion-label>
            <ion-icon slot="end" :icon="openOutline" color="medium" />
          </ion-item>
        </ion-list>

        <p class="foot">Thanks for keeping your chats yours. Zuptalo</p>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonList, IonItem, IonLabel, IonIcon,
} from '@ionic/vue';
import { beerOutline, openOutline } from 'ionicons/icons';
import { openExternal } from '@/utils/external';

const appVersion = __APP_VERSION__;

// Liberapay donate page (non-profit, 0% platform fee). Opened in the system
// browser on tap; nothing from Liberapay loads until then.
const LIBERAPAY_URL = 'https://liberapay.com/zuptalo/donate';

function buyBeer(): void {
  openExternal(LIBERAPAY_URL);
}
</script>

<style scoped>
.about {
  padding-bottom: max(env(safe-area-inset-bottom, 0px), 24px);
}
.brand {
  text-align: center;
  padding: 28px 16px 8px;
}
.brand-badge {
  width: 76px;
  height: 76px;
  margin: 0 auto 14px;
  border-radius: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ion-color-primary);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.45);
}
.brand h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
}
.version {
  margin: 4px 0 0;
  color: var(--app-text-muted, #8e8e93);
  font-size: 13px;
}
.maker h2,
.beer h2 {
  font-weight: 600;
  margin-bottom: 4px;
}
.maker p,
.beer p {
  color: var(--app-text-muted, #8e8e93);
  font-size: 14px;
  line-height: 1.5;
}
.foot {
  text-align: center;
  color: var(--app-text-muted, #8e8e93);
  font-size: 13px;
  margin: 20px 24px 0;
}
</style>
