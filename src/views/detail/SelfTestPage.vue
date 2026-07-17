<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/settings/help" />
        </ion-buttons>
        <ion-title>Self-test</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true" class="ion-padding">
      <p>
        Runs the client-side crypto &amp; sync checks in this browser (libsodium,
        envelopes, identity/keystore, X3DH + Double Ratchet, group sender keys,
        media encryption). Read-only, touches no stored data.
      </p>

      <ion-button expand="block" :disabled="running" @click="run">
        {{ running ? 'Running…' : 'Run self-test' }}
      </ion-button>

      <p v-if="summary" class="ion-text-center summary" :class="{ ok: allPassed }">{{ summary }}</p>

      <ion-list v-if="results.length" :inset="true">
        <ion-item v-for="(r, i) in results" :key="i">
          <ion-icon
            slot="start"
            :icon="r.ok ? checkmarkCircle : closeCircle"
            :color="r.ok ? 'success' : 'danger'"
          />
          <ion-label class="ion-text-wrap">
            <h2>{{ r.name }}</h2>
            <p v-if="r.error">{{ r.error }}</p>
          </ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonButton, IonList, IonItem, IonLabel, IonIcon,
} from '@ionic/vue';
import { checkmarkCircle, closeCircle } from 'ionicons/icons';
import { appToast } from '@/services/toast';
import { runSelfTest, type CheckResult } from '@/services/crypto/selftest';

const running = ref(false);
const results = ref<CheckResult[]>([]);
const summary = ref('');
const allPassed = computed(() => results.value.length > 0 && results.value.every((r) => r.ok));

async function run(): Promise<void> {
  running.value = true;
  results.value = [];
  summary.value = '';
  try {
    const r = await runSelfTest();
    results.value = r;
    const pass = r.filter((x) => x.ok).length;
    summary.value = `${pass}/${r.length} checks passed`;
    await appToast({
      message: summary.value,
      duration: 2500,
      color: pass === r.length ? 'success' : 'danger',
    });
  } catch (e) {
    summary.value = e instanceof Error ? e.message : String(e);
  } finally {
    running.value = false;
  }
}
</script>

<style scoped>
.summary {
  font-weight: 600;
  margin-top: 16px;
}
.summary.ok {
  color: var(--ion-color-success);
}
</style>
