<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/settings" />
        </ion-buttons>
        <ion-title>Profile</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div class="profile ion-text-center">
        <ion-avatar class="profile-avatar">
          <img :src="avatar" :alt="name" />
        </ion-avatar>
        <div>
          <ion-button fill="clear" size="small" @click="editPhoto">Edit</ion-button>
        </div>
      </div>

      <!-- Inline editable fields (stock ion-input): tapping the field focuses
           it directly so the keyboard shows reliably (incl. iOS PWA); the
           current text is selected on focus, and the clear (✕) button + sentence
           auto-capitalization come from ion-input. Saved on change (blur/enter). -->
      <ion-list :inset="true">
        <ion-item>
          <ion-input
            label="Name"
            label-placement="stacked"
            :value="name"
            placeholder="Your name"
            :clear-input="true"
            autocapitalize="sentences"
            enterkeyhint="done"
            @ion-focus="selectOnFocus"
            @ion-change="onName($event.detail.value)"
          />
        </ion-item>
        <ion-item lines="none">
          <ion-input
            label="About"
            label-placement="stacked"
            :value="about"
            placeholder="Add a few words about yourself"
            :clear-input="true"
            autocapitalize="sentences"
            enterkeyhint="done"
            @ion-focus="selectOnFocus"
            @ion-change="onAbout($event.detail.value)"
          />
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonAvatar, IonList, IonItem, IonInput, IonButton,
  actionSheetController,
} from '@ionic/vue';
import type { ActionSheetButton } from '@ionic/vue';
import { cameraOutline, imageOutline, trashOutline } from 'ionicons/icons';
import { getSecret, setSecret } from '@/db/secrets';
import { isUnlocked } from '@/services/crypto/identity';
import { getSelfUsername } from '@/services/auth';
import { initialsAvatar } from '@/db/avatars';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { publishOwnProfile } from '@/services/directory';

const DEFAULT_ABOUT = 'Hey there! I am using Ring.';
// Fall back to the immutable username (not "You") so the field is prepopulated even
// before the user sets a name.
const NAME_FALLBACK = getSelfUsername() ?? 'You';

// Profile fields are encrypted at rest (Class B); re-read once the keystore
// unlocks so decrypted values replace the locked-state fallbacks.
const name = useLiveQuery(() => getSecret('profileName', NAME_FALLBACK), ['settings'], NAME_FALLBACK, () => isUnlocked.value);
const about = useLiveQuery(() => getSecret('profileAbout', DEFAULT_ABOUT), ['settings'], DEFAULT_ABOUT, () => isUnlocked.value);
const photo = useLiveQuery(() => getSecret('profileAvatar', ''), ['settings'], '', () => isUnlocked.value);

// Use the chosen photo if there is one, otherwise the generated initials avatar.
const avatar = computed(() => photo.value || initialsAvatar(name.value));

/* ---- inline Name / About editing ---- */

// Select the existing text when a field gains focus, so it can be typed over.
async function selectOnFocus(ev: Event): Promise<void> {
  const el = ev.target as HTMLIonInputElement | null;
  if (!el) return;
  const native = await el.getInputElement();
  native.select();
}

async function onName(value?: string | null): Promise<void> {
  const v = (value ?? '').trim();
  if (!v) return; // never blank out the name
  await setSecret('profileName', v);
  void publishOwnProfile(); // reflect the new display name in the directory
}

async function onAbout(value?: string | null): Promise<void> {
  await setSecret('profileAbout', (value ?? '').trim());
  void publishOwnProfile();
}

/* ---- profile picture ---- */

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// A transient <input type="file"> is the only way to take/choose an image in a
// PWA. "Take photo" hints the camera via the capture attribute on mobile.
// The input MUST be attached to the document: on iOS Safari a detached file
// input often doesn't fire `change` on the first use (and can be GC'd before
// the picker returns), which made the first photo pick silently do nothing.
function pickPhoto(capture: boolean) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (capture) input.setAttribute('capture', 'user');
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);

  const cleanup = () => input.remove();
  input.onchange = async () => {
    try {
      const file = input.files?.[0];
      if (file) {
        await setSecret('profileAvatar', await fileToDataUrl(file));
        void publishOwnProfile();
      }
    } finally {
      cleanup();
    }
  };
  // If the picker is cancelled, `change` never fires; remove the input once the
  // window regains focus so it doesn't linger.
  const onFocus = () => {
    window.removeEventListener('focus', onFocus);
    setTimeout(() => {
      if (document.body.contains(input)) cleanup();
    }, 800);
  };
  window.addEventListener('focus', onFocus);

  input.click();
}

async function editPhoto() {
  const buttons: ActionSheetButton[] = [
    { text: 'Take photo', icon: cameraOutline, handler: () => pickPhoto(true) },
    { text: 'Choose photo', icon: imageOutline, handler: () => pickPhoto(false) },
  ];
  if (photo.value) {
    buttons.push({
      text: 'Remove photo',
      role: 'destructive',
      icon: trashOutline,
      handler: () => void setSecret('profileAvatar', '').then(() => publishOwnProfile()),
    });
  }
  buttons.push({ text: 'Cancel', role: 'cancel' });
  const sheet = await actionSheetController.create({ header: 'Edit profile picture', buttons });
  await sheet.present();
}
</script>

<style scoped>
.profile {
  padding: 24px 16px 8px;
}
.profile-avatar {
  width: 96px;
  height: 96px;
  margin: 0 auto 4px;
}
</style>
