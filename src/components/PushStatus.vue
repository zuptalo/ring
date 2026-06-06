<template>
  <!-- Master push-notification control, at the top of the Notifications screen.
       When permission is granted it's a real on/off toggle (subscribe / drop the
       server subscription). Otherwise it surfaces the right action: prompt when
       undecided, or an iOS hint when blocked. -->
  <ion-list v-if="view !== 'hidden'" :inset="true">
    <!-- Granted: on/off toggle. -->
    <ion-item v-if="view === 'on'" lines="none">
      <ion-toggle :checked="enabled" :disabled="busy" @ion-change="onToggle($event.detail.checked)">
        <ion-label class="ion-text-wrap">
          Push notifications
          <p>
            {{ enabled ? 'Get alerts for messages and calls, even when Ring is closed.'
                       : 'You won’t be alerted while Ring is closed.' }}
          </p>
        </ion-label>
      </ion-toggle>
    </ion-item>

    <!-- Not granted / blocked: a roomy vertical callout (icon + title, then the
         message full-width, then a full-width action) so the longer iOS hint isn't
         squeezed into a narrow column next to the button. -->
    <ion-item v-else-if="ui" lines="none" class="callout-item">
      <div class="callout">
        <div class="callout-head">
          <ion-icon class="callout-icon" :icon="ui.icon" :color="ui.color" />
          <h2 class="callout-title">{{ ui.title }}</h2>
        </div>
        <p class="callout-msg">{{ ui.message }}</p>
        <ion-button
          class="callout-action"
          expand="block"
          :disabled="busy"
          @click="onAction"
        >
          {{ ui.action }}
        </ion-button>
      </div>
    </ion-item>
  </ion-list>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { IonList, IonItem, IonIcon, IonLabel, IonButton, IonToggle } from '@ionic/vue';
import { notificationsOutline, notificationsOffOutline } from 'ionicons/icons';
import { isPushSupported, pushPermission } from '@/services/permissions';
import { requestPushPermission } from '@/services/notifications';
import { applyPushPreference } from '@/services/push';
import { getSetting, setSetting } from '@/db/queries';
import { useLiveQuery } from '@/composables/useLiveQuery';

const permission = ref(pushPermission());
const busy = ref(false);

// Master push preference (reactive; the toggle reflects it).
const enabled = useLiveQuery(() => getSetting<boolean>('notifications.push', true), ['settings'], true);

function refresh(): void {
  const prev = permission.value;
  permission.value = pushPermission();
  // If the OS permission actually changed (revoked in iOS Settings, or freshly
  // granted), reconcile the push subscription with it: drop a now-dead one so the
  // server stops pushing to it, or (re)subscribe once it's allowed again.
  if (permission.value !== prev) void applyPushPreference();
}

// Re-check when the user returns to the app (e.g. after changing iOS Settings).
function onVisible(): void {
  if (document.visibilityState === 'visible') refresh();
}
onMounted(() => {
  refresh();
  document.addEventListener('visibilitychange', onVisible);
});
onUnmounted(() => document.removeEventListener('visibilitychange', onVisible));

type View = 'hidden' | 'denied' | 'default' | 'on';
const view = computed<View>(() => {
  if (permission.value === 'unsupported' || !isPushSupported()) return 'hidden';
  if (permission.value === 'denied') return 'denied';
  if (permission.value === 'default') return 'default';
  return 'on'; // granted → show the on/off toggle
});

const ui = computed(() => {
  switch (view.value) {
    case 'denied':
      return {
        icon: notificationsOffOutline,
        color: 'warning',
        title: 'Notifications are blocked',
        message:
          'Open the iOS Settings app → Notifications → Ring, allow notifications, then come back and tap Check again.',
        action: 'Check again',
      };
    case 'default':
      return {
        icon: notificationsOutline,
        color: 'primary',
        title: 'Turn on notifications',
        message: 'Get alerts for new messages and calls, even when Ring is closed.',
        action: 'Turn on',
      };
    default:
      return null;
  }
});

async function onToggle(checked: boolean): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await setSetting('notifications.push', checked);
    await applyPushPreference(true); // subscribe / unsubscribe to match
  } finally {
    busy.value = false;
  }
}

async function onAction(): Promise<void> {
  if (busy.value) return;
  // Blocked: we can't re-prompt on iOS, so re-read the (hopefully now-granted)
  // permission after the user enables it in Settings.
  if (view.value === 'denied') {
    refresh();
    return;
  }
  busy.value = true;
  try {
    if (pushPermission() === 'default') {
      const res = await requestPushPermission(); // native prompt
      if (res !== 'granted') return;
    }
    if (pushPermission() === 'granted') {
      await setSetting('notifications.push', true);
      await applyPushPreference(true);
    }
  } finally {
    busy.value = false;
    refresh();
  }
}
</script>

<style scoped>
/* Vertical callout: let the content own the full card width instead of being
   wedged between a start icon and an end button. */
.callout-item {
  --padding-top: 14px;
  --padding-bottom: 14px;
  --padding-start: 16px;
  --padding-end: 16px;
  --inner-padding-end: 0;
}
.callout {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.callout-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.callout-icon {
  font-size: 24px;
  flex-shrink: 0;
}
.callout-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
}
.callout-msg {
  margin: 0;
  color: var(--app-text-muted, #8e8e93);
  font-size: 14px;
  line-height: 1.45;
}
.callout-action {
  margin: 4px 0 0;
}
</style>
