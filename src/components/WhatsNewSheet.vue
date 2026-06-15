<template>
  <!-- "What's new" sheet, presented imperatively from the update toast
       (useAppUpdate) via modalController. Lists the per-user delta of changes the
       incoming build introduces, newest-first and scrollable, with an Update action.
       Dismisses with role 'update' when the user chooses to install now. -->
  <ion-content class="sheet">
    <div class="sheet-head">
      <ion-icon class="head-icon" :icon="sparklesOutline" />
      <h2 class="head-name">What's new{{ version ? ` in Ring ${version}` : '' }}</h2>
      <button class="close" aria-label="Close" @click="dismiss('cancel')">
        <ion-icon :icon="closeOutline" />
      </button>
    </div>

    <ion-list :inset="true" class="notes">
      <ion-item v-for="note in notes" :key="note.sha" :detail="false" lines="full">
        <ion-icon slot="start" :icon="checkmarkCircleOutline" color="primary" />
        <ion-label class="note">{{ prettify(note.subject) }}</ion-label>
      </ion-item>
    </ion-list>

    <div class="actions">
      <ion-button expand="block" @click="dismiss('update')">Update now</ion-button>
      <ion-button expand="block" fill="clear" @click="dismiss('cancel')">Later</ion-button>
    </div>
  </ion-content>
</template>

<script setup lang="ts">
import { IonContent, IonList, IonItem, IonLabel, IonIcon, IonButton, modalController } from '@ionic/vue';
import { closeOutline, sparklesOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { prettify, type ReleaseNote } from '@/services/release-notes';

defineProps<{ version: string; notes: ReleaseNote[] }>();

// Imperative modal: communicate the choice back to useAppUpdate via the dismiss role.
function dismiss(role: 'update' | 'cancel'): void {
  void modalController.dismiss(undefined, role);
}
</script>

<style scoped>
.sheet {
  --padding-top: 8px;
}
.sheet-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 6px;
}
.head-icon {
  font-size: 26px;
  color: var(--ion-color-primary);
}
.head-name {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.close {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: var(--ion-color-step-150, rgba(120, 120, 128, 0.24));
  color: var(--ion-text-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
}
.notes ion-icon {
  font-size: 20px;
}
.note {
  white-space: normal;
}
.actions {
  padding: 8px 16px 16px;
}
</style>
