<template>
  <!-- Bundles the per-chat operation modals (More sheet, Add-to-list, New/Edit list) so
       any page showing chat rows can drive them with a single `openMore(chat)` call. -->
  <ChatActionsSheet :is-open="moreOpen" :chat="moreChat" @dismiss="moreOpen = false" @add-to-list="onAddToList" />
  <AddToListModal :is-open="addOpen" :chat="addChat" @dismiss="addOpen = false" @new-list="onNewList" />
  <NewListModal :is-open="newOpen" :preset-chat-ids="newPreset" @dismiss="newOpen = false" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ChatActionsSheet from '@/components/ChatActionsSheet.vue';
import AddToListModal from '@/components/AddToListModal.vue';
import NewListModal from '@/components/NewListModal.vue';
import type { Chat } from '@/db/types';

const moreOpen = ref(false);
const moreChat = ref<Chat | null>(null);
const addOpen = ref(false);
const addChat = ref<Chat | null>(null);
const newOpen = ref(false);
const newPreset = ref<string[]>([]);

function openMore(chat: Chat): void {
  moreChat.value = chat;
  moreOpen.value = true;
}
function onAddToList(chat: Chat): void {
  moreOpen.value = false;
  addChat.value = chat;
  addOpen.value = true;
}
function onNewList(chat: Chat): void {
  addOpen.value = false;
  newPreset.value = [chat.id];
  newOpen.value = true;
}

defineExpose({ openMore });
</script>
