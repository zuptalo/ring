<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/calls" />
        </ion-buttons>
        <ion-title>New group call</ion-title>
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
        <ion-list-header>
          <ion-label>Participants ({{ selected.size }})</ion-label>
        </ion-list-header>
        <!-- Once the selection hits the audio cap, unselected rows are disabled (you can't
             add a 9th person to any group call). Already-picked rows stay tappable to deselect. -->
        <ion-item
          v-for="c in contacts"
          :key="c.id"
          button
          :detail="false"
          :disabled="selectionFull && !selected.has(c.id)"
          @click="toggle(c.id)"
        >
          <ion-avatar slot="start">
            <user-avatar :src="c.avatar" :alt="c.name" />
          </ion-avatar>
          <ion-label>{{ c.name }}</ion-label>
          <!-- Presentational only: the row's tap toggles selection (pointer-events: none). -->
          <ion-checkbox slot="end" :checked="selected.has(c.id)" class="pick" aria-hidden="true" />
        </ion-item>
        <ion-item v-if="contacts.length === 0" lines="none">
          <ion-label color="medium">{{ search ? 'No matching contacts' : 'Add some contacts first to start a call.' }}</ion-label>
        </ion-item>
      </ion-list>

      <!-- Everyone you pick is meshed together for this call, even if they aren't each
           other's contacts — they're introduced just for its duration. -->
      <p v-if="selected.size > 0" class="hint">
        Calls {{ selectedNames }}. They’ll be able to see and hear each other for this call.
      </p>
      <!-- Why video is unavailable once the group is too big for a video call. -->
      <p v-if="canStart && !videoAllowed" class="hint">
        Video calls are limited to {{ VIDEO_MAX }} people — pick {{ VIDEO_MAX - 1 }} or fewer for video, or start a voice call.
      </p>
    </ion-content>

    <!-- Pick the participants above, then choose voice or video to ring them. -->
    <ion-footer v-if="canStart" class="start-bar">
      <ion-toolbar>
        <div class="start-actions">
          <ion-button fill="outline" @click="start('audio')">
            <ion-icon slot="start" :icon="callOutline" />
            Voice
          </ion-button>
          <!-- Disabled past the video cap (the group is too big for a video call). -->
          <ion-button :disabled="!videoAllowed" @click="start('video')">
            <ion-icon slot="start" :icon="videocamOutline" />
            Video
          </ion-button>
        </div>
      </ion-toolbar>
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
import UserAvatar from '@/components/UserAvatar.vue';
import { computed, ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonContent, IonList, IonListHeader, IonItem, IonAvatar, IonLabel, IonCheckbox,
  IonSearchbar, IonIcon, IonFooter,
} from '@ionic/vue';
import { callOutline, videocamOutline } from 'ionicons/icons';
import { listContacts } from '@/db/queries';
import type { Contact } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useRouter } from 'vue-router';
import { startAdHocGroupCall } from '@/composables/useCall';
import { VIDEO_MAX, AUDIO_MAX } from '@/services/call/types';
import { appToast } from '@/services/toast';
import { ensureProfile } from '@/composables/useProfileGate';

const router = useRouter();
const search = ref('');
const selected = ref<Set<string>>(new Set());

const contacts = useLiveQuery(
  () => listContacts(search.value),
  ['contacts', 'chats'],
  [] as Contact[],
  () => search.value,
);

const canStart = computed(() => selected.value.size > 0);
// Caps include US, so the picker selects at most cap-1 others (spec 0004 US3): up to
// AUDIO_MAX-1 in total, and a video call needs the count within VIDEO_MAX-1.
const maxSelectable = AUDIO_MAX - 1;
const selectionFull = computed(() => selected.value.size >= maxSelectable);
const videoAllowed = computed(() => selected.value.size <= VIDEO_MAX - 1);

function toggle(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    // Don't let the selection exceed the largest call we can place (audio cap).
    if (selectionFull.value) {
      void appToast({ message: `A group call is limited to ${AUDIO_MAX} people`, duration: 2000 });
      return;
    }
    next.add(id);
  }
  selected.value = next;
}

// The selected contacts' names (for the hint + the initiator's call-screen title). The
// callees see a generic "Group call" since the room has no chat behind it.
const selectedContacts = computed(() => contacts.value.filter((c) => selected.value.has(c.id)));
const selectedNames = computed(() => {
  const names = selectedContacts.value.map((c) => c.name);
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
});

async function start(kind: 'audio' | 'video'): Promise<void> {
  if (!canStart.value) return;
  // Participant cap (spec 0004 US3): the call includes us, so selected + 1 must fit the
  // kind's cap (4 video / 8 audio). The server enforces this authoritatively too.
  const cap = kind === 'video' ? VIDEO_MAX : AUDIO_MAX;
  if (selected.value.size + 1 > cap) {
    await appToast({ message: `A ${kind} call is limited to ${cap} people`, duration: 2200 });
    return;
  }
  if (!(await ensureProfile())) return; // a group call sends your card; require name + photo
  const members = [...selected.value];
  const name = selectedNames.value || 'Group call';
  // startAdHocGroupCall navigates to the active-call screen; replace this picker so a
  // back-swipe from the call doesn't return here.
  router.replace('/tabs/calls');
  await startAdHocGroupCall(members, kind, name);
}
</script>

<style scoped>
/* The whole row toggles selection; the checkbox is just an indicator. */
.pick {
  pointer-events: none;
}
.hint {
  margin: 4px 20px 16px;
  font-size: 13px;
  color: var(--app-text-muted);
}
.start-bar .start-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  padding: 6px 12px;
}
.start-bar ion-button {
  min-width: 120px;
}
</style>
