<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/chats" />
        </ion-buttons>
        <ion-title>New group</ion-title>
        <ion-buttons slot="end">
          <ion-button :disabled="!canCreate" @click="create">Create</ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="search"
          placeholder="Search contacts"
          @ion-input="search = $event.detail.value ?? ''"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-list :inset="true">
        <ion-item>
          <ion-input
            v-model="name"
            label="Group name (optional)"
            label-placement="stacked"
            placeholder="Defaults to members' names"
            :maxlength="60"
          />
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-list-header>
          <ion-label>Members ({{ selected.size }})</ion-label>
        </ion-list-header>
        <ion-item v-for="c in contacts" :key="c.id" button :detail="false" @click="toggle(c.id)">
          <ion-avatar slot="start">
            <img :src="c.avatar" :alt="c.name" />
          </ion-avatar>
          <ion-label>{{ c.name }}</ion-label>
          <!-- Presentational only: the row's tap toggles selection, so the
               checkbox must not intercept the click (pointer-events: none). -->
          <ion-checkbox slot="end" :checked="selected.has(c.id)" class="pick" aria-hidden="true" />
        </ion-item>
        <ion-item v-if="contacts.length === 0" lines="none">
          <ion-label color="medium">{{ search ? 'No matching contacts' : 'Add some contacts first to start a group.' }}</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonContent, IonList, IonListHeader, IonItem, IonInput, IonAvatar, IonLabel, IonCheckbox,
  IonSearchbar,
} from '@ionic/vue';
import { listContacts, createGroup } from '@/db/queries';
import type { Contact } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { ensureProfile } from '@/composables/useProfileGate';

const router = useRouter();
const name = ref('');
const search = ref('');
const selected = ref<Set<string>>(new Set());

const contacts = useLiveQuery(
  () => listContacts(search.value),
  ['contacts', 'chats'],
  [] as Contact[],
  () => search.value,
);

// Name is optional, a group just needs at least one member.
const canCreate = computed(() => selected.value.size > 0);

function toggle(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

async function create(): Promise<void> {
  if (!canCreate.value) return;
  if (!(await ensureProfile())) return; // require a name + photo before creating a group
  const groupId = await createGroup(name.value, [...selected.value]);
  router.replace(`/chat/${groupId}`);
}
</script>

<style scoped>
/* The whole row toggles selection; the checkbox is just an indicator. */
.pick {
  pointer-events: none;
}
</style>
