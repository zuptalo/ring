<template>
  <!-- Transient quick-react popover (spec 1008): the 5 most-used emoji, all visible in
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
    <button v-if="!atEmojiCap" type="button" class="qr-emoji qr-more" aria-label="More emoji" @click="choose('more')">
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
  existing?: string[]; // the distinct emojis already on this message
  atEmojiCap?: boolean; // message at the distinct-emoji cap → offer only `existing`
}>();

// The 5 most-used emoji, all shown at once (no scroll). Falls back to a default set.
// At the per-message distinct-emoji cap we instead show exactly the emojis already on
// the message (≤ cap), so the only thing you can do is react with one of those.
const DEFAULT_QUICK = ['👍', '❤️', '😂', '😮', '🙏'];
const quickSet = computed(() =>
  props.atEmojiCap && props.existing && props.existing.length
    ? props.existing.slice(0, 5)
    : (props.quick && props.quick.length ? props.quick : DEFAULT_QUICK).slice(0, 5),
);

const pick = (emoji: string) => void popoverController.dismiss({ action: 'react', emoji });
const choose = (action: string) => void popoverController.dismiss({ action });
</script>

<style scoped>
.qr {
  display: flex;
  align-items: center;
  /* Content-sized (not full width): the 5 emoji + "+" sit in one row with a
     comfortable gap so adjacent targets aren't hit by accident. */
  gap: 6px;
  padding: 6px 8px;
}
.qr-emoji {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  border-radius: 50%;
  /* Match the emoji size shown on messages (the reaction pills). */
  font-size: 19px;
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
  font-size: 20px;
  color: var(--app-text-muted, #8e8e93);
  border-left: 1px solid var(--ion-color-step-150, rgba(0, 0, 0, 0.08));
  margin-left: 2px;
  padding-left: 2px;
}
</style>
