<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons v-if="!mandatory" slot="end">
          <ion-button color="medium" @click="cancel">
            <ion-icon slot="icon-only" :icon="closeOutline" />
          </ion-button>
        </ion-buttons>
        <ion-title>Set up your profile</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div class="ps-intro ion-text-center">
        <p>Add a photo and your name so people know it's you before you start chatting.</p>
      </div>

      <div class="ps-avatar ion-text-center">
        <ion-avatar class="ps-img" :class="{ missing: !photo }" @click="editPhoto">
          <img v-if="avatar" :src="avatar" alt="Your photo" />
        </ion-avatar>
        <div>
          <ion-button fill="clear" size="small" @click="editPhoto">
            {{ photo ? 'Change photo' : 'Add photo' }}
          </ion-button>
        </div>
        <p v-if="!photo" class="ps-required">A photo is required</p>
      </div>

      <ion-list :inset="true">
        <ion-item>
          <ion-input
            ref="nameInput"
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
            label="About (optional)"
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

      <div class="ps-actions ion-padding">
        <ion-button expand="block" shape="round" :disabled="!canFinish" @click="finish">
          Start messaging
        </ion-button>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
  IonContent, IonAvatar, IonList, IonItem, IonInput, actionSheetController, modalController,
} from '@ionic/vue';
import type { ActionSheetButton } from '@ionic/vue';
import { cameraOutline, imageOutline, trashOutline, closeOutline } from 'ionicons/icons';
import { getSecret, setSecret } from '@/db/secrets';
import { getSelfUsername } from '@/services/auth';
import { initialsAvatar } from '@/db/avatars';
import { publishOwnProfile } from '@/services/directory';
import { pickImageFile, fileToDataUrl } from '@/utils/pick-image';
import { capitalizeFirst } from '@/utils/text';

// `mandatory` (onboarding): hide the close button so the only way out is finishing,
// the profile is required before the new user reaches the rest of onboarding.
const props = defineProps<{ mandatory?: boolean }>();
const mandatory = computed(() => !!props.mandatory);

const DEFAULT_ABOUT = 'Hey there! I am using Ring.';

const name = ref('');
const about = ref('');
const photo = ref('');

const avatar = computed(() => photo.value || initialsAvatar(name.value || 'You'));
// Photo required + a real (non-empty) name; About stays optional.
const canFinish = computed(() => !!photo.value && name.value.trim().length > 0);

onMounted(async () => {
  const storedName = (await getSecret('profileName', '')).trim();
  // Prefill the name with the immutable username (first letter capitalized) when it's
  // still the default, so the field arrives populated and the user only needs to
  // confirm/edit + add a photo.
  const seeded =
    !storedName || storedName === 'You' ? capitalizeFirst(getSelfUsername() ?? '') : storedName;
  name.value = seeded;
  if (seeded && seeded !== storedName) await setSecret('profileName', seeded);
  about.value = await getSecret('profileAbout', DEFAULT_ABOUT);
  photo.value = await getSecret('profileAvatar', '');
});

async function selectOnFocus(ev: Event): Promise<void> {
  const el = ev.target as HTMLIonInputElement | null;
  if (!el) return;
  const native = await el.getInputElement();
  native.select();
}

async function onName(value?: string | null): Promise<void> {
  const v = (value ?? '').trim();
  name.value = v;
  if (!v) return; // keep the last non-blank name persisted
  await setSecret('profileName', v);
  void publishOwnProfile();
}

async function onAbout(value?: string | null): Promise<void> {
  about.value = (value ?? '').trim();
  await setSecret('profileAbout', about.value);
  void publishOwnProfile();
}

// Take/choose a photo via the shared robust picker (handles the Android camera
// focus/`change` race). Persist BEFORE flipping the reactive ref, so canFinish
// (which enables "Start messaging") can never be true before the avatar secret is
// written; ensureProfile re-validates against the persisted secret, not photo.value.
async function pickPhoto(capture: boolean): Promise<void> {
  const file = await pickImageFile(capture);
  if (!file) return;
  const dataUrl = await fileToDataUrl(file);
  await setSecret('profileAvatar', dataUrl);
  photo.value = dataUrl;
  void publishOwnProfile();
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
      handler: () => {
        photo.value = '';
        void setSecret('profileAvatar', '').then(() => publishOwnProfile());
      },
    });
  }
  buttons.push({ text: 'Cancel', role: 'cancel' });
  const sheet = await actionSheetController.create({ header: 'Profile picture', buttons });
  await sheet.present();
}

function finish(): void {
  if (!canFinish.value) return;
  void modalController.dismiss(true, 'confirm');
}
function cancel(): void {
  void modalController.dismiss(false, 'cancel');
}
</script>

<style scoped>
.ps-intro {
  padding: 16px 24px 0;
  color: var(--app-text-muted, #8e8e93);
  font-size: 14px;
  line-height: 1.45;
}
.ps-avatar {
  padding: 16px 16px 4px;
}
.ps-img {
  width: 104px;
  height: 104px;
  margin: 0 auto 4px;
  cursor: pointer;
  background: rgba(120, 120, 128, 0.16);
}
.ps-img.missing {
  border: 2px dashed var(--ion-color-medium, #92949c);
}
.ps-required {
  color: var(--ion-color-warning, #ffc409);
  font-size: 13px;
  margin: 2px 0 0;
}
.ps-actions {
  margin-top: 8px;
}
</style>
