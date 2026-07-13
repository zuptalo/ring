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

      <!-- Quick Calls (spec 1046): one-tap call tiles for the people and groups you
           always call. The old Totals block moved to Settings → Storage and data →
           Network usage, freeing this prime spot. -->
      <QuickCallsRow
        :entries="quickEntries"
        :contacts="allContacts"
        :groups="groupChats"
        @call="quickCall"
        @manage="manageQuick"
        @add="addQuickOpen = true"
      />

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

    <!-- Add a Quick Call: pick a contact or a group, then a method the target's
         size allows (video ≤ 4, audio ≤ 8, counting me — spec 1046 FR-004). -->
    <ion-modal :is-open="addQuickOpen" @did-dismiss="addQuickOpen = false">
      <ion-header :translucent="true">
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button @click="addQuickOpen = false">Cancel</ion-button>
          </ion-buttons>
          <ion-title>Add quick call</ion-title>
        </ion-toolbar>
        <ion-toolbar>
          <ion-searchbar
            :value="quickSearch"
            placeholder="Search name"
            @ion-input="quickSearch = $event.detail.value ?? ''"
          />
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <ion-list v-if="quickPickGroups.length">
          <ion-list-header><ion-label>Groups</ion-label></ion-list-header>
          <ion-item
            v-for="g in quickPickGroups"
            :key="g.id"
            button
            :detail="false"
            :disabled="!g.addable"
            @click="pickQuickTarget('group', g.chat)"
          >
            <ion-avatar slot="start">
              <user-avatar :src="g.chat.avatar" :alt="g.chat.name" />
            </ion-avatar>
            <ion-label>
              <h2 dir="auto">{{ g.chat.name }}</h2>
              <!-- Why a too-big group can't be a quick call (audio is the roomier cap). -->
              <p>{{ g.addable ? `${g.size} people` : `Audio calls are limited to ${AUDIO_MAX} people` }}</p>
            </ion-label>
            <ion-icon slot="end" :icon="peopleOutline" color="primary" />
          </ion-item>
        </ion-list>
        <ion-list>
          <ion-list-header><ion-label>Contacts</ion-label></ion-list-header>
          <ion-item
            v-for="person in quickPickContacts"
            :key="person.id"
            button
            :detail="false"
            @click="pickQuickTarget('contact', person)"
          >
            <ion-avatar slot="start">
              <user-avatar :src="person.avatar" :alt="person.name" />
            </ion-avatar>
            <ion-label>
              <h2 dir="auto">{{ person.name }}</h2>
              <p>{{ person.about }}</p>
            </ion-label>
            <ion-icon slot="end" :icon="callOutline" color="primary" />
          </ion-item>
        </ion-list>
      </ion-content>
    </ion-modal>

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
  IonInfiniteScroll, IonInfiniteScrollContent, IonModal, actionSheetController,
} from '@ionic/vue';
import type { InfiniteScrollCustomEvent } from '@ionic/vue';
import {
  addOutline, callOutline, videocamOutline, arrowUpOutline, arrowDownOutline,
  informationCircleOutline, trashOutline, peopleOutline,
} from 'ionicons/icons';
import {
  deleteCalls, listCallGroups, markCallsSeen, listContacts, listChats, getSetting, setSetting,
} from '@/db/queries';
import type { CallGroup } from '@/db/queries';
import type { Call, Chat, Contact } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { warmCalls, warmCallsLoaded, warmWhenIdle } from '@/composables/warmStores';
import { formatDay } from '@/utils/time';
import QuickCallsRow from '@/components/QuickCallsRow.vue';
import {
  parseQuickCalls, upsertEntry, removeEntry, entryVerdict, callSize, allowedKinds,
  QUICK_CALLS_KEY, type QuickCallEntry, type QuickCallKind,
} from '@/utils/quick-calls';
import { VIDEO_MAX, AUDIO_MAX } from '@/services/call/types';
import { startDirectCall, startGroupCall } from '@/composables/useCall';
import { ensureProfile } from '@/composables/useProfileGate';
import { appToast } from '@/services/toast';

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

/* ---- Quick Calls (spec 1046) ---- */

// The synced entry list (settings ledger, like chats.tabFilters) + the records
// the tiles resolve against. listChats is the hidden/locked/archived choke
// point, so concealed groups can never surface as tiles or picker rows.
const quickEntries = useLiveQuery(
  () => getSetting<unknown>(QUICK_CALLS_KEY, []).then(parseQuickCalls),
  ['settings'],
  [] as QuickCallEntry[],
);
const allContacts = useLiveQuery(() => listContacts(), ['contacts', 'chats'], [] as Contact[]);
const visibleChats = useLiveQuery(() => listChats(), ['chats', 'messages'], [] as Chat[]);
const groupChats = computed(() => visibleChats.value.filter((c) => c.isGroup));

async function saveQuick(next: QuickCallEntry[]): Promise<void> {
  // Strip Vue reactivity before persisting: entries coming back out of the
  // live-query ref are Proxies, and IndexedDB's structured clone rejects
  // Proxies (DataCloneError) — plain literals only.
  await setSetting(QUICK_CALLS_KEY, next.map((e) => ({ t: e.t, id: e.id, kind: e.kind })));
}

/** One tap = ring, or explain (spec 1046 SC-002): the verdict is re-derived at
 *  tap time because groups grow after an entry is created. */
async function quickCall(entry: QuickCallEntry): Promise<void> {
  const target =
    entry.t === 'contact'
      ? allContacts.value.find((c) => c.id === entry.id)
      : groupChats.value.find((g) => g.id === entry.id);
  const verdict = entryVerdict(entry, target);
  if (!verdict.ok || !target) {
    await manageQuick(entry); // the sheet carries the reason + fix/remove actions
    return;
  }
  if (entry.t === 'contact') {
    await startDirectCall(entry.id, entry.kind);
    return;
  }
  const g = target as Chat;
  if (!(await ensureProfile())) return; // a group call sends your card
  await startGroupCall(g.id, entry.kind, g.name, g.avatar, g.participantIds);
}

/** Manage sheet (long-press / right-click / any blocked tap): switch method
 *  (cap-aware, with the reason when blocked) or remove. */
async function manageQuick(entry: QuickCallEntry): Promise<void> {
  const target =
    entry.t === 'contact'
      ? allContacts.value.find((c) => c.id === entry.id)
      : groupChats.value.find((g) => g.id === entry.id);
  const verdict = entryVerdict(entry, target);
  const other: QuickCallKind = entry.kind === 'audio' ? 'video' : 'audio';
  const otherAllowed = !!target && allowedKinds(callSize(entry, target)).includes(other);
  const sheet = await actionSheetController.create({
    header: target?.name ?? 'Quick call',
    subHeader: verdict.ok ? undefined : verdict.reason,
    buttons: [
      // Switching is offered whenever a target exists; a blocked switch explains
      // (FR-004: the reason accompanies the block) instead of silently hiding.
      ...(target
        ? [{
            text: other === 'video' ? 'Switch to video' : 'Switch to voice',
            handler: () => {
              if (!otherAllowed) {
                void appToast({
                  message:
                    other === 'video'
                      ? `Video calls are limited to ${VIDEO_MAX} people`
                      : `Audio calls are limited to ${AUDIO_MAX} people`,
                  duration: 2200,
                });
                return;
              }
              void saveQuick(upsertEntry(quickEntries.value, { ...entry, kind: other }));
            },
          }]
        : []),
      {
        text: 'Remove quick call',
        role: 'destructive' as const,
        handler: () => void saveQuick(removeEntry(quickEntries.value, entry)),
      },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}

/* ---- Add-quick-call picker ---- */
const addQuickOpen = ref(false);
const quickSearch = ref('');
const quickPickContacts = useLiveQuery(
  () => listContacts(quickSearch.value),
  ['contacts', 'chats'],
  [] as Contact[],
  () => quickSearch.value,
);
// Groups list carries its call size; too-big-for-audio groups render disabled
// with the reason (FR-004: a group beyond 8 can't be a quick call at all).
const quickPickGroups = computed(() => {
  const q = quickSearch.value.trim().toLowerCase();
  return groupChats.value
    .filter((g) => !q || g.name.toLowerCase().includes(q))
    .map((chat) => {
      const size = chat.participantIds.length + 1;
      return { id: chat.id, chat, size, addable: allowedKinds(size).length > 0 };
    });
});

async function pickQuickTarget(t: 'contact' | 'group', rec: Contact | Chat): Promise<void> {
  const entry = { t, id: rec.id } as const;
  const size = t === 'group' ? (rec as Chat).participantIds.length + 1 : 2;
  const kinds = allowedKinds(size);
  if (!kinds.length) return; // the row is disabled; defensive for a race
  const save = (kind: QuickCallKind) => {
    void saveQuick(upsertEntry(quickEntries.value, { ...entry, kind }));
    addQuickOpen.value = false;
  };
  const sheet = await actionSheetController.create({
    header: rec.name,
    // Why video is missing for a 5–8 person group (FR-004).
    subHeader: kinds.includes('video') ? undefined : `Video calls are limited to ${VIDEO_MAX} people`,
    buttons: [
      { text: 'Voice call', handler: () => save('audio') },
      ...(kinds.includes('video') ? [{ text: 'Video call', handler: () => save('video') }] : []),
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}

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
