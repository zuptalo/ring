<template>
  <!-- The game catalog + style picker (spec 0008 FR-022). Lists the registry;
       picking a game shows its bundled themes as tappable chips (mark pair +
       name). A new game or theme appears here by registration alone. -->
  <ion-modal :is-open="open" @did-dismiss="close">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ selected ? 'Pick a style' : 'Play a game' }}</ion-title>
        <ion-buttons v-if="selected && games.length > 1" slot="start">
          <ion-button @click="selected = null">Back</ion-button>
        </ion-buttons>
        <ion-buttons slot="end">
          <ion-button @click="close">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-list v-if="!selected">
        <ion-item v-for="g in games" :key="g.id" button :detail="true" @click="choose(g.id)">
          <ion-icon slot="start" :icon="g.icon" aria-hidden="true" />
          <ion-label>{{ g.displayName }}</ion-label>
        </ion-item>
      </ion-list>
      <div v-else class="themes">
        <button
          v-for="t in selected.themes"
          :key="t.id"
          type="button"
          class="theme-chip"
          :style="t.accent ? { '--game-accent': t.accent, '--game-accent-a': '0.14' } : undefined"
          @click="$emit('pick', selected.id, t.id)"
        >
          <span class="theme-marks">
            <game-mark :mark="t.marks?.[0]" :player="0" />
            <span class="theme-vs">vs</span>
            <game-mark :mark="t.marks?.[1]" :player="1" />
          </span>
          <span class="theme-name">{{ t.name }}</span>
        </button>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonList, IonItem, IonLabel, IonIcon,
} from '@ionic/vue';
import GameMark from '@/components/GameMark.vue';
import { GAMES } from '@/games/registry';
import type { GameModule } from '@/games/types';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'pick', gameType: string, theme: string): void; (e: 'close'): void }>();

// Module icons/marks are bundled data, so listing them here ships only what
// registered games actually use.
const games = Object.values(GAMES);
const selected = ref<GameModule | null>(null);

// With a single game there is nothing to choose — jump straight to its styles.
watch(
  () => props.open,
  (open) => {
    if (open) selected.value = games.length === 1 ? games[0] : null;
  },
);

// A game with ONE style has nothing to choose either — start it directly
// (Battleship's submarine design is its whole identity, spec 1033).
const choose = (id: string): void => {
  const g = GAMES[id] ?? null;
  if (g && g.themes.length <= 1) {
    emit('pick', g.id, g.themes[0]?.id ?? 'classic');
    return;
  }
  selected.value = g;
};
const close = () => {
  emit('close');
};
</script>

<style scoped>
.themes {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 14px;
}
.theme-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 8px 10px;
  border: none;
  border-radius: 12px;
  background: rgba(var(--game-accent, 0, 0, 0), var(--game-accent-a, 0.05));
  cursor: pointer;
}
.theme-marks {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 26px;
}
.theme-vs {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--app-text-muted);
}
.theme-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ion-text-color);
}
</style>
