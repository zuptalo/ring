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
import { isUnlockedNow } from '@/services/crypto/identity';
import { IonApp, IonRouterOutlet, toastController } from '@ionic/vue';
import { inviteNeedsProfile } from '@/services/invites';
import { useViewportHeight } from '@/composables/useViewportHeight';
import { useTheme } from '@/composables/useTheme';
import { useAppBadge } from '@/composables/useAppBadge';
import { useAutoLock } from '@/composables/useAutoLock';
import KeyGuard from '@/components/KeyGuard.vue';
import InstallGuard from '@/components/InstallGuard.vue';
import IncomingCallOverlay from '@/components/IncomingCallOverlay.vue';
import MinimizedCall from '@/components/MinimizedCall.vue';
import CallMediaSink from '@/components/CallMediaSink.vue';
import NotificationBanners from '@/components/NotificationBanners.vue';
import { useSync, nudgeReconnect } from '@/composables/useSync';
import { useAppUpdate } from '@/composables/useAppUpdate';
import { countPendingRequests, listChats, listFailedMessages, retryAllFailed } from '@/db/queries';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { Message } from '@/db/types';

// Owns the transport and sync engine: connects when registered, drains the
// outbox, and applies inbound frames (delivery receipts, records, tombstones).
useSync();

// Registers the service worker and prompts (with the version) when a new deploy is
// ready, instead of silently reloading. See useAppUpdate + vite.config 'prompt'.
useAppUpdate();

const router = useRouter();

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
  const t = await toastController.create({
    message: 'Add your name and photo so people know it’s you.',
    duration: 2800,
    position: 'top',
  });
  await t.present();
  router.push('/settings/profile');
});

// Sticky "failed to send" notice: when one or more outgoing messages have
// exhausted their auto-retries, show a persistent toast with a Retry action. It
// updates its count live and dismisses itself once nothing is failed.
const failedSends = useLiveQuery<Message[]>(() => listFailedMessages(), ['messages'], []);
let failedToast: HTMLIonToastElement | null = null;
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
// updates (e.g. a new too-large failure) even if the count is unchanged.
watch(
  () => failedSends.value.map((m) => `${m.id}:${m.failReason ?? ''}`).join(','),
  async () => {
    const msgs = failedSends.value;
    if (msgs.length > 0) {
      if (failedToast) {
        failedToast.message = failedMessageText(msgs);
        return;
      }
      failedToast = await toastController.create({
        message: failedMessageText(msgs),
        position: 'top',
        color: 'danger',
        // Sticky (no duration) but dismissible: Retry re-sends, Dismiss closes it.
        buttons: [
          { text: 'Retry', handler: () => void retryAllFailed() },
          { text: 'Dismiss', role: 'cancel' },
        ],
      });
      failedToast.addEventListener('didDismiss', () => (failedToast = null));
      await failedToast.present();
    } else if (failedToast) {
      await failedToast.dismiss();
      failedToast = null;
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

/* The "update available" toast surfaces at the top with the rest of the app's
   notifications (Ionic's top toasts already clear the safe-area inset). Styled
   like the in-app notification banners: neutral dark, white text reads in both
   themes. */
ion-toast.app-update-toast {
  --background: #2c2c30;
  --color: #fff;
  --border-radius: 14px;
}
ion-toast.app-update-toast::part(button) {
  color: #fff;
}
</style>
