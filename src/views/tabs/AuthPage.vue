<template>
  <ion-page>
    <!-- No header/tab-bar on the auth screen: the brand block below IS the title,
         and the bottom bar would only hold a self-linking "Auth" tab. With no
         header reserving it, clear the status-bar / notch ourselves (.auth-top). -->
    <ion-content :fullscreen="true">
      <!-- Brand block. The logo is the original Ring mark (rounded primary
           badge + white shield with an emerald ring knocked out), inlined as
           SVG artwork, it's a brand asset, not UI chrome. Title/subtitle use
           stock ion-text, centered with Ionic utility classes. -->
      <div class="ion-text-center ion-padding auth-top">
        <!-- Original Ring logo from LoginPage, reproduced exactly: a 76px
             rounded primary badge holding the 58px white shield with an emerald
             ring knocked out. The .brand-logo / .brand-mark scoped styling from
             LoginPage is applied here as inline styles (this page has no style
             block) so it renders identically. Colors use inline `style` rather
             than fill=/stroke= attributes because WebKit doesn't resolve var()
             in SVG presentation attributes. -->
        <div
          style="
            width: 76px;
            height: 76px;
            margin: 0 auto 20px;
            border-radius: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--ion-color-primary);
            box-shadow: 0 12px 32px rgba(16, 185, 129, 0.45);
          "
        >
          <svg viewBox="0 0 100 100" width="58" height="58" aria-hidden="true">
            <path
              style="fill: #fff;"
              d="M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z"
            />
            <circle
              cx="50"
              cy="49"
              r="18"
              style="fill: none; stroke: var(--ion-color-primary); stroke-width: 7;"
            />
          </svg>
        </div>
        <ion-text>
          <h1>Ring</h1>
        </ion-text>
        <ion-text color="medium">
          <p>{{ subtitle }}</p>
        </ion-text>
      </div>

      <!-- REGISTER / RESTORE, the only ways onto a fresh device. There is no
           "sign in": logging out wipes this device's token and key material, so a
           returning user either registers with a new invitation code or restores
           an existing account with their recovery code. -->
      <!-- Choose how to get onto this device. Each button opens a focused code
           field (keyboard raised + paste button); see the modal below. -->
      <div v-if="phase === 'auth'" class="ion-padding">
        <ion-button
          expand="block"
          shape="round"
          :disabled="loading"
          @click="openPrompt('invite')"
        >
          Have Invitation Code
        </ion-button>
        <ion-button
          expand="block"
          shape="round"
          fill="outline"
          :disabled="loading"
          @click="openPrompt('recovery')"
        >
          Have Recovery Key
        </ion-button>
        <ion-text color="medium">
          <p class="auth-blurb">
            Ring is invitation-only and end-to-end encrypted. Your messages and keys
            stay on your device, no phone number, no ads, and no one in the middle
            can read them.
          </p>
        </ion-text>
      </div>

      <!-- POST-AUTH PERMISSION ONBOARDING. One permission per step (push only
           for now), each requested behind its own gesture so iOS surfaces the
           native prompt. "Skip for now" advances WITHOUT prompting, preserving
           the ability to ask later. The last step lands on Chats. -->
      <div v-else-if="phase === 'onboarding' && step" class="ion-padding">
        <div class="ion-text-center ion-padding">
          <ion-icon :icon="step.icon" color="primary" style="font-size: 64px;" />
          <ion-text>
            <h2>{{ step.title }}</h2>
          </ion-text>
          <ion-text color="medium">
            <p>{{ step.supported ? step.description : step.unsupportedNote }}</p>
          </ion-text>
        </div>

        <div class="ion-padding">
          <ion-button
            expand="block"
            shape="round"
            :disabled="loading"
            @click="step.supported ? allowStep() : skipStep()"
          >
            <ion-spinner v-if="loading" name="crescent" />
            <span v-else>{{ step.supported ? 'Allow' : 'Continue' }}</span>
          </ion-button>
          <ion-button
            v-if="step.supported"
            expand="block"
            fill="clear"
            :disabled="loading"
            @click="skipStep"
          >
            Skip for now
          </ion-button>
        </div>
      </div>

      <!-- REGISTRATION RECOVERY CODE. Shown BEFORE the server account exists: only
           after "I've saved it" do we consume the invite and claim the username, so
           abandoning here uses nothing and the code + name stay free to reuse. -->
      <div v-else-if="phase === 'recovery'" class="ion-padding recovery-step">
        <div class="ion-text-center">
          <ion-icon :icon="keyOutline" color="primary" style="font-size: 56px;" />
          <ion-text><h2>Save your recovery code</h2></ion-text>
          <ion-text color="medium">
            <p>
              This is the only way back into your account if you lose this device. I
              can't recover it for you, so keep it somewhere safe.
            </p>
          </ion-text>
        </div>

        <div class="recovery-code">{{ recoveryDisplay }}</div>
        <ion-button expand="block" fill="outline" shape="round" @click="copyRecovery">
          {{ recoveryCopied ? 'Copied' : 'Copy code' }}
        </ion-button>

        <!-- Finalize failed (username taken, or invite expired) → clear next steps. -->
        <div v-if="regError" class="reg-error">
          <ion-text color="danger"><p>{{ regErrorMessage }}</p></ion-text>
          <ion-input
            v-if="regError === 'taken'"
            v-model="regUsername"
            fill="outline"
            label="New username"
            label-placement="stacked"
            aria-label="New username"
            autocapitalize="none"
            autocorrect="off"
            :spellcheck="false"
            enterkeyhint="done"
          >
            <span slot="start" style="color: var(--ion-color-medium); padding-inline-end: 4px;">@</span>
          </ion-input>
        </div>

        <ion-button
          expand="block"
          shape="round"
          class="ion-margin-top"
          :disabled="loading || (regError === 'taken' && !isUsernameFormatValid(regUsername))"
          @click="finishRegistration"
        >
          <ion-spinner v-if="loading" name="crescent" />
          <span v-else>{{ regError ? 'Try again' : 'I’ve saved it, continue' }}</span>
        </ion-button>
        <ion-button expand="block" fill="clear" :disabled="loading" @click="cancelRegistration">
          Start over
        </ion-button>
      </div>

      <!-- App version, pinned to the bottom (sticky-footer via the flex column on
           the scroll part). Only on the landing screen, not mid-onboarding. -->
      <div v-if="phase === 'auth'" class="auth-footer ion-text-center">
        <ion-text color="medium">
          <p>Ring v{{ appVersion }}</p>
        </ion-text>
      </div>
    </ion-content>

    <!-- Code entry for both flows. The field autofocuses on present (keyboard
         pops) and carries an inline paste button. Invitation → register → onboarding;
         recovery key → restore passwordlessly → onboarding (passcode opt-in later). -->
    <ion-modal
      :is-open="entryMode !== null"
      @did-present="focusEntry"
      @did-dismiss="closePrompt"
    >
      <ion-header>
        <ion-toolbar>
          <ion-title>{{ modalTitle }}</ion-title>
          <ion-buttons slot="end">
            <ion-button @click="entryMode = null">Cancel</ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <!-- RECOVERY: a single code field that auto-submits on a complete key. -->
        <template v-if="entryMode === 'recovery'">
          <ion-text color="medium">
            <p>Enter the recovery key you saved when you set up Ring to restore your account on this device.</p>
          </ion-text>
          <ion-input
            ref="entryInput"
            v-model="entry"
            fill="outline"
            aria-label="Recovery key"
            :maxlength="40"
            autocapitalize="characters"
            autocorrect="off"
            :spellcheck="false"
            enterkeyhint="go"
            placeholder="XXXX-XXXX-…"
            style="text-align: center;"
            @keyup.enter="submitPrompt"
          >
            <ion-button slot="end" fill="clear" aria-label="Paste" @click="pasteEntry">
              <ion-icon slot="icon-only" :icon="clipboardOutline" />
            </ion-button>
          </ion-input>
          <ion-text v-if="entryError" color="danger"><p>{{ entryError }}</p></ion-text>
        </template>

        <!-- INVITE · STEP 1, the invitation code. "Continue" advances to the
             dedicated username step. -->
        <template v-else-if="inviteStep === 'code'">
          <ion-text color="medium">
            <p>Enter the 8-character invitation code you were given.</p>
          </ion-text>
          <ion-input
            ref="entryInput"
            v-model="entry"
            fill="outline"
            aria-label="Invitation code"
            :maxlength="8"
            autocapitalize="characters"
            autocorrect="off"
            :spellcheck="false"
            enterkeyhint="next"
            placeholder="ABCD1234"
            style="text-align: center;"
            @keyup.enter="codeContinue"
          >
            <ion-button slot="end" fill="clear" aria-label="Paste" @click="pasteEntry">
              <ion-icon slot="icon-only" :icon="clipboardOutline" />
            </ion-button>
          </ion-input>
          <ion-text v-if="entryError" color="danger"><p>{{ entryError }}</p></ion-text>
          <ion-button
            expand="block"
            shape="round"
            class="ion-margin-top"
            :disabled="!codeValid || loading"
            @click="codeContinue"
          >
            Continue
          </ion-button>
        </template>

        <!-- INVITE · STEP 2, the (permanent) username, on its own focused screen
             so it gets the attention it deserves: it's how others find you and the
             anchor that proves you're you, and it can't be changed later. -->
        <template v-else>
          <div class="ion-text-center username-hero">
            <ion-icon :icon="atCircleOutline" color="primary" />
            <ion-text><h2>Choose your username</h2></ion-text>
            <ion-text color="medium">
              <p>This is how people find you on Ring, and it’s permanent, so pick one you’ll be happy with.</p>
            </ion-text>
          </div>
          <ion-input
            ref="usernameInput"
            v-model="username"
            fill="outline"
            label="Username"
            label-placement="stacked"
            aria-label="Username"
            :autofocus="true"
            :maxlength="30"
            autocapitalize="none"
            autocorrect="off"
            :spellcheck="false"
            enterkeyhint="done"
            placeholder="e.g. ada.lovelace"
            @keyup.enter="submitPrompt"
          >
            <span slot="start" style="color: var(--ion-color-medium); padding-inline-end: 4px;">@</span>
          </ion-input>
          <ion-text color="medium">
            <p class="username-hint">3 to 30 letters, digits, “_” or “.”. You can’t change it later.</p>
          </ion-text>
          <ion-text v-if="entryError" color="danger"><p>{{ entryError }}</p></ion-text>
          <ion-button
            expand="block"
            shape="round"
            class="ion-margin-top"
            :disabled="!entryValid || loading"
            @click="submitPrompt"
          >
            <ion-spinner v-if="loading" name="crescent" />
            <span v-else>Create account</span>
          </ion-button>
          <ion-button expand="block" fill="clear" :disabled="loading" @click="backToCode">
            Back
          </ion-button>
        </template>
      </ion-content>
    </ion-modal>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  IonPage,
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonModal,
  IonIcon,
  IonText,
  IonInput,
  IonButton,
  IonSpinner,
  useIonRouter,
} from '@ionic/vue';
import {
  atCircleOutline,
  clipboardOutline,
  notificationsOutline,
  keyOutline,
} from 'ionicons/icons';
import {
  register,
  beginRestore,
  finishRestore,
  isUsernameFormatValid,
} from '@/services/auth';
import {
  ensureIdentity,
  rotateRecoveryCode,
  loadIdentityState,
  attemptDeviceUnlock,
  wipeIdentity,
  isInitialized,
  isUnlocked,
} from '@/services/crypto/identity';
import { migrateSecrets } from '@/db/secrets';
import { seedProfileName, profileComplete } from '@/db/queries';
import { ensureProfile } from '@/composables/useProfileGate';
import {
  markPushHandled,
  pushPermission,
  requestPushPermission,
  wasPushHandled,
} from '@/services/permissions';

// Enter the app at the root: the Auth page is a top-level route (a sibling of
// /tabs in the root outlet), so a 'root' replace tears it down and lands on Chats
// as a fresh root with no back-stack. (Auth deliberately lives OUTSIDE <ion-tabs>:
// when it was a button-less tab child, leaving it never fired ion-tabs' leave
// transition on iOS WebKit and the onboarding stayed stuck on top of Chats.)
const ionRouter = useIonRouter();
function enterChats(): void {
  ionRouter.navigate('/tabs/chats', 'root', 'replace');
}

// Auth screen, the app's sole entry point onto a fresh device. Built entirely
// from stock, uncustomized Ionic components (brand, invitation-code register,
// recovery-code restore). There is no token sign-in: logging out wipes this
// device's token + keys, so a returning user re-registers or restores.
const loading = ref(false);

// Code-entry modal: which flow is open (null = closed), the typed value, an
// inline error, and a template ref to the field so we can raise the keyboard on
// present.
const entryMode = ref<null | 'invite' | 'recovery'>(null);
// The invite flow is a two-step wizard: enter the code, then choose the username
// on its own focused screen (it's permanent, so it earns its own step).
const inviteStep = ref<'code' | 'username'>('code');
const entry = ref('');
// Username (invite flow only), chosen once, immutable. Lowercased as typed.
const username = ref('');
const entryError = ref('');
const entryInput = ref<{ $el?: { setFocus?: () => void } } | null>(null);
const usernameInput = ref<{ $el?: { setFocus?: () => void } } | null>(null);

// 'auth' shows the sign-in/register UI; 'recovery' shows the new account's recovery
// code BEFORE the server account is created (so the invite code + username are only
// claimed once the user confirms they saved it); 'onboarding' is the post-auth
// permission wizard before the user lands in the app. (Restoring with a recovery key
// is passwordless like registration, so it skips straight to onboarding.)
const phase = ref<'auth' | 'recovery' | 'onboarding'>('auth');

// Registration recovery step state (between the username and the server register).
const regCode = ref(''); // the invitation code being redeemed
const regUsername = ref(''); // the username being claimed (editable if it's taken)
const recoveryDisplay = ref(''); // the recovery code to show
const recoveryCopied = ref(false);
const regError = ref<'' | 'taken' | 'expired' | 'other'>(''); // last finalize failure

// Guard for submitPrompt (codes auto-submit, so there's no submit button): an
// invitation code is exactly 8 alphanumerics; a recovery key needs enough
// characters to be plausible (the server verifies it).
const entryValid = computed(() => {
  if (entryMode.value === 'invite') {
    return /^[A-Z0-9]{8}$/.test(entry.value) && isUsernameFormatValid(username.value);
  }
  if (entryMode.value === 'recovery') return entry.value.replace(/[^a-zA-Z0-9]/g, '').length >= 16;
  return false;
});

// Just the code's format, gates "Continue" from the code step to the username step.
const codeValid = computed(() => /^[A-Z0-9]{8}$/.test(entry.value));

// Modal title tracks the current step.
const modalTitle = computed(() => {
  if (entryMode.value === 'recovery') return 'Recovery key';
  return inviteStep.value === 'username' ? 'Choose a username' : 'Invitation code';
});

const appVersion = __APP_VERSION__;

const subtitle = computed(() => {
  if (phase.value === 'onboarding') return 'One more thing';
  if (phase.value === 'recovery') return 'Almost there';
  return 'Private, end-to-end encrypted messaging';
});

const regErrorMessage = computed(() => {
  if (regError.value === 'taken') {
    return "That username isn't available (it may be taken, reserved, or invalid). Choose a different one and tap Try again.";
  }
  if (regError.value === 'expired') {
    return 'This invitation expired or is no longer valid. Ask whoever invited you to extend it (or send a new code), then tap Try again.';
  }
  return entryError.value || 'Something went wrong. Please try again.';
});

// --- Post-auth permission onboarding (push only for now) ---
//
// Data-driven so more permissions become one array entry. Each step requests
// its permission behind a gesture; `onSkip` records the step as handled WITHOUT
// prompting, so a skipped permission can still be asked later.
interface OnboardingStep {
  key: string;
  icon: string;
  title: string;
  description: string;
  /** Shown instead of `description` when the permission isn't available here. */
  unsupportedNote: string;
  /** False when the API isn't usable (e.g. push outside an installed PWA). */
  supported: boolean;
  request: () => Promise<unknown>;
  onSkip?: () => void;
}

const pendingSteps = ref<OnboardingStep[]>([]);
const stepIndex = ref(0);
const step = computed<OnboardingStep | null>(
  () => pendingSteps.value[stepIndex.value] ?? null,
);

// Build the steps to show after auth. Push is included only while it's still
// undecided (not yet granted/denied/skipped). 'unsupported' (e.g. a non-
// standalone browser) still shows an informational step with a Home Screen
// hint rather than a dead Allow button.
function buildOnboardingSteps(): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  const push = pushPermission();
  if (!wasPushHandled() && (push === 'default' || push === 'unsupported')) {
    steps.push({
      key: 'push',
      icon: notificationsOutline,
      title: 'Stay in the loop',
      description:
        'Get notified when someone messages or calls you, even when Ring is closed.',
      unsupportedNote:
        'Add Ring to your Home Screen to turn on notifications.',
      supported: push === 'default',
      request: requestPushPermission,
      onSkip: markPushHandled,
    });
  }
  return steps;
}

// Called after a successful sign-in/register. First REQUIRES a profile (name +
// photo) so a new user never appears to peers as a nameless id, then shows the
// permission wizard (push) if any steps are pending; otherwise goes straight into
// the app. The profile gate is mandatory here (no close button) and must come
// BEFORE the push prompt.
async function enterApp() {
  // Loop so a hardware-back dismissal can't skip the requirement; ensureProfile
  // returns once name + photo are set (the modal's "Start messaging" is gated on it).
  while (!(await profileComplete())) {
    await ensureProfile({ mandatory: true });
  }
  pendingSteps.value = buildOnboardingSteps();
  if (pendingSteps.value.length === 0) {
    enterChats();
    return;
  }
  stepIndex.value = 0;
  phase.value = 'onboarding';
}

function advance() {
  if (stepIndex.value < pendingSteps.value.length - 1) {
    stepIndex.value += 1;
  } else {
    enterChats();
  }
}

async function allowStep() {
  const s = step.value;
  if (!s) return advance();
  loading.value = true;
  try {
    // Defensively bound the request: on some WebKit builds the permission-prompt
    // promise can hang. Without this the await never settles, `loading` stays true,
    // and BOTH buttons (disabled while loading) stop responding, the "stuck on the
    // notifications step, taps do nothing" bug. We advance no matter what.
    await Promise.race([s.request(), new Promise((resolve) => setTimeout(resolve, 12_000))]);
  } catch {
    /* a failed/blocked prompt must not trap the user on this step */
  } finally {
    loading.value = false;
    advance();
  }
}

function skipStep() {
  step.value?.onSkip?.(); // mark handled, but do NOT trigger the native prompt
  advance();
}

// Open / close the code-entry modal.
function openPrompt(kind: 'invite' | 'recovery') {
  entry.value = '';
  username.value = '';
  entryError.value = '';
  inviteStep.value = 'code';
  entryMode.value = kind;
}
function closePrompt() {
  entryMode.value = null;
  entry.value = '';
  username.value = '';
  entryError.value = '';
  inviteStep.value = 'code';
}

// Raise the keyboard for the freshly-presented field (one frame after present,
// so the input is interactive).
function focusEntry() {
  requestAnimationFrame(() => void entryInput.value?.$el?.setFocus?.());
}

// Advance the invite wizard from the code step to the username step, raising the
// keyboard on the username field. nextTick (a microtask continuation of the tap)
// keeps the user-gesture context iOS Safari needs to open the keyboard, a
// requestAnimationFrame would run a frame later, outside that window, and the field
// would focus without the keyboard.
function codeContinue() {
  if (!codeValid.value || loading.value) return;
  entryError.value = '';
  inviteStep.value = 'username';
  void nextTick(() => usernameInput.value?.$el?.setFocus?.());
}

// Back to the code step (keeps whatever was typed).
function backToCode() {
  entryError.value = '';
  inviteStep.value = 'code';
  void nextTick(() => entryInput.value?.$el?.setFocus?.());
}

// Uppercase as typed; a COMPLETE code auto-submits, an 8-char invitation code,
// or a full 32-hex recovery key (dashes/spaces ignored), so no submit button is
// needed. submitPrompt guards against double-firing while a submit is in flight.
watch(entry, (v) => {
  const up = v.toUpperCase();
  if (up !== v) {
    entry.value = up; // re-runs this watch with the uppercased value
    return;
  }
  entryError.value = '';
  const clean = up.replace(/[^0-9A-Z]/g, '');
  // Recovery auto-submits on a complete key. Invitation auto-advances to the
  // username step the moment the 8-char code is complete (no "Continue" tap), then
  // submits via "Create account" once the username is chosen.
  if (entryMode.value === 'recovery' && /^[0-9A-F]{32}$/.test(clean)) void submitPrompt();
  else if (entryMode.value === 'invite' && inviteStep.value === 'code' && codeValid.value) codeContinue();
});

// Usernames are lowercase handles; fold as typed so the field matches what the
// server stores and the help text promises.
watch(username, (v) => {
  const lower = v.toLowerCase();
  if (lower !== v) username.value = lower;
  else entryError.value = '';
});

// The taken-retry username field also folds to lowercase.
watch(regUsername, (v) => {
  const lower = v.toLowerCase();
  if (lower !== v) regUsername.value = lower;
});

async function pasteEntry() {
  try {
    const text = await navigator.clipboard.readText();
    entry.value =
      entryMode.value === 'invite' ? text.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) : text.trim();
  } catch {
    entryError.value = 'Could not read the clipboard.';
  }
}

// Submit the entered code. Invitation goes to the recovery-code step FIRST (the
// server account, which consumes the invite + claims the username, is only created
// once the user confirms they've saved the recovery code, see finishRegistration).
// Recovery key restores the identity passwordlessly and goes straight to onboarding.
async function submitPrompt() {
  if (!entryValid.value || loading.value) return;
  loading.value = true;
  entryError.value = '';
  try {
    if (entryMode.value === 'invite') {
      const code = await ensureRegistrationKeystore(); // create/rotate keys, get the recovery code
      regCode.value = entry.value;
      regUsername.value = username.value;
      recoveryDisplay.value = code;
      recoveryCopied.value = false;
      regError.value = '';
      entryMode.value = null;
      phase.value = 'recovery';
    } else {
      const staged = await beginRestore(entry.value);
      await finishRestore(staged); // passwordless device-key posture (passcode opt-in later)
      entryMode.value = null;
      void enterApp();
    }
  } catch (err) {
    entryError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

// Generate this device's identity + recovery code WITHOUT touching the server, so a
// half-finished registration consumes nothing. If keys already exist (a prior
// abandoned attempt), reuse them and rotate the recovery code for a fresh one.
async function ensureRegistrationKeystore(): Promise<string> {
  await loadIdentityState();
  let code: string;
  if (isInitialized.value) {
    // attemptDeviceUnlock() returns false (it does NOT throw) when the device key is
    // missing or corrupt, which would make rotateRecoveryCode() throw "Keystore is
    // locked." with no way forward on /auth. Nothing has been claimed server-side yet,
    // so if we genuinely can't unlock, discard the orphaned keys and start clean.
    const ok = isUnlocked.value || (await attemptDeviceUnlock());
    if (ok) {
      code = await rotateRecoveryCode();
    } else {
      await wipeIdentity();
      code = await ensureIdentity();
    }
  } else {
    code = await ensureIdentity(); // creates the identity, returns the one-time recovery code
  }
  await migrateSecrets();
  return code;
}

/** Finalize: NOW create the server account (consume the invite + claim the username)
 *  and commit the session. Run only after the user confirms they saved the recovery
 *  code, so an abandon before this leaves the code + username free to reuse. */
async function finishRegistration() {
  if (loading.value) return;
  loading.value = true;
  regError.value = '';
  entryError.value = '';
  try {
    await register(regCode.value, regUsername.value);
  } catch (err) {
    // Only register() (the irreversible step: consumes the invite, claims the username,
    // commits the session) is inside this guard. A username problem (taken, reserved, or
    // bad format) lets the user pick a new name inline; a dead invite needs the inviter
    // to extend it. Anything else surfaces verbatim. Never label a username rejection as
    // "expired", which would hide the editor and strand a user holding a valid invite.
    const msg = (err as Error).message;
    if (msg === 'username-taken' || msg === 'username-rejected') regError.value = 'taken';
    else if (msg === 'invite-invalid') regError.value = 'expired';
    else {
      regError.value = 'other';
      entryError.value = msg;
    }
    loading.value = false;
    return;
  }
  // Registered and the session is committed. Everything past here is best-effort and must
  // NOT bounce the user back to re-register on the now-consumed invite, so guard it.
  try {
    await seedProfileName(); // prefill the profile name with the claimed username
  } catch {
    /* non-fatal: the name prefill is cosmetic */
  }
  loading.value = false;
  void enterApp();
}

async function copyRecovery() {
  try {
    await navigator.clipboard.writeText(recoveryDisplay.value);
    recoveryCopied.value = true;
  } catch {
    /* clipboard unavailable; the code is on screen to copy by hand */
  }
}

// Back out of the recovery step. The keys stay on the device (reused/rotated next
// attempt); nothing was claimed on the server, so the code + username are still free.
function cancelRegistration() {
  regError.value = '';
  entryError.value = '';
  phase.value = 'auth';
}

</script>

<style scoped>
/* This screen has no header, so the brand block must clear the status bar / notch
   itself (the header used to reserve that space). env() needs viewport-fit=cover,
   which index.html sets. */
.auth-top {
  padding-top: calc(env(safe-area-inset-top, 0px) + 48px);
}

/* Registration recovery-code step. */
.recovery-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 20px;
  letter-spacing: 1px;
  text-align: center;
  word-break: break-all;
  line-height: 1.5;
  margin: 18px 0 14px;
  padding: 16px;
  border-radius: 12px;
  background: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
}
.reg-error {
  margin-top: 14px;
}
.reg-error p {
  margin: 0 0 8px;
  line-height: 1.45;
}

/* Sticky-footer layout: make the scroll area a full-height flex column so the
   version line can be pushed to the bottom (margin-top: auto) while the rest
   stays top-aligned. Still scrolls if the content grows past the viewport. */
ion-content::part(scroll) {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.auth-blurb {
  max-width: 30rem;
  margin: 20px auto 0;
  line-height: 1.45;
  text-align: center;
}

.auth-footer {
  margin-top: auto;
  padding: 12px 0 calc(env(safe-area-inset-bottom, 0px) + 12px);
  font-size: 0.8rem;
}

/* Dedicated username step: a focused hero so the (permanent) handle gets attention. */
.username-hero {
  margin-bottom: 16px;
}
.username-hero ion-icon {
  font-size: 56px;
}
.username-hero h2 {
  margin: 10px 0 4px;
}
.username-hero p {
  margin: 0;
  line-height: 1.4;
}
.username-hint {
  font-size: 0.8rem;
  margin-top: 6px;
}
</style>
