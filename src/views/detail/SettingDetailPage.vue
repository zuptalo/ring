<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button :default-href="backHref" />
        </ion-buttons>
        <ion-title>{{ node?.title ?? 'Settings' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content ref="contentRef" :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">{{ node?.title ?? 'Settings' }}</ion-title>
        </ion-toolbar>
      </ion-header>

      <template v-if="node">
        <!-- Notification enablement status (permission + subscription), with
             re-enable / iOS-hint actions. Only on the Notifications screen. -->
        <push-status v-if="section === 'notifications'" />

        <ion-list
          v-for="(group, gi) in node.groups"
          :key="gi"
          :inset="true"
        >
          <ion-list-header v-if="group.header">
            <ion-label>{{ group.header }}</ion-label>
          </ion-list-header>

          <template v-for="(item, ii) in group.items" :key="ii">
            <!-- navigation to another schema node -->
            <ion-item
              v-if="item.type === 'link'"
              button
              :detail="true"
              @click="go('/settings/' + item.id)"
            >
              <ion-icon v-if="item.icon" slot="start" :icon="ICONS[item.icon]" color="primary" />
              <ion-label class="ion-text-wrap">{{ item.title }}</ion-label>
              <ion-note slot="end">{{ item.note ?? linkSummary(item.id, str) }}</ion-note>
            </ion-item>

            <!-- navigation to a literal route (special pages) -->
            <ion-item
              v-else-if="item.type === 'route'"
              button
              :detail="true"
              @click="go(item.path)"
            >
              <ion-icon v-if="item.icon" slot="start" :icon="ICONS[item.icon]" color="primary" />
              <ion-label class="ion-text-wrap">{{ item.title }}</ion-label>
              <ion-note v-if="item.note" slot="end">{{ item.note }}</ion-note>
            </ion-item>

            <!-- boolean toggle -->
            <ion-item v-else-if="item.type === 'toggle'">
              <ion-icon v-if="item.icon" slot="start" :icon="ICONS[item.icon]" color="primary" />
              <ion-toggle
                :checked="bool(item.key, item.default)"
                @ion-change="onToggle(item.key, $event.detail.checked)"
              >
                <ion-label class="ion-text-wrap">
                  {{ item.title }}
                  <p v-if="item.note">{{ item.note }}</p>
                </ion-label>
              </ion-toggle>
            </ion-item>

            <!-- single-choice radio group -->
            <ion-radio-group
              v-else-if="item.type === 'choice'"
              :value="str(item.key, item.default)"
              @ion-change="onChoice(item.key, $event.detail.value)"
            >
              <ion-item v-for="opt in item.options" :key="opt.value">
                <ion-radio :value="opt.value" justify="space-between">
                  <ion-label class="ion-text-wrap">
                    {{ opt.label }}
                    <p v-if="opt.note">{{ opt.note }}</p>
                  </ion-label>
                </ion-radio>
              </ion-item>
            </ion-radio-group>

            <!-- segmented choice -->
            <ion-item v-else-if="item.type === 'segment'" lines="none">
              <ion-segment
                :value="str(item.key, item.default)"
                @ion-change="setSetting(item.key, String($event.detail.value))"
              >
                <ion-segment-button
                  v-for="opt in item.options"
                  :key="opt.value"
                  :value="opt.value"
                >
                  <ion-label>{{ opt.label }}</ion-label>
                </ion-segment-button>
              </ion-segment>
            </ion-item>

            <!-- read-only stat -->
            <ion-item v-else-if="item.type === 'stat'" lines="none">
              <ion-icon v-if="item.icon" slot="start" :icon="ICONS[item.icon]" color="primary" />
              <ion-label class="ion-text-wrap">{{ item.title }}</ion-label>
              <ion-note slot="end">{{ item.value }}</ion-note>
            </ion-item>

            <!-- action (optionally destructive / confirmed) -->
            <ion-item
              v-else-if="item.type === 'action'"
              button
              :detail="false"
              @click="runAction(item)"
            >
              <ion-icon
                v-if="item.icon"
                slot="start"
                :icon="ICONS[item.icon]"
                :color="item.danger ? 'danger' : 'primary'"
              />
              <ion-label :color="item.danger ? 'danger' : undefined">{{ item.title }}</ion-label>
            </ion-item>

            <!-- static note -->
            <ion-item v-else-if="item.type === 'note'" lines="none">
              <ion-label class="ion-text-wrap"><p>{{ item.text }}</p></ion-label>
            </ion-item>
          </template>

          <ion-item v-if="group.footer" lines="none">
            <ion-note class="ion-text-wrap">{{ group.footer }}</ion-note>
          </ion-item>
        </ion-list>
      </template>

      <ion-list v-else :inset="true">
        <ion-item lines="none">
          <ion-label class="ion-text-wrap"><p>Coming soon.</p></ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script lang="ts">
// Module-scoped scroll cache. This single component renders every settings
// screen via /settings/:section, so it is remounted (not stacked) as you drill
// in and out. Keying remembered scroll offsets by full path here (outside the
// per-instance setup) lets each screen return to where you left it.
const scrollPositions = new Map<string, number>();
</script>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonList, IonListHeader, IonItem, IonLabel, IonNote, IonIcon,
  IonToggle, IonRadio, IonRadioGroup, IonSegment, IonSegmentButton,
  alertController, modalController, onIonViewWillLeave, onIonViewDidEnter,
} from '@ionic/vue';
import { getAll, clearStore, STORES } from '@/db/idb';
import { setSetting, clearAllMedia } from '@/db/queries';
import { previewTone } from '@/services/sound';
import { deleteAccount } from '@/services/api';
import PushStatus from '@/components/PushStatus.vue';
import PasscodeModal from '@/components/PasscodeModal.vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { clearToken } from '@/services/auth';
import { isUnlockedNow, rotateRecoveryCode, enableLock, disableLock, getPinLength } from '@/services/crypto/identity';
import { disablePasskey } from '@/services/crypto/passkey';
import { syncRecoveryWrap } from '@/services/ownsync';
import { hasHiddenPin, verifyHiddenPin, changeHiddenPin } from '@/services/hidden-chats';
import { ensureHiddenPin } from '@/composables/hiddenPinPrompt';
import type { Setting } from '@/db/types';
import {
  ICONS, settingNode, linkSummary, type SettingItem,
} from '@/settings/schema';

const route = useRoute();
const router = useRouter();

// May be undefined while this (kept-alive) page is mid-transition off a route
// without a :section param; default to '' so the computeds below stay safe.
const section = computed(() => (route.params.section as string | undefined) ?? '');
const node = computed(() => settingNode(section.value));
// Hub ids have no hyphen; leaves return to their hub, hubs return to You.
const backHref = computed(() => {
  const id = section.value;
  const dash = id.lastIndexOf('-');
  return dash > 0 ? '/settings/' + id.slice(0, dash) : '/tabs/settings';
});

// One live snapshot of the settings store; controls read from it, write via
// setSetting. The bus re-runs this query after every write, so the UI stays
// reactive without per-key subscriptions.
const rows = useLiveQuery(
  () => getAll<Setting>('settings'),
  ['settings'],
  [] as Setting[],
);
const map = computed(() => {
  const m: Record<string, unknown> = {};
  for (const r of rows.value) m[r.key] = r.value;
  return m;
});
const bool = (key: string, fallback: boolean) =>
  (map.value[key] ?? fallback) as boolean;
const str = (key: string, fallback: string) =>
  (map.value[key] ?? fallback) as string;

// Persist a choice; for tone pickers (keys ending in `.sound`) also play a
// preview so the user hears the selection.
function onChoice(key: string, value: string): void {
  void setSetting(key, value);
  if (key.endsWith('.sound')) previewTone(value);
}

// Toggle handler. Most toggles just persist; the App-lock toggle also has to
// enroll/disable the passkey unlock, which can fail or be cancelled, so the
// stored value follows the REAL outcome, not the tap.
async function onToggle(key: string, checked: boolean): Promise<void> {
  if (key === 'privacy.appLock') {
    await onAppLockToggle(checked);
    return;
  }
  await setSetting(key, checked);
}

// Ring auto-unlocks without a passcode by default (the device key keeps the keys
// encrypted at rest, and lets the service worker show message previews in the
// background). Enabling a passcode turns that OFF: it PIN-wraps the keystore and
// removes the device key (stronger at-rest protection, but background previews
// fall back to a generic "New message". The toggle mirrors the real outcome.
async function onAppLockToggle(enable: boolean): Promise<void> {
  if (!isUnlockedNow()) {
    await setSetting('privacy.appLock', !enable);
    return notice('Unlock first', 'Unlock the app before changing the passcode lock.');
  }
  if (enable) {
    // The PinPad modal enforces a 4- or 6-digit passcode (pick → enter → confirm).
    const pin = await presentPasscodeModal('set');
    if (pin === null) {
      await setSetting('privacy.appLock', false); // cancelled
      return;
    }
    await enableLock(pin); // stores the PIN length so unlock auto-verifies at it
    await setSetting('privacy.appLock', true);
    return notice('Passcode set', 'Ring will ask for your passcode on this device.');
  }
  // Disable: verify the passcode, then restore passwordless auto-unlock.
  const pin = await presentPasscodeModal('verify', (await getPinLength()) ?? undefined);
  if (pin === null) {
    await setSetting('privacy.appLock', true); // keep it on (cancelled)
    return;
  }
  try {
    await disableLock(pin); // throws on a wrong passcode
    await disablePasskey(); // drop any passkey enrollment tied to the old passcode
    await setSetting('privacy.appLock', false);
  } catch {
    await setSetting('privacy.appLock', true);
    return notice('Incorrect passcode', 'That passcode was incorrect.');
  }
}

// Present the PinPad passcode modal; resolves to the entered PIN, or null on cancel.
async function presentPasscodeModal(variant: 'set' | 'verify', length?: number): Promise<string | null> {
  const modal = await modalController.create({
    component: PasscodeModal,
    componentProps: { variant, length },
  });
  await modal.present();
  const { data, role } = await modal.onWillDismiss();
  return role === 'confirm' && typeof data === 'string' ? data : null;
}

/* ---- preserve scroll position across drill-in / back ----
   Every settings screen is rendered by this one component (the /settings/:section
   route), so Ionic can't keep an independent scroll offset per screen the way it
   does for distinct pages (e.g. the Calls list). We remember each path's offset
   in a module-scoped map. Because it's unclear which mechanism Ionic uses for a
   given hop (component reuse vs. a stacked page), we save at every point a screen
   can leave and restore at every point one can enter. Restore retries across a
   few animation frames since the page may still be transitioning or its list not
   yet laid out when the hook fires. */

const contentRef = ref<{ $el: HTMLIonContentElement } | null>(null);
let scrollEl: HTMLElement | null = null;

async function cacheScrollEl() {
  scrollEl = (await contentRef.value?.$el.getScrollElement()) ?? null;
}

function save(path: string) {
  if (scrollEl) scrollPositions.set(path, scrollEl.scrollTop);
}

let restoreToken = 0;

function restore(path: string) {
  const y = scrollPositions.get(path) ?? 0;
  if (!y) return; // nothing saved → leave it at the top
  // The page transition and the async settings live-query re-render each reset
  // the scroll to 0, and the timing varies, sometimes after a fixed window. So
  // instead of re-asserting for a set number of frames, we keep correcting any
  // deviation until the offset has HELD for several consecutive frames (proof
  // the resets are done), with a hard cap so we never trap intentional scrolls.
  // A token cancels this loop if another navigation starts mid-restore.
  const token = ++restoreToken;
  let held = 0;
  let frames = 0;
  const apply = () => {
    if (!scrollEl || token !== restoreToken) return;
    if (Math.abs(scrollEl.scrollTop - y) > 1) {
      scrollEl.scrollTop = y;
      held = 0;
    } else {
      held += 1;
    }
    if (held < 12 && frames++ < 90) requestAnimationFrame(apply);
  };
  requestAnimationFrame(apply);
}

onMounted(async () => {
  await cacheScrollEl();
  restore(route.fullPath);
});

function go(path: string) {
  save(route.fullPath); // remember where we are before drilling in
  router.push(path);
}

// Same component instance reused for a param change (drill in / back).
onBeforeRouteUpdate((to, from) => {
  save(from.fullPath);
  restore(to.fullPath);
});

// Distinct-page transitions (crossing into/out of settings, or if Ionic stacks).
onIonViewWillLeave(() => save(route.fullPath));
onIonViewDidEnter(async () => {
  await cacheScrollEl();
  restore(route.fullPath);
});

/* ---- action registry ---- */

const AUTO_DOWNLOAD_DEFAULTS: Record<string, string> = {
  'storage.autoDownload.photos': 'wifi-cellular',
  'storage.autoDownload.audio': 'wifi',
  'storage.autoDownload.video': 'wifi',
  'storage.autoDownload.documents': 'wifi',
  'storage.uploadQuality': 'hd',
  'storage.downloadQuality': 'hd',
};

const ACTIONS: Record<string, () => void | Promise<void>> = {
  'delete-account': async () => {
    // Delete the account server-side first (best-effort: if the server is
    // unreachable we still wipe the device so it's signed out + erased). Then
    // erase ALL on-device stores and finally the identity/token.
    try {
      await deleteAccount();
    } catch {
      /* proceed with the local wipe regardless */
    }
    for (const s of STORES) {
      try {
        await clearStore(s);
      } catch {
        /* ignore a missing/locked store */
      }
    }
    clearToken(); // locks + wipes the keystore + token, re-arms onboarding
    router.replace('/auth');
  },
  'regenerate-recovery': async () => {
    // The keystore must be unlocked to re-wrap the identity (it is, in Settings).
    if (!isUnlockedNow()) {
      return notice('Recovery key', 'Unlock the app first, then try again.');
    }
    let code: string;
    try {
      code = await rotateRecoveryCode();
    } catch {
      return notice('Recovery key', 'Could not generate a new recovery key. Please try again.');
    }
    // Re-upload so a NEW device restores with the new key. Best-effort: if it
    // fails (e.g. offline) ownsync re-uploads on its next cycle since the salt
    // changed, the new key still works once that catches up.
    let synced = true;
    try {
      await syncRecoveryWrap();
    } catch {
      synced = false;
    }
    await showRecoveryCode(code, synced);
  },
  'clear-all-chats': () => clearStore('messages'),
  'delete-all-chats': async () => {
    await clearStore('messages');
    await clearStore('chats');
  },
  'archive-all': () => notice('Archive all chats', 'Archiving isn’t available in this build yet.'),
  'reset-autodownload': async () => {
    for (const [k, v] of Object.entries(AUTO_DOWNLOAD_DEFAULTS)) {
      await setSetting(k, v);
    }
  },
  'reset-network': () => setSetting('network.resetAt', Date.now()),
  'clear-all-media': () => clearAllMedia(),
  'hidden-set-pin': async () => {
    // No PIN yet → create one (also flips the feature on). Existing PIN → change
    // it, requiring the current PIN first.
    if (!(await hasHiddenPin())) {
      if (await ensureHiddenPin()) await setSetting('privacy.hiddenChatsEnabled', true);
      return;
    }
    const current = await promptPin('Enter your current Hidden Chats PIN');
    if (current === null) return;
    if (!(await verifyHiddenPin(current))) {
      return notice('Hidden chats', 'That PIN is incorrect.');
    }
    const next = await promptPin('Enter a new PIN (4+ digits)', true);
    if (next === null) return;
    await changeHiddenPin(current, next);
    notice('Hidden chats', 'Your PIN has been changed.');
  },
  invite: async () => {
    const data = { title: 'Ring', text: 'Join me on Ring', url: location.origin };
    if (navigator.share) {
      try {
        await navigator.share(data);
      } catch {
        /* user cancelled */
      }
    } else {
      notice('Invite a friend', 'Sharing isn’t supported on this device.');
    }
  },
};

async function notice(header: string, message: string) {
  const a = await alertController.create({
    header,
    message,
    buttons: ['OK'],
  });
  await a.present();
}

// Prompt for a numeric PIN. With `confirm`, requires a matching second entry and
// 4+ digits (used for setting a NEW PIN); otherwise just returns the entry (used
// for verifying the current PIN). Resolves null on cancel.
async function promptPin(header: string, confirm = false): Promise<string | null> {
  return new Promise((resolve) => {
    const inputs = [
      { name: 'pin', type: 'password' as const, attributes: { inputmode: 'numeric' }, placeholder: 'PIN' },
      ...(confirm
        ? [{ name: 'confirm', type: 'password' as const, attributes: { inputmode: 'numeric' }, placeholder: 'Confirm PIN' }]
        : []),
    ];
    void alertController
      .create({
        header,
        inputs,
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
          {
            text: 'OK',
            handler: (data: { pin?: string; confirm?: string }) => {
              const pin = (data.pin ?? '').trim();
              if (confirm && (!/^\d{4,}$/.test(pin) || pin !== (data.confirm ?? '').trim())) return false;
              resolve(pin);
              return true;
            },
          },
        ],
      })
      .then((a) => a.present());
  });
}

// Present the freshly-rotated recovery code with a copy action. The code goes in
// a readonly textarea input (not the message) because the alert escapes HTML and
// won't render line breaks; the field also makes the code selectable. "Copy"
// returns false so the alert stays open (the user can confirm before dismissing).
async function showRecoveryCode(code: string, synced: boolean) {
  const message = synced
    ? 'Save this somewhere safe. It’s the only way to restore your account if you lose this device. No one can recover it for you.'
    : 'Save this somewhere safe. You appear to be offline, the new key will finish syncing automatically.';
  const a = await alertController.create({
    header: 'Your new recovery key',
    message,
    inputs: [
      { name: 'code', type: 'textarea', value: code, attributes: { readonly: true } },
    ],
    buttons: [
      {
        text: 'Copy',
        handler: () => {
          void navigator.clipboard?.writeText(code);
          return false; // keep the alert open after copying
        },
      },
      { text: 'Done', role: 'confirm' },
    ],
  });
  await a.present();
}

async function runAction(item: Extract<SettingItem, { type: 'action' }>) {
  const handler = ACTIONS[item.action];
  if (item.confirm) {
    const a = await alertController.create({
      header: item.title,
      message: item.confirm,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          role: item.danger ? 'destructive' : 'confirm',
          handler: () => handler?.(),
        },
      ],
    });
    await a.present();
  } else if (handler) {
    await handler();
  } else {
    notice(item.title, 'Not available in this build yet.');
  }
}
</script>
