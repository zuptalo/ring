<template>
  <!-- Unified message menu shown in a popover anchored to the tapped bubble: a
       horizontal quick-react emoji row on top, then the message actions. Each
       control dismisses the popover with the chosen { action, emoji }. -->
  <div class="ma">
    <div class="ma-emojis">
      <button
        v-for="e in quickSet"
        :key="e"
        type="button"
        class="ma-emoji"
        :class="{ on: myEmojis?.includes(e) }"
        @click="pick(e)"
      >
        <emoji :emoji="e" />
      </button>
      <button type="button" class="ma-emoji ma-more" aria-label="More emoji" @click="choose('more')">
        <ion-icon :icon="addOutline" />
      </button>
    </div>

    <ion-list class="ma-actions" lines="none">
      <ion-item button :detail="false" @click="choose('reply')">
        <ion-icon slot="start" :icon="arrowUndoOutline" />
        <ion-label>Reply</ion-label>
      </ion-item>
      <ion-item button :detail="false" @click="choose('forward')">
        <ion-icon slot="start" :icon="arrowRedoOutline" />
        <ion-label>Forward</ion-label>
      </ion-item>
      <ion-item v-if="canSave" button :detail="false" @click="choose('save')">
        <ion-icon slot="start" :icon="downloadOutline" />
        <ion-label>Save</ion-label>
      </ion-item>
      <ion-item v-if="canSaveAll" button :detail="false" @click="choose('saveAll')">
        <ion-icon slot="start" :icon="downloadOutline" />
        <ion-label>Save all</ion-label>
      </ion-item>
      <ion-item v-if="reactionCount" button :detail="false" @click="choose('details')">
        <ion-icon slot="start" :icon="happyOutline" />
        <ion-label>Reactions ({{ reactionCount }})</ion-label>
      </ion-item>
      <ion-item v-if="isOutgoing" button :detail="false" @click="choose('info')">
        <ion-icon slot="start" :icon="informationCircleOutline" />
        <ion-label>Message info</ion-label>
      </ion-item>
      <ion-item v-if="canCopy" button :detail="false" @click="choose('copy')">
        <ion-icon slot="start" :icon="copyOutline" />
        <ion-label>Copy</ion-label>
      </ion-item>
    </ion-list>
  </div>
</template>

<script setup lang="ts">
import { IonList, IonItem, IonLabel, IonIcon, popoverController } from '@ionic/vue';
import {
  addOutline, informationCircleOutline, copyOutline, happyOutline, arrowUndoOutline, arrowRedoOutline, downloadOutline,
} from 'ionicons/icons';
import { computed } from 'vue';
import Emoji from '@/components/Emoji.vue';

const props = defineProps<{
  isOutgoing: boolean;
  canCopy: boolean;
  canSave?: boolean; // single image/video/file/audio: offer "Save"
  canSaveAll?: boolean; // album bubble: offer "Save all"
  myEmojis?: string[]; // the user's current reactions on this message (up to 3)
  reactionCount?: number;
  quick?: string[]; // most-used-first quick-react set (from the caller)
}>();

// Exactly 4 quick emoji + a "+"; the "+" opens the full picker. All fit without
// scrolling (Teams-style). Falls back to a default set.
const DEFAULT_QUICK = ['👍', '❤️', '😂', '😮'];
const quickSet = computed(() =>
  (props.quick && props.quick.length ? props.quick : DEFAULT_QUICK).slice(0, 4),
);

// Report the chosen emoji; the caller (reactToMessage) toggles it off if it's
// already the user's current reaction.
const pick = (emoji: string) => void popoverController.dismiss({ action: 'react', emoji });
const choose = (action: string) => void popoverController.dismiss({ action });
</script>

<style scoped>
.ma {
  width: 248px;
  max-width: 248px;
  overflow: hidden; /* the menu itself never scrolls, only the emoji row does */
  /* Own only vertical panning so a horizontal swipe anywhere outside the emoji row
     can't drag the whole menu sideways (it bled into the action rows before). */
  touch-action: pan-y;
}
.ma-emojis {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  padding: 6px 6px 4px;
  /* No horizontal scroll: the 4 quick emoji + the "+" are all visible at once. */
}
.ma-emoji {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  border-radius: 50%;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.12s ease, transform 0.12s ease;
}
.ma-emoji:active {
  transform: scale(0.88);
}
.ma-emoji.on {
  background: color-mix(in srgb, var(--ion-color-primary) 22%, transparent);
}
.ma-more {
  font-size: 20px;
  color: var(--app-text-muted, #8e8e93);
}
.ma-actions {
  padding: 0;
  border-top: 1px solid var(--ion-color-step-150, rgba(0, 0, 0, 0.08));
  touch-action: pan-y;
}
.ma-actions ion-item {
  --min-height: 44px;
  --background: transparent;
  font-size: 15px;
}
</style>
