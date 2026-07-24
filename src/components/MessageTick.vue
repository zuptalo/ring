<script setup lang="ts">
/**
 * (spec 1062) The WhatsApp-style delivery tick, factored out of ChatDetailPage's
 * inline `tickInfo`/`statusIcon` so the Chats-list row, the pinned tile, and the
 * conversation all render the same glyph set from one source of truth.
 *
 * Driven by a `LastTick` tier (see lastMessageTick in message-status.ts):
 *   pending → clock · sent → single check · delivered → grey double check ·
 *   seen → blue double check. `none`/`failed` render nothing (no idle/failure glyph
 *   on the list — a failed send simply shows no success tick).
 *
 * Ionic-first: a stock `ion-icon` styled only with the existing tick tokens.
 */
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { timeOutline, checkmark, checkmarkDone } from 'ionicons/icons';
import type { LastTick } from '@/db/types';

const props = defineProps<{
  tier: LastTick;
  /** Optional icon size (e.g. '13px' on a pinned tile). Defaults to the 16px used in-conversation. */
  size?: string;
}>();

const icon = computed(() => {
  switch (props.tier) {
    case 'pending':
      return timeOutline;
    case 'sent':
      return checkmark;
    case 'delivered':
    case 'seen':
      return checkmarkDone;
    default:
      return null; // 'none' | 'failed' → render nothing
  }
});

const seen = computed(() => props.tier === 'seen');
</script>

<template>
  <ion-icon
    v-if="icon"
    class="tick"
    :class="{ seen }"
    :icon="icon"
    :style="size ? { fontSize: size } : undefined"
    aria-hidden="true"
  />
</template>

<style scoped>
.tick {
  font-size: 16px;
  /* Inherit the surrounding text colour for pending/sent/delivered (matches the
     conversation footer); the seen tier overrides to the WhatsApp blue below. */
  color: currentColor;
}
/* WhatsApp-style blue "seen" double-check — identical to the in-conversation tick. */
.tick.seen {
  color: #34b7f1;
}
</style>
