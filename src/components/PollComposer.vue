<template>
  <ion-modal :is-open="open" @did-dismiss="$emit('close')" @did-present="focusQuestion">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button @click="$emit('close')">Cancel</ion-button></ion-buttons>
        <ion-title>New poll</ion-title>
        <ion-buttons slot="end">
          <ion-button :strong="true" :disabled="!valid" @click="create">Create</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-list inset>
        <ion-item>
          <ion-input
            ref="qInput"
            v-model="question"
            label="Question"
            label-placement="stacked"
            placeholder="Ask something…"
            autocapitalize="sentences"
            autocorrect="on"
            :spellcheck="true"
            :maxlength="200"
          />
        </ion-item>
      </ion-list>

      <ion-list-header>Options</ion-list-header>
      <ion-list inset>
        <ion-item v-for="(_, i) in options" :key="i">
          <ion-input
            v-model="options[i]"
            :placeholder="`Option ${i + 1}`"
            autocapitalize="sentences"
            autocorrect="on"
            :spellcheck="true"
            :maxlength="100"
          />
          <ion-button v-if="options.length > 2" slot="end" fill="clear" @click="removeOpt(i)">
            <ion-icon slot="icon-only" :icon="closeCircle" color="medium" />
          </ion-button>
        </ion-item>
      </ion-list>
      <div class="ion-padding-start">
        <ion-button v-if="options.length < 10" size="small" fill="clear" @click="addOpt">
          <ion-icon slot="start" :icon="addCircleOutline" />
          Add option
        </ion-button>
      </div>

      <ion-list inset>
        <ion-item lines="none">
          <ion-toggle v-model="multi">Allow multiple answers</ion-toggle>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonList, IonListHeader, IonItem, IonInput, IonIcon, IonToggle,
} from '@ionic/vue';
import { closeCircle, addCircleOutline } from 'ionicons/icons';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'create', poll: { question: string; options: string[]; multi: boolean }): void;
}>();

const question = ref('');
const options = ref<string[]>(['', '']);
const multi = ref(false);
const qInput = ref<{ $el: HTMLIonInputElement } | null>(null);

// Focus the question field as soon as the sheet is shown.
const focusQuestion = () => void qInput.value?.$el?.setFocus();

// Reset the form each time the sheet opens.
watch(
  () => props.open,
  (o) => {
    if (o) {
      question.value = '';
      options.value = ['', ''];
      multi.value = false;
    }
  },
);

const cleaned = computed(() => options.value.map((o) => o.trim()).filter(Boolean));
const valid = computed(() => question.value.trim().length > 0 && cleaned.value.length >= 2);

const addOpt = () => options.value.push('');
const removeOpt = (i: number) => options.value.splice(i, 1);

function create(): void {
  if (!valid.value) return;
  emit('create', { question: question.value.trim(), options: cleaned.value, multi: multi.value });
}
</script>
