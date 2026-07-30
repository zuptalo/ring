<template>
  <!-- Who reacted with what and when. Shown for both 1:1 and group messages.
       Since spec 1065 this is a thin wrapper over the shared AudienceRow, so a
       message's reactors and a post's reactors look and behave identically. -->
  <ion-list class="rd">
    <audience-row v-for="r in items" :key="r.id" :row="r" />
  </ion-list>
</template>

<script setup lang="ts">
import { IonList } from '@ionic/vue';
import AudienceRow from '@/components/AudienceRow.vue';
import type { AudienceRow as Row } from '@/utils/audience-page';

/** Rows arrive pre-formatted and pre-ordered from the caller (see AudienceRow). */
defineProps<{ items: Array<Row & { when?: string }> }>();
</script>

<style scoped>
.rd {
  min-width: 260px;
  padding: 0;
}
</style>
