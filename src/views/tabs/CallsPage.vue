<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>Calls</ion-title>
        <ion-buttons slot="end">
          <!-- Start a group call without first making a group chat: pick several
               contacts and ring them on a fresh room. -->
          <ion-button aria-label="New group call" @click="router.push('/new-group-call')">
            <ion-icon slot="icon-only" :icon="peopleOutline" />
          </ion-button>
          <ion-button aria-label="New call" @click="newOpen = true">
            <ion-icon slot="icon-only" :icon="addOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="search"
          placeholder="Search"
          @ion-input="search = $event.detail.value ?? ''"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Calls</ion-title>
        </ion-toolbar>
      </ion-header>

      <ion-list>
        <ion-list-header>
          <ion-label>Recent</ion-label>
        </ion-list-header>

        <ion-item-sliding v-for="group in visibleCalls" :key="group.id">
          <ion-item
            button
            :detail="false"
            @click="openInfo(group.contactId)"
          >
            <ion-avatar slot="start">
              <img :src="group.avatar" :alt="group.name" />
            </ion-avatar>
            <ion-label :color="group.missed ? 'danger' : undefined">
              <h2>
                {{ group.name }}
                <template v-if="group.count > 1"> ({{ group.count }})</template>
              </h2>
              <p>
                <ion-icon :icon="directionIcon(group)" />
                <ion-icon v-if="group.video" :icon="videocamOutline" />
                {{ typeLabel(group) }}
              </p>
            </ion-label>
            <ion-note slot="end">{{ formatTime(group.timestamp) }}</ion-note>
            <ion-button
              slot="end"
              fill="clear"
              @click.stop="openInfo(group.contactId)"
            >
              <ion-icon slot="icon-only" :icon="informationCircleOutline" color="primary" />
            </ion-button>
          </ion-item>
          <ion-item-options side="end">
            <ion-item-option color="danger" @click="removeGroup(group)">
              <ion-icon slot="icon-only" :icon="trashOutline" />
            </ion-item-option>
          </ion-item-options>
        </ion-item-sliding>
      </ion-list>

      <ion-infinite-scroll
        :disabled="visible >= calls.length"
        @ion-infinite="loadMore"
      >
        <ion-infinite-scroll-content />
      </ion-infinite-scroll>

      <div v-if="calls.length === 0" class="empty">
        <ion-note>No calls found</ion-note>
      </div>
    </ion-content>

    <!-- New call: pick a contact to open their call screen. -->
    <ion-modal :is-open="newOpen" @did-dismiss="newOpen = false">
      <ion-header :translucent="true">
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button @click="newOpen = false">Cancel</ion-button>
          </ion-buttons>
          <ion-title>New call</ion-title>
        </ion-toolbar>
        <ion-toolbar>
          <ion-searchbar
            :value="pickSearch"
            placeholder="Search name or number"
            @ion-input="pickSearch = $event.detail.value ?? ''"
          />
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <ion-list>
          <ion-list-header><ion-label>Contacts</ion-label></ion-list-header>
          <ion-item
            v-for="person in pickContacts"
            :key="person.id"
            button
            :detail="false"
            @click="callContact(person.id)"
          >
            <ion-avatar slot="start">
              <img :src="person.avatar" :alt="person.name" />
            </ion-avatar>
            <ion-label>
              <h2>{{ person.name }}</h2>
              <p>{{ person.about }}</p>
            </ion-label>
            <ion-icon slot="end" :icon="callOutline" color="primary" />
          </ion-item>
        </ion-list>
      </ion-content>
    </ion-modal>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonIcon, IonSearchbar, IonContent, IonList, IonListHeader, IonItem,
  IonItemSliding, IonItemOptions, IonItemOption,
  IonAvatar, IonLabel, IonNote, onIonViewDidEnter,
  IonInfiniteScroll, IonInfiniteScrollContent, IonModal,
} from '@ionic/vue';
import type { InfiniteScrollCustomEvent } from '@ionic/vue';
import {
  addOutline, callOutline, videocamOutline, arrowUpOutline, arrowDownOutline,
  informationCircleOutline, trashOutline, peopleOutline,
} from 'ionicons/icons';
import { deleteCalls, listCallGroups, markCallsSeen, listContacts } from '@/db/queries';
import type { CallGroup } from '@/db/queries';
import type { Call } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { formatTime } from '@/utils/time';

const PAGE = 15;
const router = useRouter();
const openInfo = (contactId: string) => router.push(`/call/${contactId}`);
const search = ref('');
const visible = ref(PAGE);
const calls = useLiveQuery(
  () => listCallGroups(search.value),
  ['calls'],
  [],
  () => search.value,
);
watch(search, () => (visible.value = PAGE));
const visibleCalls = computed(() => calls.value.slice(0, visible.value));

/* ---- New call modal ---- */
const newOpen = ref(false);
const pickSearch = ref('');
const pickContacts = useLiveQuery(
  () => listContacts(pickSearch.value),
  ['contacts'],
  [],
  () => pickSearch.value,
);
function callContact(contactId: string) {
  newOpen.value = false;
  router.push(`/call/${contactId}`);
}

function loadMore(ev: InfiniteScrollCustomEvent) {
  visible.value += PAGE;
  ev.target.complete();
}

const directionIcon = (c: Call) =>
  c.direction === 'outgoing' ? arrowUpOutline : arrowDownOutline;
const typeLabel = (c: Call) =>
  c.missed ? 'Missed' : c.direction === 'outgoing' ? 'Outgoing' : 'Incoming';

const removeGroup = (group: CallGroup) => deleteCalls(group.ids);

// Viewing the Calls tab clears the missed-call badge.
onIonViewDidEnter(() => void markCallsSeen());
</script>

<style scoped>
.empty {
  text-align: center;
  margin-top: 40px;
}
</style>
