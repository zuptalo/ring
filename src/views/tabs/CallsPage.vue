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

      <!-- Usage totals (spec 1025 US6): minutes and data for audio, video, and combined. -->
      <ion-list v-if="totalsCalls.length" :inset="true" class="call-totals">
        <ion-list-header>
          <ion-label>Totals</ion-label>
        </ion-list-header>
        <ion-item lines="none">
          <ion-icon slot="start" :icon="callOutline" color="medium" />
          <ion-label>Audio calls</ion-label>
          <ion-note slot="end">{{ totals.audioMinutes }} min · {{ formatBytes(totals.audioBytes) }}</ion-note>
        </ion-item>
        <ion-item lines="none">
          <ion-icon slot="start" :icon="videocamOutline" color="medium" />
          <ion-label>Video calls</ion-label>
          <ion-note slot="end">{{ totals.videoMinutes }} min · {{ formatBytes(totals.videoBytes) }}</ion-note>
        </ion-item>
        <ion-item lines="none">
          <ion-label>Data used</ion-label>
          <ion-note slot="end">{{ formatBytes(totals.combinedBytes) }}</ion-note>
        </ion-item>
      </ion-list>

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
              <user-avatar :src="group.avatar" :alt="group.name" />
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
            <ion-note slot="end">{{ formatDay(group.timestamp) }}</ion-note>
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

      <!-- No calls yet: a hint row points to Contacts to start a call (mirrors the
           Contacts "Browse user directory" row). -->
      <ion-list v-if="loaded && calls.length === 0" class="hint-list">
        <!-- router.replace (not push): a tab switch is terminal and must not grow
             history, like tapping the tab bar (see navigation.spec). -->
        <ion-item button :detail="true" lines="full" @click="router.replace('/tabs/contacts')">
          <ion-icon slot="start" :icon="peopleOutline" color="primary" />
          <ion-label>
            <h2>Start a call</h2>
            <p>Pick a contact to call</p>
          </ion-label>
        </ion-item>
      </ion-list>
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
              <user-avatar :src="person.avatar" :alt="person.name" />
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
import UserAvatar from '@/components/UserAvatar.vue';
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
import { deleteCalls, listCallGroups, listCallsForTotals, markCallsSeen, listContacts } from '@/db/queries';
import type { CallGroup } from '@/db/queries';
import type { Call } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { warmCalls, warmCallsLoaded, warmWhenIdle } from '@/composables/warmStores';
import { formatDay } from '@/utils/time';
import { formatBytes } from '@/utils/bytes';
import { computeCallTotals } from '@/utils/call-totals';

const PAGE = 15;
const router = useRouter();
const openInfo = (contactId: string) => router.push(`/call/${contactId}`);
const search = ref('');
const visible = ref(PAGE);
// Empty search → seed first paint from the warm calls store; a typed term falls
// back to the live query (spec 1001 "Search contract").
const calls = useLiveQuery(
  () => listCallGroups(search.value),
  ['calls'],
  [] as CallGroup[],
  () => search.value,
  warmWhenIdle(warmCalls, warmCallsLoaded, search),
);
// Gate the empty state so "No calls found" only shows once data has actually
// resolved (true immediately when seeded from the warm store), never as a flash
// before the list arrives (spec 1001 FR-006).
const loaded = calls.loaded;
watch(search, () => (visible.value = PAGE));
const visibleCalls = computed(() => calls.value.slice(0, visible.value));

// Usage totals (spec 1025 US6): all-time, over non-hidden calls, independent of the search filter.
const totalsCalls = useLiveQuery(() => listCallsForTotals(), ['calls'], [] as Call[]);
const totals = computed(() => computeCallTotals(totalsCalls.value));

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
  c.outcome === 'busy'
    ? 'Busy'
    : c.outcome === 'unavailable'
      ? 'Unavailable'
      : c.outcome === 'declined'
        ? 'Declined'
        : c.missed
          ? 'Missed'
          : c.direction === 'outgoing'
            ? 'Outgoing'
            : 'Incoming';

const removeGroup = (group: CallGroup) => deleteCalls(group.ids);

// Viewing the Calls tab clears the missed-call badge.
onIonViewDidEnter(() => void markCallsSeen());
</script>

<style scoped>
/* "Start a call" hint row, flush at the top like the Contacts browse row. */
.hint-list {
  padding-top: 0;
}
.hint-list ion-icon {
  font-size: 24px;
}
</style>
