<template>
  <!-- Full message menu shown in a popover anchored to a long-pressed bubble. Quick
       reactions live in the bottom-row quick-react button now (spec 1008), so this is
       the action list only. Each item dismisses the popover with the chosen { action }. -->
  <div class="ma">
    <ion-list class="ma-actions" lines="none">
      <ion-item v-if="canView" button :detail="false" @click="choose('view')">
        <ion-icon slot="start" :icon="expandOutline" />
        <ion-label>View</ion-label>
      </ion-item>
      <ion-item button :detail="false" @click="choose('reply')">
        <ion-icon slot="start" :icon="arrowUndoOutline" />
        <ion-label>Reply</ion-label>
      </ion-item>
      <ion-item button :detail="false" @click="choose('forward')">
        <ion-icon slot="start" :icon="arrowRedoOutline" />
        <ion-label>Forward</ion-label>
      </ion-item>
      <ion-item v-if="canEdit" button :detail="false" @click="choose('edit')">
        <ion-icon slot="start" :icon="createOutline" />
        <ion-label>Edit</ion-label>
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
      <ion-item button :detail="false" @click="choose('select')">
        <ion-icon slot="start" :icon="checkmarkCircleOutline" />
        <ion-label>Select</ion-label>
      </ion-item>
      <ion-item button :detail="false" @click="choose('delete')">
        <ion-icon slot="start" :icon="trashOutline" color="danger" />
        <ion-label color="danger">Delete</ion-label>
      </ion-item>
    </ion-list>
  </div>
</template>

<script setup lang="ts">
import { IonList, IonItem, IonLabel, IonIcon, popoverController } from '@ionic/vue';
import {
  expandOutline, informationCircleOutline, copyOutline, happyOutline, arrowUndoOutline, arrowRedoOutline, downloadOutline,
  createOutline, checkmarkCircleOutline, trashOutline,
} from 'ionicons/icons';

defineProps<{
  isOutgoing: boolean;
  canCopy: boolean;
  canView?: boolean; // image/video/album: offer "View" (open the full-screen viewer)
  canEdit?: boolean; // own, not-deleted text message: offer "Edit"
  canSave?: boolean; // single image/video/file/audio: offer "Save"
  canSaveAll?: boolean; // album bubble: offer "Save all"
  reactionCount?: number; // drives the "Reactions (N)" entry
}>();

const choose = (action: string) => void popoverController.dismiss({ action });
</script>

<style scoped>
.ma {
  width: 248px;
  max-width: 248px;
}
.ma-actions {
  padding: 0;
  --background: transparent;
}
.ma-actions ion-item {
  --min-height: 44px;
  --background: transparent;
  font-size: 15px;
}
</style>
