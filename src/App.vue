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
    <!-- Cold-start launch reveal: plays the brand animation once (~2.4s), then
         fades out and unmounts, above both gates (z-40). -->
    <launch-reveal />
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
    <!-- Fullscreen game overlay (spec 1038): covers the app while a game is
         played; the notification banners below stay ABOVE it (z 19000 > 16000)
         so other chats' toasts render over the game. -->
    <game-overlay />
    <!-- Floating return-to-game button while an ongoing game is off screen. -->
    <floating-game-button />
    <!-- In-app notification banners (green, with avatar + name): over any route. -->
    <notification-banners />
  </ion-app>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { isAuthenticated } from '@/services/auth';
import { isUnlocked } from '@/services/crypto/identity';
import { warmAll, clearWarm } from '@/composables/warmStores';
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { alertCircleOutline } from 'ionicons/icons';
import { inviteNeedsProfile } from '@/services/invites';
import { appToast } from '@/services/toast';
import { showActionBanner, dismissActionBanner, markPushWake, onBannerPresented } from '@/services/notify';
import { useViewportHeight } from '@/composables/useViewportHeight';
import { useTheme } from '@/composables/useTheme';
import { useAppBadge } from '@/composables/useAppBadge';
import { useAutoLock } from '@/composables/useAutoLock';
import { useContactProfilePrompts } from '@/composables/useContactProfilePrompts';
import KeyGuard from '@/components/KeyGuard.vue';
import InstallGuard from '@/components/InstallGuard.vue';
import LaunchReveal from '@/components/LaunchReveal.vue';
import IncomingCallOverlay from '@/components/IncomingCallOverlay.vue';
import MinimizedCall from '@/components/MinimizedCall.vue';
import MinimizedAudio from '@/components/MinimizedAudio.vue';
import CallMediaSink from '@/components/CallMediaSink.vue';
import NotificationBanners from '@/components/NotificationBanners.vue';
import GameOverlay from '@/components/GameOverlay.vue';
import FloatingGameButton from '@/components/FloatingGameButton.vue';
import { useGameOverlay } from '@/composables/useGameOverlay';
import { useGameDuty } from '@/composables/useGameDuty';
import { callState } from '@/composables/useCall';
import { stopAudio } from '@/composables/useAudioPlayer';
import { useSync, nudgeReconnect } from '@/composables/useSync';
import { useNotificationNudge } from '@/composables/useNotificationNudge';
import { useAppUpdate, checkForUpdate } from '@/composables/useAppUpdate';
import { countPendingRequests, listChats, listFailedMessages, retryAllFailed, syncPosts } from '@/db/queries';
import { takePendingNav } from '@/services/pending-nav';
import { recoverInterruptedPosts } from '@/services/pending-posts';
import { setAutoplayGifsEnabled } from '@/directives/autoplay-visible';
import { useAnimationPrefs } from '@/composables/useAnimationPrefs';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { Message } from '@/db/types';

// Owns the transport and sync engine: connects when registered, drains the
// outbox, and applies inbound frames (delivery receipts, records, tombstones).
useSync();
// Fullscreen games (spec 1038): overlay wiring (back/route/fullscreen) + the
// duty officer that emits owed answers/reveals/staged commits app-wide.
useGameOverlay();
useGameDuty();

// On a fresh open, ask for notification permission if it's still undecided (a reinstall
// resets it and only a tap can re-grant it). Onboarding owns the first ask; this covers
// later cold starts. See useNotificationNudge.
useNotificationNudge();

// Registers the service worker and prompts (with the version) when a new deploy is
// ready, instead of silently reloading. See useAppUpdate + vite.config 'prompt'.
useAppUpdate();

// Push the Appearance → Animations "GIFs move automatically" preference into the feed autoplay
// coordinator (its gate is synchronous, the setting is async), so turning it off actually stops
// GIF/video autoplay.
const { animGifs } = useAnimationPrefs();
watch(animGifs, (on) => setAutoplayGifsEnabled(on !== false), { immediate: true });

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
    if (unlocked) {
      void warmAll();
      // Spec 1024: a post whose upload was cut off by a full app close can't be resumed (its library
      // media handle is gone). Recover it as a draft instead — keep the caption + voice notes for the
      // user to finish in the composer — and let them know if a media-only post had to be dropped.
      void recoverInterruptedPosts().then(({ discarded }) => {
        if (discarded > 0) {
          void appToast({
            message:
              discarded === 1
                ? 'A post didn’t finish because the app closed. Please share it again.'
                : `${discarded} posts didn’t finish because the app closed. Please share them again.`,
            duration: 3200,
          });
        }
      });
      // Cold-launched from a notification? The SW stashed where to go (iOS PWAs can't deep-link
      // via openWindow); now that we're unlocked and the tabs are reachable, route there. The
      // microtask defer lets the auth gate's default landing settle first so this wins.
      void takePendingNav().then((url) => {
        if (url) void routeRelevant(url, true); // cold start: seed Chats beneath the deep link
      });
    } else {
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

// First-paint gate (spec 2018): the pending-nav consume can fire very early (the
// isUnlocked watcher is `immediate`, and a passwordless device unlock resolves in
// milliseconds), and a deep-link push that lands while the root ion-router-outlet
// is still mounting/animating its FIRST view gets its view swap DROPPED by Ionic —
// the URL becomes /chat/<id> while the Chats list stays on screen (tapping that
// chat is then a same-route no-op, and Back "returns" to the never-rendered chat
// entry — the reported bug). Resolves after mount + two animation frames: the
// frame after the first view committed.
let markFirstPaint: () => void;
const firstPaint = new Promise<void>((resolve) => (markFirstPaint = resolve));
onMounted(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => markFirstPaint()));
});

// One settle between two programmatic Ionic navigations, so the second never
// starts while the first is still animating (Ionic drops, not queues, an
// overlapping view swap). Frame-based rather than a fixed duration.
const settleFrames = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// When opened from a notification, land on the relevant place: the deep-link the
// service worker hands us, or, for a content-free push, the most pertinent tab.
// `coldStart` is true when we're launching fresh from a tapped notification: the deep-link
// target is then the ONLY history entry, so a Back/swipe-back would underflow to a blank shell.
// In that case seed the Chats home BENEATH the target (replace current → Chats, then push the
// target) so the first Back always returns to the Chats list. Live in-app navigation keeps normal
// push behaviour.
async function routeRelevant(url?: string, coldStart = false): Promise<void> {
  let target = url;
  if (!target) {
    if ((await countPendingRequests()) > 0) target = '/tabs/contacts';
    else {
      const unread = (await listChats()).find((c) => c.unread > 0); // newest-first
      target = unread ? `/chat/${unread.id}` : '/tabs/chats';
    }
  }
  if (coldStart && target !== '/tabs/chats') {
    // Never navigate before the app has painted its first view (spec 2018, FR-002).
    await router.isReady();
    await firstPaint;
    // Seed the Chats home beneath the deep link. When the auth gate already landed
    // on /tabs/chats (iOS ignores the open-window path), the replace would be a
    // same-route no-op — skip it and just push. When the platform DID honor the
    // deep link (current route = the target), the replace really navigates, so let
    // its transition settle before stacking the push (overlap = dropped swap).
    if (router.currentRoute.value.path !== '/tabs/chats') {
      await router.replace('/tabs/chats');
      await settleFrames();
    }
    await router.push(target);
  } else if (target.startsWith('/chat/') && router.currentRoute.value.path.startsWith('/chat/')) {
    // Live app, notification for chat B tapped while chat A (possibly A's sub-pages)
    // is on top: REPLACE instead of push (spec 2018, US follow-up). A push would
    // stack B over A, so Back/swipe from the notification's chat returned to the
    // previous conversation instead of the Chats list the user expects. Replacing
    // swaps A's entry for B, leaving the Chats list beneath.
    router.replace(target);
  } else {
    router.push(target);
  }
}

// How long to wait for a drained message's in-app banner to render before giving
// up and letting the SW own the OS notification. Slightly above the SW's own
// pageWillNotify wait (sw.ts) so a page that WILL show a banner reliably claims it
// (a fast already-connected drain renders well within this), while a page that
// won't (hidden / suppressed / locked) simply never acks → the SW shows it.
const DRAIN_ACK_WINDOW_MS = 2000;
function waitForBannerThenAck(reqId: string): void {
  let unsub = (): void => {};
  const timer = setTimeout(() => unsub(), DRAIN_ACK_WINDOW_MS);
  unsub = onBannerPresented(() => {
    clearTimeout(timer);
    unsub();
    // The page presented an in-app banner for this drain → claim it so the SW
    // suppresses its own OS notification (no duplicate).
    navigator.serviceWorker.controller?.postMessage({ type: 'ring:handled', reqId });
  });
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
    markPushWake(); // a push woke us → arriving messages bypass the settle window
    nudgeReconnect(); // pull queued messages now
    // Hand-off (spec 2010): ack `ring:handled` ONLY when the page actually presents
    // an in-app banner for the drained message — not merely because we're unlocked.
    // The old "unlocked → ack" was ambiguous: it claimed the alert, then the settle
    // window / visibility race often dropped the banner, so neither the page nor the
    // SW alerted. Now we register a one-shot listener for this drain: if a banner
    // renders within the window, ack (the page owns it); otherwise stay silent so the
    // SW deterministically owns the OS notification (hidden / suppressed / locked).
    if (data.reqId) waitForBannerThenAck(data.reqId);
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

// Offer to adopt a contact's new name/photo when the peer changes it (in-app prompt).
useContactProfilePrompts();
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
