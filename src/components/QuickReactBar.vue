<template>
  <!-- Transient quick-react popover (spec 1008): the 7 most-used emoji, all visible in
       one row (no scrolling), then a trailing "+" that opens the full picker. Each
       control dismisses the popover with the chosen { action, emoji }. -->
  <div class="qr">
    <button
      v-for="e in quickSet"
      :key="e"
      type="button"
      class="qr-emoji"
      :class="{ on: myEmojis?.includes(e) }"
      :aria-label="`React ${e}`"
      @click="pick(e)"
    >
      <emoji :emoji="e" />
    </button>
    <button type="button" class="qr-emoji qr-more" aria-label="More emoji" @click="choose('more')">
      <ion-icon :icon="addCircleOutline" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { IonIcon, popoverController } from '@ionic/vue';
import { addCircleOutline } from 'ionicons/icons';
import { computed } from 'vue';
import Emoji from '@/components/Emoji.vue';

const props = defineProps<{
  myEmojis?: string[]; // the user's current reactions on this message (to highlight)
  quick?: string[]; // most-used-first quick-react set (from the caller)
}>();

// The 7 most-used emoji, all shown at once (no scroll). Falls back to a default set.
const DEFAULT_QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉'];
const quickSet = computed(() => (props.quick && props.quick.length ? props.quick : DEFAULT_QUICK).slice(0, 7));

const pick = (emoji: string) => void popoverController.dismiss({ action: 'react', emoji });
const choose = (action: string) => void popoverController.dismiss({ action });
</script>

<style scoped>
.qr {
  display: flex;
  align-items: center;
  /* Spread the 7 emoji + "+" evenly across the full-width popover — all visible at
     once, no horizontal scrolling. */
  justify-content: space-around;
  width: 100%;
  gap: 2px;
  padding: 6px 4px;
}
.qr-emoji {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  background: transparent;
  border-radius: 50%;
  font-size: 23px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.12s ease, transform 0.12s ease;
}
.qr-emoji:active {
  transform: scale(0.88);
}
.qr-emoji.on {
  background: color-mix(in srgb, var(--ion-color-primary) 22%, transparent);
}
.qr-more {
  font-size: 22px;
  color: var(--app-text-muted, #8e8e93);
  border-left: 1px solid var(--ion-color-step-150, rgba(0, 0, 0, 0.08));
  margin-left: 2px;
}
</style>
