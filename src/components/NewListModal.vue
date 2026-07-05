<template>
  <!-- Create or edit a custom chat list: a name + a multi-select of chats. Mirrors the
       New-group flow but selects chats instead of contacts. -->
  <ion-modal :is-open="isOpen" @did-dismiss="$emit('dismiss')" @will-present="init">
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button @click="$emit('dismiss')">Cancel</ion-button>
        </ion-buttons>
        <ion-title>{{ editing ? 'Edit list' : 'New list' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button :disabled="!canSave" :strong="true" @click="save">{{ editing ? 'Save' : 'Create' }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="search"
          placeholder="Search chats"
          @ion-input="search = $event.detail.value ?? ''"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-list :inset="true">
        <ion-item>
          <ion-input v-model="name" label="List name" label-placement="stacked" placeholder="e.g. Family" :maxlength="40" />
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-list-header><ion-label>Chats ({{ selected.size }})</ion-label></ion-list-header>
        <ion-item v-for="c in chats" :key="c.id" button :detail="false" @click="toggle(c.id)">
          <ion-avatar slot="start"><user-avatar :src="c.avatar" :alt="c.name" /></ion-avatar>
          <ion-label>{{ c.name }}</ion-label>
          <ion-checkbox slot="end" :checked="selected.has(c.id)" class="pick" aria-hidden="true" />
        </ion-item>
        <ion-item v-if="chats.length === 0" lines="none">
          <ion-label color="medium">{{ search ? 'No matching chats' : 'No chats yet.' }}</ion-label>
        </ion-item>
      </ion-list>

      <ion-list v-if="editing" :inset="true">
        <ion-item button :detail="false" @click="confirmDelete">
          <ion-icon slot="start" color="danger" :icon="trashOutline" />
          <ion-label color="danger">Delete list</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import UserAvatar from '@/components/UserAvatar.vue';
import { computed, ref } from 'vue';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonSearchbar,
  IonContent, IonList, IonListHeader, IonItem, IonInput, IonAvatar, IonLabel, IonCheckbox, IonIcon,
  actionSheetController,
} from '@ionic/vue';
import { trashOutline } from 'ionicons/icons';
import { useLiveQuery } from '@/composables/useLiveQuery';
import {
  listChats, createChatList, getChatList, renameChatList, setChatListMembers, deleteChatList,
} from '@/db/queries';
import type { Chat } from '@/db/types';

const props = defineProps<{ isOpen: boolean; listId?: string | null; presetChatIds?: string[] }>();
const emit = defineEmits<{ (e: 'dismiss'): void; (e: 'created', id: string): void }>();

const name = ref('');
const search = ref('');
const selected = ref<Set<string>>(new Set());
const editing = computed(() => !!props.listId);

const chats = useLiveQuery(() => listChats(search.value), ['chats'], [] as Chat[], () => search.value);

const canSave = computed(() => name.value.trim().length > 0);

// Reset/prefill each time the modal opens (will-present fires before it's shown).
async function init(): Promise<void> {
  search.value = '';
  if (props.listId) {
    const list = await getChatList(props.listId);
    name.value = list?.name ?? '';
    selected.value = new Set(list?.chatIds ?? []);
  } else {
    name.value = '';
    selected.value = new Set(props.presetChatIds ?? []);
  }
}

function toggle(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

async function save(): Promise<void> {
  if (!canSave.value) return;
  if (props.listId) {
    await renameChatList(props.listId, name.value);
    await setChatListMembers(props.listId, [...selected.value]);
    emit('created', props.listId);
  } else {
    const id = await createChatList(name.value, [...selected.value]);
    emit('created', id);
  }
  emit('dismiss');
}

async function confirmDelete(): Promise<void> {
  if (!props.listId) return;
  const sheet = await actionSheetController.create({
    header: `Delete "${name.value}"`,
    subHeader: "This will permanently delete this list. Your conversations won't be affected.",
    buttons: [
      { text: 'Delete list', role: 'destructive', handler: () => void deleteChatList(props.listId as string).then(() => emit('dismiss')) },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}
</script>

<style scoped>
.pick {
  pointer-events: none;
}
</style>
