<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/settings/calls" />
        </ion-buttons>
        <ion-title>Decline with message</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Decline with message</ion-title>
        </ion-toolbar>
      </ion-header>

      <!-- Editable, reorderable list of quick replies. -->
      <ion-list :inset="true">
        <ion-reorder-group :disabled="false" @ion-item-reorder="onReorder">
          <ion-item v-for="(item, i) in items" :key="i">
            <ion-input
              :value="item"
              placeholder="Quick reply"
              autocapitalize="sentences"
              :spellcheck="true"
              @ion-input="onEdit(i, $event)"
            />
            <ion-button
              slot="end"
              fill="clear"
              color="medium"
              aria-label="Delete reply"
              @click="remove(i)"
            >
              <ion-icon slot="icon-only" :icon="trashOutline" />
            </ion-button>
            <ion-reorder slot="end" />
          </ion-item>
        </ion-reorder-group>
      </ion-list>

      <ion-list :inset="true">
        <ion-item button :detail="false" @click="add">
          <ion-icon slot="start" :icon="addOutline" color="primary" />
          <ion-label color="primary">Add a reply</ion-label>
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-item button :detail="false" @click="reset">
          <ion-label color="danger">Reset to defaults</ion-label>
        </ion-item>
      </ion-list>

      <p class="hint">
        These appear when you decline an incoming call, so you can tell the caller why
        without picking up.
      </p>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonList, IonItem, IonInput, IonButton, IonIcon, IonLabel, IonReorderGroup, IonReorder,
} from '@ionic/vue';
import type { ItemReorderCustomEvent } from '@ionic/vue';
import { trashOutline, addOutline } from 'ionicons/icons';
import { getQuickDeclines, setQuickDeclines, DEFAULT_DECLINES } from '@/services/quick-declines';

const items = ref<string[]>([]);

onMounted(async () => {
  items.value = await getQuickDeclines();
});

// Persist on every change; the store trims empties, so a half-typed new row is kept
// on screen but not saved until it has text.
function persist(): void {
  void setQuickDeclines(items.value);
}

function onEdit(i: number, ev: CustomEvent): void {
  items.value[i] = (ev.detail as { value?: string | null }).value ?? '';
  persist();
}
function remove(i: number): void {
  items.value.splice(i, 1);
  persist();
}
function add(): void {
  items.value.push('');
}
function reset(): void {
  items.value = [...DEFAULT_DECLINES];
  persist();
}
function onReorder(ev: ItemReorderCustomEvent): void {
  items.value = ev.detail.complete(items.value) as string[];
  persist();
}
</script>

<style scoped>
.hint {
  margin: 4px 20px;
  font-size: 13px;
  color: var(--app-text-muted);
}
</style>
