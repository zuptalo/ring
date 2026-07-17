<template>
  <!-- "Add to list" for one chat: toggle its membership in each existing list, or make
       a new list (which opens NewListModal with this chat preselected). -->
  <ion-modal
    :is-open="isOpen"
    :initial-breakpoint="0.6"
    :breakpoints="[0, 0.6, 1]"
    @did-dismiss="$emit('dismiss')"
  >
    <ion-content class="sheet">
      <div class="sheet-head">
        <h2>Add to list</h2>
        <button class="close" aria-label="Close" @click="$emit('dismiss')"><ion-icon :icon="closeOutline" /></button>
      </div>
      <ion-list :inset="true">
        <ion-item button :detail="false" @click="$emit('newList', chat!)">
          <ion-icon slot="start" color="primary" :icon="addOutline" />
          <ion-label color="primary">New list</ion-label>
        </ion-item>
      </ion-list>
      <ion-list :inset="true">
        <ion-item v-for="l in lists" :key="l.id" button :detail="false" @click="toggle(l)">
          <ion-icon slot="start" :icon="listOutline" />
          <ion-label>{{ l.name }}</ion-label>
          <ion-checkbox slot="end" :checked="chat ? l.chatIds.includes(chat.id) : false" class="pick" aria-hidden="true" />
        </ion-item>
        <ion-item v-if="lists.length === 0" lines="none">
          <ion-label color="medium">No lists yet. Make one with "New list".</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { IonModal, IonContent, IonList, IonItem, IonLabel, IonIcon, IonCheckbox } from '@ionic/vue';
import { closeOutline, addOutline, listOutline } from 'ionicons/icons';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { listChatLists, setChatInList } from '@/db/queries';
import type { Chat, ChatList } from '@/db/types';

const props = defineProps<{ isOpen: boolean; chat: Chat | null }>();
defineEmits<{ (e: 'dismiss'): void; (e: 'newList', chat: Chat): void }>();

const lists = useLiveQuery(() => listChatLists(), ['chatlists'], [] as ChatList[]);

async function toggle(list: ChatList): Promise<void> {
  if (!props.chat) return;
  await setChatInList(list.id, props.chat.id, !list.chatIds.includes(props.chat.id));
}
</script>

<style scoped>
.sheet-head {
  display: flex;
  align-items: center;
  padding: 16px 16px 4px;
}
.sheet-head h2 {
  flex: 1;
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--ion-color-step-150, rgba(120, 120, 128, 0.24));
  color: var(--ion-text-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
}
.pick {
  pointer-events: none;
}
</style>
