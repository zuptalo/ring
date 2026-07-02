<template>
  <ion-modal :is-open="open" @did-dismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button @click="$emit('close')">Cancel</ion-button></ion-buttons>
        <ion-title>{{ title ?? 'Share contact' }}</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="q"
          placeholder="Search contacts"
          @ion-input="q = String($event.detail.value ?? '')"
        />
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-list>
        <ion-item v-for="c in filtered" :key="c.id" button :detail="false" @click="pick(c)">
          <ion-avatar slot="start"><img :src="c.avatar" :alt="c.name" /></ion-avatar>
          <ion-label>{{ c.name }}</ion-label>
        </ion-item>
      </ion-list>
      <div v-if="!filtered.length" class="empty"><ion-note>{{ emptyText ?? 'No contacts to share' }}</ion-note></div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonList, IonItem, IonAvatar, IonLabel, IonSearchbar, IonNote,
} from '@ionic/vue';
import type { Contact, SharedContact } from '@/db/types';

// `title`/`emptyText` let callers repurpose the picker (e.g. "Add to call", spec
// 1028) without changing the default "Share contact" behaviour.
const props = defineProps<{ open: boolean; contacts: Contact[]; title?: string; emptyText?: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'select', c: SharedContact): void }>();

const q = ref('');
const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  const list = props.contacts.filter((c) => !c.id.startsWith('__'));
  return needle ? list.filter((c) => c.name.toLowerCase().includes(needle)) : list;
});

function pick(c: Contact): void {
  emit('select', { userId: c.id, name: c.name, avatar: c.avatar });
}
</script>

<style scoped>
.empty {
  text-align: center;
  margin-top: 40px;
}
</style>
