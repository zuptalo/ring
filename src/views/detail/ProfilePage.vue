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
          <user-avatar :src="avatar" :alt="name" />
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
import UserAvatar from '@/components/UserAvatar.vue';
import { computed } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonAvatar, IonList, IonItem, IonInput, IonButton,
  actionSheetController, modalController,
} from '@ionic/vue';
import type { ActionSheetButton } from '@ionic/vue';
import { cameraOutline, imageOutline, trashOutline, happyOutline } from 'ionicons/icons';
import EmojiPickerModal from '@/components/EmojiPickerModal.vue';
import { getSecret, setSecret } from '@/db/secrets';
import { isUnlocked } from '@/services/crypto/identity';
import { getSelfUsername } from '@/services/auth';
import { initialsAvatar, emojiAvatar } from '@/db/avatars';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { publishOwnProfile } from '@/services/directory';
import { pickImageFile, fileToDataUrl } from '@/utils/pick-image';

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

// Take/choose a photo via the shared robust picker (handles the Android camera
// focus/`change` race so the captured photo isn't dropped).
async function pickPhoto(capture: boolean): Promise<void> {
  const file = await pickImageFile(capture);
  if (!file) return;
  await setSecret('profileAvatar', await fileToDataUrl(file));
  void publishOwnProfile();
}

// Pick an emoji as the profile picture (spec 0008 FR-027): stored and published
// as an ordinary picture (emojiAvatar's disc); capable surfaces animate it.
async function pickEmoji(): Promise<void> {
  const modal = await modalController.create({
    component: EmojiPickerModal,
    cssClass: 'emoji-picker-sheet',
    breakpoints: [0, 0.6, 0.95],
    initialBreakpoint: 0.6,
  });
  await modal.present();
  const { data } = await modal.onWillDismiss<{ emoji?: string }>();
  if (!data?.emoji) return;
  await setSecret('profileAvatar', emojiAvatar(data.emoji));
  void publishOwnProfile();
}

async function editPhoto() {
  const buttons: ActionSheetButton[] = [
    { text: 'Take photo', icon: cameraOutline, handler: () => pickPhoto(true) },
    { text: 'Choose photo', icon: imageOutline, handler: () => pickPhoto(false) },
    { text: 'Pick an emoji', icon: happyOutline, handler: () => void pickEmoji() },
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
