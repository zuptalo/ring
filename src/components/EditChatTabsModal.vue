<template>
  <!-- "Edit Chats tab": choose up to 5 chips to pin to the top and reorder them.
       "All" is fixed/first; the rest are draggable + removable; everything else sits
       under "Available". Confirm with the green check. Mirrors WhatsApp's editor. -->
  <ion-modal :is-open="isOpen" @did-dismiss="$emit('dismiss')" @will-present="init">
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button @click="$emit('dismiss')">Cancel</ion-button>
        </ion-buttons>
        <ion-title>Edit Chats tab</ion-title>
        <ion-buttons slot="end">
          <ion-button color="success" :strong="true" @click="save">
            <ion-icon slot="icon-only" :icon="checkmarkOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <p class="hint">You can choose up to {{ MAX_TAB_FILTERS }} to appear at the top of your Chats tab and reorder them.</p>

      <ion-list :inset="true">
        <ion-list-header><ion-label>On Chats Tab</ion-label></ion-list-header>
        <!-- All: fixed, greyed, not removable/reorderable. -->
        <ion-item>
          <ion-label color="medium">All</ion-label>
        </ion-item>
        <ion-reorder-group :disabled="false" @ion-item-reorder="onReorder">
          <ion-item v-for="id in removable" :key="id">
            <ion-button slot="start" fill="clear" color="danger" aria-label="Remove" @click="removeChip(id)">
              <ion-icon slot="icon-only" :icon="removeCircle" />
            </ion-button>
            <ion-label>{{ labelOf(id) }}</ion-label>
            <ion-reorder slot="end" />
          </ion-item>
        </ion-reorder-group>
      </ion-list>

      <ion-list :inset="true">
        <ion-list-header><ion-label>Available</ion-label></ion-list-header>
        <ion-item v-for="id in available" :key="id">
          <ion-button slot="start" fill="clear" color="success" aria-label="Add" :disabled="atMax" @click="addChip(id)">
            <ion-icon slot="icon-only" :icon="addCircle" />
          </ion-button>
          <ion-label>{{ labelOf(id) }}</ion-label>
        </ion-item>
        <ion-item v-if="available.length === 0" lines="none">
          <ion-label color="medium">Everything is on your Chats tab.</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
  IonContent, IonList, IonListHeader, IonItem, IonLabel, IonReorderGroup, IonReorder,
  type ItemReorderCustomEvent,
} from '@ionic/vue';
import { checkmarkOutline, removeCircle, addCircle } from 'ionicons/icons';
import { useTabFilters, listIdOf, isListFilter, MAX_TAB_FILTERS, type FilterId } from '@/services/chat-filters';
import type { ChatList } from '@/db/types';

const props = defineProps<{ isOpen: boolean; lists: ChatList[]; tabFilters: FilterId[] }>();
const emit = defineEmits<{ (e: 'dismiss'): void }>();

const { save: persist } = useTabFilters();

const BUILTIN: FilterId[] = ['unread', 'favorites', 'groups'];
const BUILTIN_LABELS: Record<string, string> = { unread: 'Unread', favorites: 'Favorites', groups: 'Groups' };

// The draggable/removable chips currently on the tab (everything except the fixed "All").
const removable = ref<FilterId[]>([]);
const available = ref<FilterId[]>([]);

function allKnown(): FilterId[] {
  return [...BUILTIN, ...props.lists.map((l) => `list:${l.id}` as FilterId)];
}

function init(): void {
  const onTab = props.tabFilters.filter((id) => id !== 'all');
  // Keep only still-valid ids (a list may have been deleted).
  const valid = new Set(allKnown());
  removable.value = onTab.filter((id) => valid.has(id));
  const onSet = new Set(removable.value);
  available.value = allKnown().filter((id) => !onSet.has(id));
}

const atMax = computed(() => removable.value.length + 1 >= MAX_TAB_FILTERS); // +1 for All

function labelOf(id: FilterId): string {
  if (isListFilter(id)) return props.lists.find((l) => l.id === listIdOf(id))?.name ?? '';
  return BUILTIN_LABELS[id] ?? id;
}

function onReorder(ev: ItemReorderCustomEvent): void {
  removable.value = ev.detail.complete(removable.value) as FilterId[];
}
function removeChip(id: FilterId): void {
  removable.value = removable.value.filter((x) => x !== id);
  if (!available.value.includes(id)) available.value = [...available.value, id];
}
function addChip(id: FilterId): void {
  if (atMax.value) return;
  available.value = available.value.filter((x) => x !== id);
  removable.value = [...removable.value, id];
}
async function save(): Promise<void> {
  await persist(['all', ...removable.value]);
  emit('dismiss');
}
</script>

<style scoped>
.hint {
  padding: 8px 20px 0;
  color: var(--ion-color-medium);
  font-size: 14px;
  text-align: center;
}
</style>
