<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet></ion-router-outlet>
      <!-- Auth is a top-level route outside the tabs, so an unauthenticated user is
           never inside /tabs. The v-if still guards the brief logout transition
           (auth flips false before the redirect to /auth completes) so a bare bar
           never flashes. It reappears the instant auth state flips back. -->
      <ion-tab-bar v-if="isAuthenticated" slot="bottom">
        <ion-tab-button tab="calls" href="/tabs/calls">
          <ion-icon :icon="activeTab === 'calls' ? call : callOutline" />
          <ion-label>Calls</ion-label>
          <ion-badge v-if="calls" color="danger">{{ calls }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="chats" href="/tabs/chats">
          <ion-icon :icon="activeTab === 'chats' ? chatbubbles : chatbubblesOutline" />
          <ion-label>Chats</ion-label>
          <ion-badge v-if="chats" color="primary">{{ chats }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="contacts" href="/tabs/contacts">
          <ion-icon :icon="activeTab === 'contacts' ? people : peopleOutline" />
          <ion-label>Contacts</ion-label>
          <ion-badge v-if="contacts" color="primary">{{ contacts }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="settings" href="/tabs/settings">
          <ion-icon :icon="activeTab === 'settings' ? settings : settingsOutline" />
          <ion-label>Settings</ion-label>
          <ion-badge v-if="you" color="primary">{{ you }}</ion-badge>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonPage,
  IonTabs,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonIcon,
  IonLabel,
  IonBadge,
} from '@ionic/vue';
import {
  call, callOutline,
  chatbubbles, chatbubblesOutline,
  people, peopleOutline,
  settings, settingsOutline,
} from 'ionicons/icons';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useBadges } from '@/composables/useBadges';
import { isAuthenticated } from '@/services/auth';

const { chats, calls, contacts, you } = useBadges();

// Active tab derived from the URL; drives the filled-vs-outline icon swap.
const route = useRoute();
const activeTab = computed(() => {
  const m = route.path.match(/^\/tabs\/(\w+)/);
  return m ? m[1] : 'chats';
});
</script>

<style scoped>
/* Tab icons/labels track the theme's text colour: black in light, white in dark
   (--app-text flips with the palette). Both --color (inactive) and
   --color-selected (active) point at it, so the green tint is dropped and the
   active tab is shown purely by the filled-vs-outline icon swap. */
ion-tab-bar {
  --color: var(--app-text);
  --color-selected: var(--app-text);
  /* Match the chat footer / toolbars (a subtle brand-green tint) rather than the
     plain page background, so the bottom bar reads as one with the chrome. */
  --background: var(--ion-toolbar-background);
}
</style>
