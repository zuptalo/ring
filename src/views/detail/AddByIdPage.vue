<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/contacts" />
        </ion-buttons>
        <ion-title>Add by ID</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-text color="medium">
        <p>Enter or paste someone's Ring ID to send them a friend request.</p>
      </ion-text>

      <ion-list :inset="true">
        <ion-item>
          <ion-input
            ref="idInput"
            label="Ring ID"
            label-placement="stacked"
            :value="id"
            placeholder="Paste the Ring ID"
            :clear-input="true"
            autocapitalize="off"
            autocorrect="off"
            :spellcheck="false"
            enterkeyhint="send"
            @ion-input="id = $event.detail.value ?? ''"
            @keyup.enter="send"
          />
          <ion-button slot="end" fill="clear" @click="paste">Paste</ion-button>
        </ion-item>
      </ion-list>

      <ion-button expand="block" class="ion-margin-top" :disabled="!id.trim()" @click="send">
        Send request
      </ion-button>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonText, IonList, IonItem, IonInput, IonButton,
  onIonViewDidEnter,
} from '@ionic/vue';
import { appToast } from '@/services/toast';
import { requestFriend } from '@/db/queries';

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

const router = useRouter();
const id = ref('');
const idInput = ref<{ $el: HTMLIonInputElement } | null>(null);

// Best-effort: focus the field so the keyboard shows. On desktop/Android this
// pops the keyboard; iOS PWAs may need a tap on the field. The Paste button
// covers the (common) no-typing case where the ID was copied.
onIonViewDidEnter(() => {
  void idInput.value?.$el.setFocus();
});

async function paste() {
  try {
    const text = await navigator.clipboard?.readText();
    if (text) id.value = text.trim();
  } catch {
    /* clipboard unavailable or permission denied */
  }
  void idInput.value?.$el.setFocus();
}

async function toast(message: string, color?: string) {
  await appToast({ message, duration: 1500, color });
}

async function send() {
  const match = id.value.match(UUID_RE);
  if (!match) {
    void toast("That doesn't look like a Ring ID.", 'danger');
    return;
  }
  await requestFriend(match[0]);
  void toast('Friend request sent');
  router.replace('/tabs/contacts');
}
</script>
