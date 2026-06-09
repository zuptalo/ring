<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/chats" />
        </ion-buttons>
        <ion-title>Locked chats</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <template v-if="verified">
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
          <ion-note>No locked chats</ion-note>
        </div>
        <ChatActionsHost ref="actions" />
      </template>
      <div v-else class="empty">
        <ion-spinner name="crescent" />
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonList, IonNote, IonSpinner,
} from '@ionic/vue';
import ChatListItem from '@/components/ChatListItem.vue';
import ChatActionsHost from '@/components/ChatActionsHost.vue';
import { listLockedChats } from '@/db/queries';
import { verifyAppLock } from '@/services/chat-lock';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { Chat } from '@/db/types';

const router = useRouter();
const actions = ref<InstanceType<typeof ChatActionsHost> | null>(null);
const verified = ref(false);
const chats = useLiveQuery(() => listLockedChats(), ['chats', 'messages'], [] as Chat[]);

// Gate the whole view behind a fresh auth check; bounce out if it fails/cancels.
onMounted(async () => {
  verified.value = await verifyAppLock();
  if (!verified.value) router.replace('/tabs/chats');
});

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
