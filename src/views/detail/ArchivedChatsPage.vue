<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/chats" />
        </ion-buttons>
        <ion-title>Archived</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-list>
        <ChatListItem
          v-for="chat in chats"
          :key="chat.id"
          :chat="chat"
          @open="open"
          @more="(c) => actions?.openMore(c)"
        />
      </ion-list>
      <div v-if="chats.length === 0" class="empty">
        <ion-note>No archived chats</ion-note>
      </div>
      <ChatActionsHost ref="actions" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonList, IonNote,
} from '@ionic/vue';
import ChatListItem from '@/components/ChatListItem.vue';
import ChatActionsHost from '@/components/ChatActionsHost.vue';
import { listArchivedChats } from '@/db/queries';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { Chat } from '@/db/types';

const router = useRouter();
const actions = ref<InstanceType<typeof ChatActionsHost> | null>(null);
const chats = useLiveQuery(() => listArchivedChats(), ['chats', 'messages'], [] as Chat[]);

function open(id: string): void {
  router.push(`/chat/${id}`);
}
</script>

<style scoped>
.empty {
  text-align: center;
  margin-top: 40px;
}
</style>
