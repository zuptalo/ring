<template>
  <!-- Lists "More" sheet (opened from the filter bar's trailing button). Lists that
       aren't pinned to the tab live here; Edit opens the reorder editor; New list
       creates a custom list. Mirrors WhatsApp's lists sheet. -->
  <ion-modal
    :is-open="isOpen"
    :initial-breakpoint="0.6"
    :breakpoints="[0, 0.6, 1]"
    @did-dismiss="$emit('dismiss')"
  >
    <ion-content class="sheet">
      <div class="sheet-head">
        <h2>More</h2>
        <ion-button fill="solid" size="small" shape="round" @click="$emit('edit')">Edit</ion-button>
      </div>

      <div class="tip">
        <ion-icon :icon="bulbOutline" color="success" />
        <span>Keep lists here or use Edit to move them to the top of your Chats tab.</span>
      </div>

      <ion-list :inset="true">
        <ion-item
          v-for="l in lists"
          :key="l.id"
          button
          :detail="false"
          @click="$emit('select', `list:${l.id}`)"
        >
          <ion-icon slot="start" :icon="listOutline" />
          <ion-label>{{ l.name }}</ion-label>
          <!-- Manage (rename / members / delete) this list. A plain button (not
               ion-button) so it reliably stops the row's filter tap. -->
          <button
            slot="end"
            class="edit-btn"
            aria-label="Edit list"
            @click.stop="$emit('editList', l.id)"
            @pointerdown.stop
          >
            <ion-icon :icon="ellipsisHorizontal" />
          </button>
        </ion-item>
        <ion-item button :detail="false" @click="$emit('newList')">
          <ion-icon slot="start" color="primary" :icon="addOutline" />
          <ion-label color="primary">New list</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { IonModal, IonContent, IonList, IonItem, IonLabel, IonIcon, IonButton } from '@ionic/vue';
import { bulbOutline, listOutline, addOutline, ellipsisHorizontal } from 'ionicons/icons';
import type { FilterId } from '@/services/chat-filters';
import type { ChatList } from '@/db/types';

defineProps<{ isOpen: boolean; lists: ChatList[]; tabFilters: FilterId[] }>();
defineEmits<{
  (e: 'dismiss'): void;
  (e: 'edit'): void;
  (e: 'newList'): void;
  (e: 'editList', id: string): void;
  (e: 'select', id: FilterId): void;
}>();
</script>

<style scoped>
.sheet-head {
  display: flex;
  align-items: center;
  padding: 16px 16px 8px;
}
.sheet-head h2 {
  flex: 1;
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}
.tip {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 0 16px 8px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
  font-size: 14px;
  color: var(--ion-color-medium);
}
.tip ion-icon {
  font-size: 20px;
  flex: none;
}
.edit-btn {
  background: none;
  border: none;
  color: var(--ion-color-medium);
  font-size: 22px;
  padding: 6px;
  display: flex;
  align-items: center;
  cursor: pointer;
}
</style>
