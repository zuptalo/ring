<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>Settings</ion-title>
        <ion-buttons slot="end">
          <ion-button aria-label="My QR code" @click="open('qr')">
            <ion-icon slot="icon-only" :icon="ICONS.qr" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="search"
          placeholder="Search settings"
          @ion-input="search = $event.detail.value ?? ''"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Settings</ion-title>
        </ion-toolbar>
      </ion-header>

      <!-- Search results: flat matches across the whole settings tree. -->
      <template v-if="query">
        <ion-list :inset="true" v-if="results.length">
          <ion-item
            v-for="r in results"
            :key="r.path + '|' + r.title"
            button
            :detail="true"
            @click="go(r.path)"
          >
            <ion-icon v-if="r.icon" slot="start" :icon="ICONS[r.icon]" color="primary" />
            <ion-label class="ion-text-wrap">
              <h2>{{ r.title }}</h2>
              <p v-if="r.context">{{ r.context }}</p>
            </ion-label>
          </ion-item>
        </ion-list>
        <div v-else class="ion-padding ion-text-center">
          <ion-note>No settings found</ion-note>
        </div>
      </template>

      <!-- Default settings home. -->
      <template v-else>
      <div class="profile ion-text-center" role="button" @click="open('profile')">
        <ion-avatar class="profile-avatar">
          <img :src="avatar" :alt="profileName" />
        </ion-avatar>
        <h2>{{ profileName }}</h2>
        <p>{{ about }}</p>
      </div>

      <ion-list :inset="true" v-if="alerts.length">
        <ion-list-header>
          <ion-label>Needs attention</ion-label>
        </ion-list-header>
        <ion-item
          v-for="alert in alerts"
          :key="alert.id"
          button
          :detail="true"
          @click="handleAlert(alert)"
        >
          <ion-icon slot="start" :icon="warningOutline" color="warning" />
          <ion-label class="ion-text-wrap">
            <h2>{{ alert.title }}</h2>
            <p>{{ alert.body }}</p>
          </ion-label>
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-item
          v-for="sec in YOU_SECTIONS"
          :key="sec.id"
          button
          :detail="true"
          @click="open(sec.id)"
        >
          <ion-icon slot="start" :icon="ICONS[sec.icon]" color="primary" />
          <ion-label>{{ sec.title }}</ion-label>
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-item button :detail="false" @click="logout">
          <ion-icon slot="start" :icon="logOutOutline" color="danger" />
          <ion-label color="danger">Log out</ion-label>
        </ion-item>
      </ion-list>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonList,
  IonListHeader, IonItem, IonAvatar, IonLabel, IonIcon, IonNote,
  IonButtons, IonButton, IonSearchbar,
} from '@ionic/vue';
import { logOutOutline, warningOutline } from 'ionicons/icons';
import { YOU_SECTIONS, ICONS, searchSettings } from '@/settings/schema';
import { clearToken } from '@/services/auth';
import { listAlerts, resolveAlert } from '@/db/queries';
import type { Alert } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useSelfProfile } from '@/composables/useSelfProfile';

const router = useRouter();
const open = (section: string) => router.push(`/settings/${section}`);
const go = (path: string) => router.push(path);

// Global settings search: filters a flat index of the whole tree.
const search = ref('');
const query = computed(() => search.value.trim());
const results = computed(() => searchSettings(search.value));

const alerts = useLiveQuery(() => listAlerts(), ['alerts'], [] as Alert[]);
async function handleAlert(alert: Alert) {
  await resolveAlert(alert.id);
  router.push(`/settings/${alert.section}`);
}

// Own profile from the shared warm singleton: decrypted once at unlock and kept
// live, so the header shows the real name/photo on first paint instead of the
// "You"/initials placeholder that used to swap in a moment later (spec 1001).
const { name: profileName, avatar, about } = useSelfProfile();

function logout() {
  clearToken();
  // Back to the top-level Auth page (the app's sole public route).
  router.replace('/auth');
}

</script>

<style scoped>
/* Large centered profile header, matching the ContactDetailPage pattern. */
.profile {
  padding: 24px 16px 8px;
}
.profile-avatar {
  width: 96px;
  height: 96px;
  margin: 0 auto 12px;
}
.profile h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.profile p {
  margin: 4px 0 0;
  color: var(--app-text-muted);
}
</style>
