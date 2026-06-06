<template>
  <ion-page class="pc-modal">
    <ion-content :fullscreen="true">
      <ion-buttons class="pc-close">
        <ion-button color="medium" @click="cancel">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </ion-buttons>

      <!-- SET, step 1: choose 4 or 6 digits (auto-verify needs a fixed length). -->
      <div v-if="variant === 'set' && step === 'pick'" class="pc-pick ion-text-center">
        <p class="pc-title">Set a passcode</p>
        <p class="pc-desc">
          You'll enter it each time you open Ring. While a passcode is set, background
          notifications won't show message previews.
        </p>
        <ion-segment v-model="lenChoice" class="pc-seg">
          <ion-segment-button value="4"><ion-label>4 digits</ion-label></ion-segment-button>
          <ion-segment-button value="6"><ion-label>6 digits</ion-label></ion-segment-button>
        </ion-segment>
        <ion-button expand="block" shape="round" class="pc-continue" @click="step = 'choose'">
          Continue
        </ion-button>
      </div>

      <!-- SET steps 2/3 (choose → confirm), or VERIFY (enter once). -->
      <pin-pad
        v-else
        :key="`${variant}-${step}-${attempt}`"
        :title="padTitle"
        :description="padDesc"
        :reserve-description="variant === 'set'"
        :length="activeLen"
        :error="error"
        :busy="busy"
        @submit="onSubmit"
      />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonPage, IonContent, IonButtons, IonButton, IonIcon,
  IonSegment, IonSegmentButton, IonLabel, modalController,
} from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import PinPad from '@/components/PinPad.vue';

const props = withDefaults(
  defineProps<{
    /** 'set' = pick length → enter → confirm (returns the new PIN). 'verify' =
     *  enter the existing PIN once (returns it for the caller to check). */
    variant?: 'set' | 'verify';
    /** Known length for 'verify' (so it auto-submits at the right count). */
    length?: number;
    busy?: boolean;
    error?: string;
  }>(),
  { variant: 'set', length: undefined, busy: false, error: '' },
);

const step = ref<'pick' | 'choose' | 'confirm'>(props.variant === 'set' ? 'pick' : 'choose');
const lenChoice = ref<'4' | '6'>('6');
const chosenLen = computed(() => Number(lenChoice.value));
const firstPin = ref('');
const error = ref('');
const attempt = ref(0); // bump to clear the pad

// The length the active pad auto-submits at.
const activeLen = computed(() => (props.variant === 'verify' ? props.length : chosenLen.value));

const padTitle = computed(() => {
  if (props.variant === 'verify') return 'Enter passcode';
  return step.value === 'confirm' ? 'Confirm passcode' : 'Choose a passcode';
});
const padDesc = computed(() =>
  props.variant === 'set' && step.value === 'choose' ? `Enter a ${chosenLen.value}-digit passcode.` : '',
);

function onSubmit(code: string): void {
  if (props.variant === 'verify') {
    void modalController.dismiss(code, 'confirm');
    return;
  }
  if (step.value === 'choose') {
    firstPin.value = code;
    error.value = '';
    step.value = 'confirm';
    attempt.value += 1;
    return;
  }
  // confirm
  if (code !== firstPin.value) {
    error.value = 'Passcodes didn’t match. Try again.';
    firstPin.value = '';
    step.value = 'choose';
    attempt.value += 1;
    return;
  }
  void modalController.dismiss(code, 'confirm');
}

function cancel(): void {
  void modalController.dismiss(null, 'cancel');
}
</script>

<style scoped>
.pc-close {
  position: absolute;
  top: max(env(safe-area-inset-top, 0px), 8px);
  right: 8px;
  z-index: 2;
}
.pc-pick {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100%;
  padding: 0 24px max(env(safe-area-inset-bottom, 0px), 24px);
}
.pc-title {
  font-size: 26px;
  margin: 0 0 8px;
}
.pc-desc {
  font-size: 14px;
  line-height: 1.45;
  color: var(--app-text-muted, #8e8e93);
  margin: 0 auto 24px;
  max-width: 320px;
}
.pc-seg {
  max-width: 280px;
  margin: 0 auto;
}
.pc-continue {
  max-width: 280px;
  margin: 28px auto 0;
}
</style>
