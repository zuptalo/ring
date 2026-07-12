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
import { CONN_GRACE_MS, indicatorLabel, indicatorVisible, nextDownSince } from '@/services/connection-indicator';

// All decisions are the pure rules in services/connection-indicator.ts (unit
// tested there); this component only feeds them state changes and schedules
// the ONE timer that re-evaluates when the grace window elapses.
const downSince = ref<number | null>(null);
const now = ref(Date.now());
let timer: ReturnType<typeof setTimeout> | null = null;
watch(
  syncState,
  (s) => {
    downSince.value = nextDownSince(downSince.value, s, Date.now());
    now.value = Date.now();
    if (downSince.value === null) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    } else if (!timer) {
      const wait = Math.max(0, downSince.value + CONN_GRACE_MS - Date.now());
      timer = setTimeout(() => {
        timer = null;
        now.value = Date.now(); // re-evaluate visibility once the window lapses
      }, wait);
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

const visible = computed(() => indicatorVisible(downSince.value, isAuthenticated.value, now.value));
const label = computed(() => indicatorLabel(netUp.value));
</script>

<style scoped>
.connbar {
  position: fixed;
  /* Bottom-center, in the floating-widget band above the tab bar / composer
     (MinimizedCall docks bottom-right, FloatingGameButton bottom-left, both at
     +66px). A top placement collided with the tab pages' search bar — their
     large-title layout has no toolbar, so content starts where a header-hugging
     pill would sit. Down here nothing important ever lives, on any screen. */
  bottom: calc(max(12px, env(safe-area-inset-bottom)) + 70px);
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
  transform: translateX(-50%) translateY(6px);
}
</style>
