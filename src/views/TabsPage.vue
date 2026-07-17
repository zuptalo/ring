<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet></ion-router-outlet>
      <!-- Auth is a top-level route outside the tabs, so an unauthenticated user is
           never inside /tabs. The v-if still guards the brief logout transition
           (auth flips false before the redirect to /auth completes) so a bare bar
           never flashes. It reappears the instant auth state flips back. -->
      <!-- Tabs carry no `href`: tapping is handled by switchTab so the four tab roots
           are entered as a flat 'root' replace (terminal tabs — see switchTab). The
           `selected` binding is best-effort AFTER the first switch only: at load the
           @ionic/vue tab-bar wrapper imperatively resets the bar's selection to ""
           (its matching is href-based and finds nothing), so assistive tech reads no
           tab as selected until the first tap — a documented deferral, see spec 2024
           US2 / research D2.
           The active-tab highlight rides a `data-on` ATTRIBUTE, never a dynamic
           class (spec 2024 FR-003): a Vue :class binding on an Ionic custom element
           rewrites the element's whole className each time its value changes, wiping
           the Stencil-managed host classes (md/tab-has-label/tab-has-icon/…) that
           size the label — which is exactly how the tab names used to vanish one by
           one. Vue patches data-* via setAttribute, which touches nothing of
           Ionic's. -->
      <ion-tab-bar v-if="isAuthenticated" slot="bottom">
        <ion-tab-button tab="calls" :data-on="activeTab === 'calls' || undefined" :selected="activeTab === 'calls'" @click="switchTab('/tabs/calls')">
          <ion-icon :icon="activeTab === 'calls' ? call : callOutline" />
          <ion-label>Calls</ion-label>
          <ion-badge v-if="calls" color="danger">{{ calls }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="chats" :data-on="activeTab === 'chats' || undefined" :selected="activeTab === 'chats'" @click="switchTab('/tabs/chats')">
          <ion-icon :icon="activeTab === 'chats' ? chatbubbles : chatbubblesOutline" />
          <ion-label>Chats</ion-label>
          <ion-badge v-if="chats" color="primary">{{ chats }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="wall" :data-on="activeTab === 'wall' || undefined" :selected="activeTab === 'wall'" @click="switchTab('/tabs/wall')">
          <ion-icon :icon="activeTab === 'wall' ? sparkles : sparklesOutline" />
          <ion-label>Wall</ion-label>
          <ion-badge v-if="wall" color="primary">{{ wall }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="contacts" :data-on="activeTab === 'contacts' || undefined" :selected="activeTab === 'contacts'" @click="switchTab('/tabs/contacts')">
          <ion-icon :icon="activeTab === 'contacts' ? people : peopleOutline" />
          <ion-label>Contacts</ion-label>
          <ion-badge v-if="contacts" color="primary">{{ contacts }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="settings" :data-on="activeTab === 'settings' || undefined" :selected="activeTab === 'settings'" @click="switchTab('/tabs/settings')">
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

const { chats, calls, contacts, you, wall } = useBadges();

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
// Known wart (spec 2024 FR-007, out of scope): every tap ALSO runs @ionic/vue's
// built-in tab-click routing alongside this handler, which logs
// `[ion-tabs] - Tab with id: "undefined" does not exist` to the console. It is
// cosmetic; fixing it means touching the framework's click path and risking the
// transition tuning above.
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
  --color-selected: var(--ion-color-primary);
  /* The 32px circled icons + a label need ~56px, but iOS mode's bar is 50px and
     only LOOKS right when the home-indicator safe-area adds room below it. On
     inset-less screens (desktop PWA windows) the labels clipped at the window
     edge. On phones the inset padding already makes the bar taller than this,
     so the floor changes nothing there. */
  min-height: 58px;
  /* Match the chat composer footer: the same subtle toolbar tint, just slightly
     translucent with a gentle backdrop blur so the bar + its safe-area inset read as one
     quiet pane and anything scrolling underneath is softly frosted, not sharp. Borderless
     so there's no seam against the content. */
  --background: var(--app-tabbar-bg);
  --border: 0;
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
}
/* The buttons default to the same translucent tab-bar fill, which then stacks ON TOP of
   the bar's own fill — two semi-transparent layers doubling up into a darker band behind
   the button row. Make the buttons transparent so the bar provides the single frosted
   layer and the strip reads as one even tone. */
ion-tab-button {
  --background: transparent;
  --background-focused: transparent;
}

/* Telegram-style selection: a circular brand-green highlight sits behind the active
   tab's icon. Every icon carries the same circular padding (transparent when inactive)
   so switching tabs only fades the fill in/out — the icon never shifts. */
ion-tab-button ion-icon {
  /* True circle: the icon is a flex item in a short tab button, so a tall padding box
     gets vertically squished into an ellipse. Keep it small enough to fit the row and
     flex: none so it never compresses — equal box + 50% radius = a real circle. */
  font-size: 20px;
  width: 20px;
  height: 20px;
  padding: 6px;
  flex: none;
  border-radius: 50%;
  box-sizing: content-box;
  background: transparent;
  transition: background-color 0.18s ease, color 0.18s ease;
}
/* Drive the highlight off the app's own route-derived active tab via the `data-on`
   ATTRIBUTE — never a class, and not Ionic's `.tab-selected`. A dynamic Vue :class
   here clobbers the Stencil-managed host classes and collapses the labels (spec
   2024 FR-003), and `.tab-selected` isn't reliably present because the @ionic/vue
   wrapper resets the bar's selection at load (spec 2024 US2 deferral, research D2). */
ion-tab-button[data-on] ion-icon {
  background: rgba(var(--ion-color-primary-rgb), 0.18);
  color: var(--ion-color-primary);
}
</style>
