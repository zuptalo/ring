<template>
  <!-- Connection-state pill (spec 1042): a signed-in app whose server link has
       been down past the grace window says so, instead of letting messages sit
       on the pending clock with no explanation. Non-interactive (taps pass
       through) and it clears the moment the socket is back. -->
  <transition name="connbar-fade">
    <div v-if="visible" class="connbar" role="status" aria-live="polite">
      <ion-spinner class="connbar-spin" name="crescent" aria-hidden="true" />
      <span>{{ label }}</span>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { IonSpinner } from '@ionic/vue';
import { syncState } from '@/composables/useSync';
import { isAuthenticated } from '@/services/auth';

// How long the link must be CONTINUOUSLY non-online before the pill shows: long
// enough to swallow a cold start's connect handshake and transient blips, short
// enough that a dead server is called out while the stuck clock-icon message is
// still on screen.
const GRACE_MS = 3000;

const lapsed = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
watch(
  syncState,
  (s) => {
    if (s === 'online') {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lapsed.value = false;
    } else if (!timer && !lapsed.value) {
      // One window across offline↔connecting flaps: the retry loop cycles the
      // state while disconnected, and restarting the clock per flap would keep
      // the pill from ever appearing.
      timer = setTimeout(() => {
        lapsed.value = true;
        timer = null;
      }, GRACE_MS);
    }
  },
  { immediate: true },
);

// Reactive navigator.onLine, so the copy can tell "your device has no network"
// from "the server is unreachable" (FR-002).
const netUp = ref(typeof navigator === 'undefined' ? true : navigator.onLine);
const onNet = (): void => {
  netUp.value = navigator.onLine;
};
onMounted(() => {
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
});
onBeforeUnmount(() => {
  window.removeEventListener('online', onNet);
  window.removeEventListener('offline', onNet);
  if (timer) clearTimeout(timer);
});

// Signed-out devices (onboarding) never show it: syncState sits at 'offline'
// there by design, not because anything is wrong.
const visible = computed(() => isAuthenticated.value && lapsed.value && syncState.value !== 'online');
const label = computed(() => (netUp.value ? 'Connecting…' : 'Waiting for network…'));
</script>

<style scoped>
.connbar {
  position: fixed;
  /* Below the header bar (like the notification banners' offset) so it never
     covers the title/back control, centered, and narrow enough to read as a
     status pill rather than a banner. */
  top: calc(env(safe-area-inset-top, 0px) + 62px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(20, 24, 22, 0.82);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  /* Status only: never intercept taps meant for what's underneath. */
  pointer-events: none;
  /* Above page content, below the in-app notification banners (19000) and the
     incoming-call overlay (20000) so real alerts always win. */
  z-index: 15000;
}
.connbar-spin {
  width: 15px;
  height: 15px;
  --color: #9fe8c7;
}
.connbar-fade-enter-active,
.connbar-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.connbar-fade-enter-from,
.connbar-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}
</style>
