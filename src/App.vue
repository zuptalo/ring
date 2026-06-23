<template>
  <ion-app>
    <!-- The router outlet stays permanently mounted/visible. Ionic's outlet
         must be a stable element or its swipe-back/transition machinery gets
         corrupted (toggling it breaks navigation). The key gate is a full,
         opaque ion-page that simply OVERLAYS this when locked (see KeyGuard). -->
    <ion-router-outlet />
    <key-guard />
    <!-- Outermost gate: blocks a plain browser tab until Ring is installed
         (overlays everything, including the key gate). -->
    <install-guard />
    <!-- Global incoming-call ringer: a non-blocking banner while a call rings. -->
    <incoming-call-overlay />
    <!-- Floating call widget when a call runs but the call screen is minimized. -->
    <minimized-call />
    <!-- Hovering media-audio controller while a voice message / music plays (it
         persists across navigation; spec 1007). -->
    <minimized-audio />
    <!-- Persistent remote-audio sink: keeps call audio playing across navigation
         (e.g. while minimized), independent of any call screen. -->
    <call-media-sink />
    <!-- In-app notification banners (green, with avatar + name): over any route. -->
    <notification-banners />
  </ion-app>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { isAuthenticated } from '@/services/auth';
import { isUnlockedNow, isUnlocked } from '@/services/crypto/identity';
import { warmAll, clearWarm } from '@/composables/warmStores';
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { alertCircleOutline } from 'ionicons/icons';
import { inviteNeedsProfile } from '@/services/invites';
import { appToast } from '@/services/toast';
import { showActionBanner, dismissActionBanner } from '@/services/notify';
import { useViewportHeight } from '@/composables/useViewportHeight';
import { useTheme } from '@/composables/useTheme';
import { useAppBadge } from '@/composables/useAppBadge';
import { useAutoLock } from '@/composables/useAutoLock';
import KeyGuard from '@/components/KeyGuard.vue';
import InstallGuard from '@/components/InstallGuard.vue';
import IncomingCallOverlay from '@/components/IncomingCallOverlay.vue';
import MinimizedCall from '@/components/MinimizedCall.vue';
import MinimizedAudio from '@/components/MinimizedAudio.vue';
import CallMediaSink from '@/components/CallMediaSink.vue';
import NotificationBanners from '@/components/NotificationBanners.vue';
import { callState } from '@/composables/useCall';
import { stopAudio } from '@/composables/useAudioPlayer';
import { useSync, nudgeReconnect } from '@/composables/useSync';
import { useAppUpdate, checkForUpdate } from '@/composables/useAppUpdate';
import { countPendingRequests, listChats, listFailedMessages, retryAllFailed, syncPosts } from '@/db/queries';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { Message } from '@/db/types';

// Owns the transport and sync engine: connects when registered, drains the
// outbox, and applies inbound frames (delivery receipts, records, tombstones).
useSync();

// Registers the service worker and prompts (with the version) when a new deploy is
// ready, instead of silently reloading. See useAppUpdate + vite.config 'prompt'.
useAppUpdate();

const router = useRouter();

// Warm the shared in-memory stores (own profile + chat/call/contact lists) the
// instant the keystore unlocks, so a tab's first paint is already populated and
// Settings shows the real identity without a placeholder swap. Clearing on every
// session-end (lock / sign-out / account removal all flip isUnlocked → false)
// wipes the decrypted plaintext from memory — it never touches disk (spec 1001,
// FR-ZK-1/FR-ZK-2). immediate: handle an already-unlocked state at startup.
watch(
  isUnlocked,
  (unlocked) => {
    if (unlocked) void warmAll();
    else {
      clearWarm();
      stopAudio(); // never leave media audio playing once locked / signed out
    }
  },
  { immediate: true },
);

// If authentication is lost mid-session, e.g. the server no longer recognizes
// this device (account deleted / database wiped) and verifySessionOrReset wiped
// us back to fresh, land on the Auth view automatically.
watch(isAuthenticated, (authed) => {
  if (!authed && router.currentRoute.value.path !== '/auth') {
    router.replace('/auth');
  }
});

// A user who joined via an invite must set up their profile (name + photo)
// before they auto-connect to their inviter, otherwise the inviter would see
// them as "You" with no image. Send them to profile setup.
watch(inviteNeedsProfile, async (needs) => {
  if (!needs || router.currentRoute.value.path === '/settings/profile') return;
  // While still in the sign-in/onboarding flow (/auth), the mandatory profile step
  // there already collects name + photo; don't race it with a second prompt.
  if (router.currentRoute.value.path === '/auth') return;
  await appToast({ message: 'Add your name and photo so people know it’s you.', duration: 2800 });
  router.push('/settings/profile');
});

// Sticky "failed to send" notice: when one or more outgoing messages have
// exhausted their auto-retries, show a persistent in-app banner with a Retry action.
// It renders through the SAME overlay/component as every other in-app notification
// (NotificationBanners.vue) — a danger-toned, persistent action card keyed by a fixed
// url so re-showing it updates the count in place rather than stacking. Dismisses
// itself once nothing is failed.
const FAILED_SENDS_URL = 'failed-sends';
const failedSends = useLiveQuery<Message[]>(() => listFailedMessages(), ['messages'], []);
function failedMessageText(msgs: Message[]): string {
  const n = msgs.length;
  // When every failure is a size rejection, say so specifically. Retrying won't
  // help unless the file is made smaller (a lower quality / shorter clip).
  if (n > 0 && msgs.every((m) => m.failReason === 'too-large')) {
    return n === 1 ? 'A file is too large to send.' : `${n} files are too large to send.`;
  }
  return n === 1 ? "A message couldn't be sent." : `${n} messages couldn't be sent.`;
}
// Re-run when the set of failed messages changes by COUNT or reason, so the wording
// updates (e.g. a new too-large failure) even if the count is unchanged. Re-showing the
// banner with the same url replaces it in place (no flicker — the card is keyed by url).
watch(
  () => failedSends.value.map((m) => `${m.id}:${m.failReason ?? ''}`).join(','),
  () => {
    const msgs = failedSends.value;
    if (msgs.length > 0) {
      showActionBanner({
        url: FAILED_SENDS_URL,
        tone: 'danger',
        icon: alertCircleOutline,
        name: failedMessageText(msgs),
        body: '',
        // Sticky (no duration) but dismissible: Retry re-sends, Dismiss closes it.
        actions: [
          { text: 'Retry', handler: () => void retryAllFailed() },
          { text: 'Dismiss', role: 'cancel', handler: () => {} },
        ],
      });
    } else {
      dismissActionBanner(FAILED_SENDS_URL);
    }
  },
);

// When opened from a notification, land on the relevant place: the deep-link the
// service worker hands us, or, for a content-free push, the most pertinent tab.
async function routeRelevant(url?: string): Promise<void> {
  if (url) {
    router.push(url);
    return;
  }
  if ((await countPendingRequests()) > 0) {
    router.push('/tabs/contacts');
    return;
  }
  const unread = (await listChats()).find((c) => c.unread > 0); // newest-first
  router.push(unread ? `/chat/${unread.id}` : '/tabs/chats');
}

function onServiceWorkerMessage(ev: MessageEvent): void {
  const data = ev.data as { type?: string; url?: string; reqId?: string } | undefined;
  if (!data) return;
  if (data.type === 'ring:navigate') {
    void routeRelevant(data.url);
  } else if (data.type === 'ring:posts') {
    void syncPosts(); // a Wall-post push woke us → pull (the in-app banner fires on the WS frame)
  } else if (data.type === 'ring:checkupdate') {
    checkForUpdate(true); // a version-announcement push woke us → check now (surfaces the update toast)
  } else if (data.type === 'ring:drain') {
    nudgeReconnect(); // pull queued messages now
    // We're a live page: if we're UNLOCKED we'll surface the message in-app
    // (notifyIncoming → banner when visible / notifyLocal when hidden), so claim it
    // back to the service worker so it suppresses its own OS notification (no
    // duplicate). A locked page can't show decrypted content, so it stays silent and
    // the SW shows the notification itself.
    if (data.reqId && isUnlockedNow()) {
      navigator.serviceWorker.controller?.postMessage({ type: 'ring:handled', reqId: data.reqId });
    }
  }
}

onMounted(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
  }
});
onUnmounted(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
  }
});

// Call audio takes precedence over media audio (spec 1007 FR-009): when a call
// becomes active, stop any voice message / music so they never play over a call.
watch(callState, (s) => {
  if (s !== 'idle') stopAudio();
});

// Clear the app-icon badge + pending notifications when foregrounded.
useAppBadge();

// Size the app to the visible viewport so the keyboard never pushes the
// fixed header/footer off-screen (see the composable for details).
useViewportHeight();

// Apply the persisted light/dark/system theme choice app-wide.
useTheme();

// Re-lock the keystore after the app has been backgrounded longer than the
// configured grace period (Privacy, App lock), when a passkey is enrolled.
useAutoLock();
</script>

<style>
ion-app {
  height: var(--app-height, 100%);
}

/* While the on-screen keyboard is open, hide the bottom tab bar so it doesn't
   float above the keyboard (native apps tuck it away). Driven by the
   visualViewport keyboard signal in useViewportHeight. */
body.keyboard-open ion-tab-bar {
  display: none;
}

/* When the keyboard is open the home-indicator area is covered by the keyboard,
   but iOS can still report a non-zero safe-area-inset-bottom, so an ion-footer
   (the chat composer) reserves space for a home indicator that isn't there,
   leaving a gap between the composer and the keyboard (visible on home-indicator
   iPhones, e.g. 15 Pro). Zero the footer's bottom inset while the keyboard is up;
   it's restored when the keyboard closes, keeping the normal home-indicator
   clearance. (--ion-safe-area-bottom inherits, so it reaches the toolbars.) */
/* The reaction / message-actions popover gets a brighter surface in dark theme
   so it lifts off the near-black chat background. */
:root.ion-palette-dark ion-popover.reaction-popover {
  --background: #2c2c2e;
}
@media (prefers-color-scheme: dark) {
  :root:not(.ion-palette-light) ion-popover.reaction-popover {
    --background: #2c2c2e;
  }
}
/* Size the quick-react bar to its contents (so all 5 emoji + "+" are visible without
   sliding), capped at the screen width — neither clipped nor full-bleed. */
ion-popover.quick-react-popover {
  --width: max-content;
  --max-width: 96vw;
}
/* A thin, theme-contrasting border so the popover's boundary reads clearly against
   the chat behind it. Uses --app-text (defined in BOTH themes) so the border shows in
   light AND dark — Ionic's --ion-text-color isn't reliable in this setup. */
ion-popover.reaction-popover::part(content) {
  border: 1px solid color-mix(in srgb, var(--app-text) 28%, transparent);
}

body.keyboard-open ion-footer {
  --ion-safe-area-bottom: 0px;
  padding-bottom: 0;
  /* Experimental: nudge the composer down ~10px so it sits flush against the
     keyboard instead of leaving a gap above it. */
  transform: translateY(10px);
  /* Round the corners while the keyboard is up so the composer harmonizes with
     the rounded accessory pill the OS shows just below it. overflow:hidden makes
     the toolbar background follow the rounded shape. */
  border-radius: 16px;
  overflow: hidden;
}

/* Functional toasts ("Muted"/"Copied", status notices, errors) are no longer Ionic toasts:
   appToast() (src/services/toast.ts) routes them through the SAME in-app banner overlay as
   messages/requests/system notices/the update prompt (NotificationBanners.vue), so every
   in-app notification shares one component, style, and position. No app-toast styling lives
   here anymore. */
</style>
