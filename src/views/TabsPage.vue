<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet></ion-router-outlet>
      <!-- Auth is a top-level route outside the tabs, so an unauthenticated user is
           never inside /tabs. The v-if still guards the brief logout transition
           (auth flips false before the redirect to /auth completes) so a bare bar
           never flashes. It reappears the instant auth state flips back. -->
      <!-- Tabs carry no `href`: tapping is handled by switchTab so the four tab roots
           are entered as a flat 'root' replace (terminal tabs — see switchTab). We bind
           `selected` explicitly (normally ion-tabs sets it off the href it navigates)
           so the active tab still reports correctly for assistive tech. -->
      <ion-tab-bar v-if="isAuthenticated" slot="bottom">
        <ion-tab-button tab="calls" :selected="activeTab === 'calls'" @click="switchTab('/tabs/calls')">
          <ion-icon :icon="activeTab === 'calls' ? call : callOutline" />
          <ion-label>Calls</ion-label>
          <ion-badge v-if="calls" color="danger">{{ calls }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="chats" :selected="activeTab === 'chats'" @click="switchTab('/tabs/chats')">
          <ion-icon :icon="activeTab === 'chats' ? chatbubbles : chatbubblesOutline" />
          <ion-label>Chats</ion-label>
          <ion-badge v-if="chats" color="primary">{{ chats }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="wall" :selected="activeTab === 'wall'" @click="switchTab('/tabs/wall')">
          <ion-icon :icon="activeTab === 'wall' ? sparkles : sparklesOutline" />
          <ion-label>Wall</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="contacts" :selected="activeTab === 'contacts'" @click="switchTab('/tabs/contacts')">
          <ion-icon :icon="activeTab === 'contacts' ? people : peopleOutline" />
          <ion-label>Contacts</ion-label>
          <ion-badge v-if="contacts" color="primary">{{ contacts }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="settings" :selected="activeTab === 'settings'" @click="switchTab('/tabs/settings')">
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
  useIonRouter,
  createAnimation,
} from '@ionic/vue';
import {
  call, callOutline,
  chatbubbles, chatbubblesOutline,
  sparkles, sparklesOutline,
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

// Tabs are terminal (WhatsApp-style): the iOS PWA back-swipe walks browser history, so
// hopping between tabs must not pile up entries. We navigate through Ionic's own router
// with an explicit 'root' direction + 'replace' action: 'replace' keeps the history flat
// (the back-swipe from any main list leaves the app), and 'root' gives the nested tabs
// outlet an unambiguous root transition so the page reliably swaps in — the exact problem
// the previous bare-`replace` router guard caused once you'd drilled into a detail page
// and backed out (highlight changed, page didn't). Re-tapping the current tab is a no-op
// (detail pages are full-screen and hide the bar, so there's no in-tab stack to reset).
const ionRouter = useIonRouter();
// A tab bar should feel instant — no page slide — so hand the outlet an empty
// animation. The 'root' direction is still what fixes the desync (the outlet does a
// clean root-level commit); the empty animation only suppresses the visual transition,
// matching how tab switches looked before (and keeping main.ts's navAnimation, which
// only fast-paths the 'back' direction, from sliding a 'root' tab switch).
function switchTab(path: string): void {
  if (route.path === path) return;
  ionRouter.navigate(path, 'root', 'replace', () => createAnimation());
}
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
