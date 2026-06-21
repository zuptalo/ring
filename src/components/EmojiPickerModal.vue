<template>
  <ion-content class="emoji-picker-modal">
    <div ref="host" class="picker-host"></div>
  </ion-content>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { IonContent, modalController } from '@ionic/vue';

/**
 * The full emoji picker (the same `emoji-picker-element` web component the chat uses),
 * wrapped in a sheet so the Wall can reuse it. Dismisses with `{ emoji }` on pick.
 */
const host = ref<HTMLElement | null>(null);
let el: HTMLElement | null = null;

function onPick(ev: Event): void {
  const emoji = (ev as CustomEvent<{ unicode?: string }>).detail?.unicode;
  void modalController.dismiss(emoji ? { emoji } : undefined);
}

onMounted(async () => {
  await import('emoji-picker-element');
  el = document.createElement('emoji-picker');
  el.addEventListener('emoji-click', onPick as EventListener);
  host.value?.appendChild(el);
});

onBeforeUnmount(() => {
  el?.removeEventListener('emoji-click', onPick as EventListener);
  el?.remove();
  el = null;
});
</script>

<style scoped>
.emoji-picker-modal {
  --background: transparent;
}
.picker-host {
  display: flex;
  justify-content: center;
  padding: 8px;
}
.picker-host :deep(emoji-picker) {
  width: 100%;
  max-width: 420px;
  height: 100%;
}
</style>
