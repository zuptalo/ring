<template>
  <!-- One person in an audience list (spec 1065, FR-003). The same row serves group
       message receipts, post viewers, post reactions, and comment reactions, which is
       the point: the interaction is learned once and reused everywhere.

       Formatting boundary: the caller passes `when` already formatted. This row never
       touches Date. That is how ReactionDetails always worked and it is worth keeping,
       because the four callers want different formats (a receipt wants a clock time, a
       viewer wants "3h") and none of that belongs in a presentational row. -->
  <ion-item lines="full">
    <ion-avatar slot="start" class="av">
      <user-avatar :src="row.avatar" :alt="row.name" />
    </ion-avatar>
    <span v-if="row.emoji" slot="end" class="row-emoji"><emoji :emoji="row.emoji" /></span>
    <ion-label class="ion-text-wrap">
      <h2>{{ row.name }}</h2>
      <p v-if="row.when || row.note">
        <span v-if="row.when">{{ row.when }}</span>
        <span v-if="row.when && row.note" class="sep">·</span>
        <span v-if="row.note" class="note">{{ row.note }}</span>
      </p>
    </ion-label>
  </ion-item>
</template>

<script setup lang="ts">
import { IonItem, IonLabel, IonAvatar } from '@ionic/vue';
import UserAvatar from '@/components/UserAvatar.vue';
import Emoji from '@/components/Emoji.vue';
import type { AudienceRow } from '@/utils/audience-page';

/** `when` is pre-formatted by the caller; see the note in the template. */
defineProps<{ row: AudienceRow & { when?: string } }>();
</script>

<style scoped>
.av {
  width: 36px;
  height: 36px;
}
.row-emoji {
  font-size: 22px;
  margin-inline-start: 12px;
}
h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text);
}
p {
  font-size: 12px;
  color: var(--app-text-muted);
}
.sep {
  margin: 0 5px;
}
.note {
  font-style: italic;
}
</style>
