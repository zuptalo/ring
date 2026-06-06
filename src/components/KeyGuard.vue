<template>
  <!-- Full-screen gate rendered as an ion-page (App hides the router outlet
       while this is shown, so nothing behind it can bleed through). -->
  <ion-page v-if="showGate">
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>{{ title }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <!-- Keystore state still loading: a neutral, opaque screen so the real app
           never flashes behind the gate, and we don't briefly show the wrong pad. -->
      <div v-if="!ready" class="gate-loading">
        <ion-spinner name="crescent" />
      </div>

      <!-- First run: the keystore auto-creates (passwordless, device-key wrapped)
           and surfaces the recovery code. No passcode by default, a lock is
           opt-in in Settings. -->
      <template v-else-if="mode === 'create' || autoCreating">
        <div class="gate-loading">
          <ion-spinner name="crescent" />
        </div>
      </template>

      <!-- Show the one-time recovery code. -->
      <template v-else-if="mode === 'recovery'">
        <div class="ion-padding gate-pad">
          <p>
            Save this recovery code somewhere safe. It's the only way to restore your
            account if you lose this device. We can't recover it for you.
          </p>
          <ion-list :inset="true">
            <ion-item lines="none">
              <ion-label class="ion-text-wrap">
                <h2>{{ recoveryCode }}</h2>
              </ion-label>
            </ion-item>
          </ion-list>
          <ion-button expand="block" fill="outline" @click="copyCode">
            {{ copied ? 'Copied' : 'Copy code' }}
          </ion-button>
          <ion-button expand="block" class="ion-margin-top" @click="ackRecovery">
            I've saved it
          </ion-button>
        </div>
      </template>

      <!-- Unlock an existing keystore. -->
      <template v-else>
        <pin-pad
          :key="`unlock-${attempt}`"
          title="Enter passcode"
          :length="pinLength ?? undefined"
          :error="error"
          :busy="busy"
          @submit="onUnlock"
        >
          <!-- Passkey unlock. Tap-triggered on purpose: iOS only allows WebAuthn
               get() under a user gesture, so we can't auto-prompt. -->
          <ion-button
            v-if="passkeyEnrolled"
            fill="clear"
            :disabled="busy"
            @click="onPasskey"
          >
            <ion-icon slot="start" :icon="keyOutline" />
            Unlock with passkey
          </ion-button>
          <div>
            <ion-button fill="clear" size="small" color="medium" @click="startForgot">
              Forgot passcode?
            </ion-button>
          </div>
        </pin-pad>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem,
  IonLabel, IonButton, IonIcon, IonSpinner, alertController, actionSheetController,
} from '@ionic/vue';
import { keyOutline } from 'ionicons/icons';
import PinPad from '@/components/PinPad.vue';
import { useKeyGuard } from '@/composables/useKeyGuard';
import { isAuthenticated } from '@/services/auth';

const {
  showGate, ready, mode, error, busy, copied, recoveryCode, passkeyEnrolled, pinLength,
  createAuto, unlockWithPin, tryUnlockWithPasskey, checkRecoveryCode, completeRecovery,
  copyCode, ackRecovery, resetDevice,
} = useKeyGuard();

// First run: auto-create the identity passwordless (device-key wrapped) as soon as
// the gate lands in create mode, then show the recovery code. `autoCreating` keeps
// the spinner up across the brief window where the keystore exists but the recovery
// code hasn't surfaced yet (so the unlock pad never flashes).
const autoCreating = ref(false);
// Only after the user is authenticated AND the keystore state has loaded AND there
// is no identity yet, never on a fresh, unregistered device.
const shouldAutoCreate = computed(
  () => isAuthenticated.value && ready.value && mode.value === 'create',
);
watch(
  shouldAutoCreate,
  (yes) => {
    if (yes && !autoCreating.value) {
      autoCreating.value = true;
      void createAuto().finally(() => {
        autoCreating.value = false;
      });
    }
  },
  { immediate: true },
);

const title = computed(() => {
  if (!ready.value) return ''; // don't flash a title before we know create vs unlock
  return mode.value === 'create' ? 'Secure your account' : mode.value === 'recovery' ? 'Recovery code' : 'Unlock';
});

// Bumping `attempt` re-keys the PinPad, clearing the entered digits.
const attempt = ref(0);

async function onUnlock(code: string): Promise<void> {
  const ok = await unlockWithPin(code);
  if (!ok) attempt.value += 1; // clear the pad for another try
}

// On success the keystore unlocks → isUnlocked flips → the gate closes. On
// failure/cancel the error (if any) shows on the pad and the user types their PIN.
async function onPasskey(): Promise<void> {
  await tryUnlockWithPasskey();
}

/* ---- forgot passcode: recover with code, or reset as a last resort ---- */

async function startForgot(): Promise<void> {
  const sheet = await actionSheetController.create({
    header: 'Forgot passcode?',
    buttons: [
      { text: 'Enter recovery code', handler: () => void promptRecoveryCode() },
      { text: 'Reset this device', role: 'destructive', handler: () => void confirmReset() },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}

async function promptRecoveryCode(): Promise<void> {
  const a = await alertController.create({
    header: 'Recovery code',
    message: 'Enter the recovery code you saved when you set up this device.',
    inputs: [{ name: 'code', type: 'text', placeholder: 'XXXX-XXXX-…' }],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Continue',
        handler: async (data) => {
          const code = data.code ?? '';
          if (!(await checkRecoveryCode(code))) {
            const bad = await alertController.create({
              header: 'Invalid code',
              message: "That recovery code didn't match. Check it and try again.",
              buttons: ['OK'],
            });
            await bad.present();
            return;
          }
          // Passwordless recovery: restore + unlock now, then the recovery-display
          // screen shows the freshly-issued code (a passcode is opt-in in Settings).
          if (!(await completeRecovery(code))) {
            const bad = await alertController.create({
              header: 'Recovery failed',
              message: 'Could not restore from that code. Please try again.',
              buttons: ['OK'],
            });
            await bad.present();
          }
        },
      },
    ],
  });
  await a.present();
}

async function confirmReset(): Promise<void> {
  const a = await alertController.create({
    header: 'Reset this device?',
    message:
      'Resetting signs this device out and erases its keys and encrypted data. Only do this if you have also lost your recovery code. You can register again with an invitation code.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Reset',
        role: 'destructive',
        handler: async () => {
          await resetDevice();
          // Hard reload to '/' guarantees no stale route/in-memory state and a
          // genuine fresh-install boot (re-seed + Auth gate).
          window.location.assign('/');
        },
      },
    ],
  });
  await a.present();
}
</script>

<style scoped>
/* The gate overlays the (always-mounted) router outlet rather than hiding it,
   so it must sit above the outlet's pages. It's fully opaque (solid header via
   the global header rule + opaque gradient content), so nothing bleeds. */
ion-page {
  z-index: 20;
}

/* Content is fullscreen so the translucent header blurs what's behind it; this
   clears the header (incl. the status-bar safe area) for the recovery view. */
.gate-pad {
  padding-top: calc(env(safe-area-inset-top, 0px) + 72px);
}

/* Neutral loading screen while the keystore state is read on startup. */
.gate-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>
