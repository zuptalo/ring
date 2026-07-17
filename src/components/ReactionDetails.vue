<template>
  <!-- Who reacted with what and when. Shown for both 1:1 and group messages. -->
  <ion-list class="rd">
    <ion-item v-for="(r, i) in items" :key="i" lines="full">
      <span slot="start" class="rd-emoji"><emoji :emoji="r.emoji" /></span>
      <ion-label>
        <h2>{{ r.name }}</h2>
        <p>{{ r.when }}</p>
      </ion-label>
    </ion-item>
  </ion-list>
</template>

<script setup lang="ts">
import { IonList, IonItem, IonLabel } from '@ionic/vue';
import Emoji from '@/components/Emoji.vue';

defineProps<{ items: Array<{ name: string; emoji: string; when: string }> }>();
</script>

<style scoped>
.rd {
  min-width: 240px;
  padding: 0;
}
.rd-emoji {
  font-size: 22px;
  margin-inline-end: 12px;
}
.rd ion-item h2 {
  font-size: 15px;
  font-weight: 600;
}
.rd ion-item p {
  font-size: 12px;
  color: var(--app-text-muted);
}
</style>
