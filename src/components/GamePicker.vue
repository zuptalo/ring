<template>
  <!-- The game catalog (spec 0008). Lists src/games/registry.ts — with one game
       today it is small, but it IS the plugin-forward surface: a new game
       appears here by registration alone, with no change to this component. -->
  <ion-modal :is-open="open" @did-dismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>Play a game</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="$emit('close')">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-list>
        <ion-item
          v-for="g in games"
          :key="g.id"
          button
          :detail="true"
          @click="$emit('pick', g.id)"
        >
          <ion-icon slot="start" :icon="g.icon" aria-hidden="true" />
          <ion-label>{{ g.displayName }}</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonList, IonItem, IonLabel, IonIcon,
} from '@ionic/vue';
import { GAMES } from '@/games/registry';

defineProps<{ open: boolean }>();
defineEmits<{ (e: 'pick', gameType: string): void; (e: 'close'): void }>();

// Module icons are Ionicon data (imported per-game in each module), so listing
// them here bundles only the icons of games that actually shipped.
const games = Object.values(GAMES);
</script>
