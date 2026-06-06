<template>
  <!-- "Send to" picker: choose one or more chats to forward to. -->
  <ion-modal :is-open="open" @did-dismiss="onDismiss">
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button aria-label="Close" @click="$emit('close')"><ion-icon :icon="close" /></ion-button>
        </ion-buttons>
        <ion-title>Send to</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="q"
          placeholder="Search"
          @ion-input="q = $event.detail.value ?? ''"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Frequently contacted (by interaction count); hidden while searching. -->
      <ion-list v-if="frequent.length">
        <ion-list-header><ion-label>Frequently contacted</ion-label></ion-list-header>
        <ion-item v-for="c in frequent" :key="c.id" button :detail="false" @click="toggle(c.id)">
          <ion-avatar slot="start"><img :src="c.avatar" :alt="c.name" /></ion-avatar>
          <ion-label>{{ c.name }}</ion-label>
          <ion-checkbox slot="end" :checked="sel.has(c.id)" class="pick" aria-hidden="true" />
        </ion-item>
      </ion-list>

      <ion-list>
        <ion-list-header><ion-label>{{ q.trim() ? 'Results' : 'Recent chats' }}</ion-label></ion-list-header>
        <ion-item v-for="c in recent" :key="c.id" button :detail="false" @click="toggle(c.id)">
          <ion-avatar slot="start"><img :src="c.avatar" :alt="c.name" /></ion-avatar>
          <ion-label>{{ c.name }}</ion-label>
          <ion-checkbox slot="end" :checked="sel.has(c.id)" class="pick" aria-hidden="true" />
        </ion-item>
        <ion-item v-if="recent.length === 0 && frequent.length === 0" lines="none">
          <ion-label color="medium">No matching chats</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>

    <ion-footer v-if="sel.size">
      <ion-toolbar>
        <ion-button class="send-btn" expand="block" shape="round" @click="send">
          Send to {{ sel.size }}
        </ion-button>
      </ion-toolbar>
    </ion-footer>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  IonModal, IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonSearchbar,
  IonContent, IonList, IonListHeader, IonItem, IonAvatar, IonLabel, IonCheckbox, IonFooter, IonIcon,
} from '@ionic/vue';
import { close } from 'ionicons/icons';
import { listChats, listContacts } from '@/db/queries';
import type { Chat, Contact } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'send', chatIds: string[]): void; (e: 'close'): void }>();

const q = ref('');
const sel = ref<Set<string>>(new Set());
const chats = useLiveQuery(() => listChats(), ['chats'], [] as Chat[]);
const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);
// Can't forward to a peer who deleted their account (ghosted) or whom we've blocked.
const unsendable = computed(
  () => new Set(contacts.value.filter((c) => c.ghosted || c.blocked).map((c) => c.id)),
);
const sendable = computed(() =>
  chats.value.filter((c) => c.isGroup || !unsendable.value.has(c.participantIds[0])),
);
const filtered = computed(() =>
  sendable.value.filter((c) => c.name.toLowerCase().includes(q.value.trim().toLowerCase())),
);
// Top chats by interaction count → "Frequently contacted" (only when not searching).
const frequent = computed(() => {
  if (q.value.trim()) return [];
  return sendable.value
    .filter((c) => (c.interactions ?? 0) > 0)
    .sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0))
    .slice(0, 5);
});
// The rest, by recency (listChats already sorts newest-first), minus the frequent.
const recent = computed(() => {
  const freq = new Set(frequent.value.map((c) => c.id));
  return filtered.value.filter((c) => !freq.has(c.id));
});

watch(() => props.open, (o) => {
  if (o) {
    sel.value = new Set();
    q.value = '';
  }
});

function toggle(id: string): void {
  const next = new Set(sel.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  sel.value = next;
}
function send(): void {
  emit('send', [...sel.value]);
}
function onDismiss(): void {
  emit('close');
}
</script>

<style scoped>
.pick {
  pointer-events: none;
}
.send-btn {
  margin: 4px 10px;
}
</style>
