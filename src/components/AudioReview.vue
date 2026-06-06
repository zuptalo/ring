<template>
  <ion-modal :is-open="open" @did-dismiss="$emit('close')" @did-present="focusTitle">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button @click="$emit('close')">Cancel</ion-button></ion-buttons>
        <ion-title>Send audio</ion-title>
        <ion-buttons slot="end">
          <ion-button :strong="true" :disabled="!title.trim()" @click="send">Send</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="preview">
        <div class="cover">
          <img v-if="coverUrl" :src="coverUrl" alt="" />
          <ion-icon v-else :icon="musicalNotes" />
        </div>
        <div class="dur">{{ fmtDur }}</div>
      </div>
      <ion-list inset>
        <ion-item>
          <ion-input
            ref="titleInput"
            v-model="title"
            label="Title"
            label-placement="stacked"
            autocapitalize="words"
            :maxlength="120"
          />
        </ion-item>
        <ion-item>
          <ion-input
            v-model="artist"
            label="Artist"
            label-placement="stacked"
            autocapitalize="words"
            :maxlength="120"
          />
        </ion-item>
      </ion-list>
      <p class="hint">Read from the file. Fix anything that's missing or wrong before sending.</p>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonList, IonItem, IonInput, IonIcon,
} from '@ionic/vue';
import { musicalNotes } from 'ionicons/icons';

const props = defineProps<{
  open: boolean;
  initialTitle?: string;
  initialArtist?: string;
  coverUrl?: string;
  durationSec?: number;
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'send', meta: { title: string; artist: string }): void;
}>();

const title = ref('');
const artist = ref('');
const titleInput = ref<{ $el: HTMLIonInputElement } | null>(null);

watch(
  () => props.open,
  (o) => {
    if (o) {
      title.value = props.initialTitle ?? '';
      artist.value = props.initialArtist ?? '';
    }
  },
);

const fmtDur = computed(() => {
  const t = Math.max(0, Math.floor(props.durationSec ?? 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
});
const focusTitle = () => {
  if (!title.value) void titleInput.value?.$el?.setFocus();
};
function send(): void {
  if (!title.value.trim()) return;
  emit('send', { title: title.value.trim(), artist: artist.value.trim() });
}
</script>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 8px 0 4px;
}
.cover {
  width: 140px;
  height: 140px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(var(--ion-color-primary-rgb), 0.14);
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover ion-icon {
  font-size: 56px;
  color: var(--ion-color-primary);
}
.dur {
  font-size: 13px;
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
}
.hint {
  font-size: 13px;
  color: var(--app-text-muted);
  padding: 0 16px;
}
</style>
