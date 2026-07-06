<template>
  <!-- The struck result medallion (spec 1033 handoff §Result overlay):
       gold for the winner's view, silver for the loss. heroPop entrance. -->
  <svg width="92" height="92" viewBox="0 0 32 32" class="medal" aria-hidden="true">
    <path d="M12 4 L12 8 M20 4 L20 8" :stroke="ring" stroke-width="2.4" stroke-linecap="round" />
    <circle cx="16" cy="18" r="12" :fill="fill" :stroke="ring" stroke-width="1.6" />
    <circle cx="16" cy="18" r="8.6" fill="none" :stroke="ring" stroke-width="0.9" opacity="0.55" />
    <svg x="8" y="10" width="16" height="16" viewBox="0 0 24 24">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" :fill="star" />
    </svg>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ kind: 'gold' | 'silver' }>();
const fill = computed(() => (props.kind === 'gold' ? '#f6c453' : '#d7dde3'));
const ring = computed(() => (props.kind === 'gold' ? '#c99a2e' : '#98a2ac'));
const star = computed(() => (props.kind === 'gold' ? '#fff8e6' : '#ffffff'));
</script>

<style scoped>
.medal {
  filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.45));
  animation: hero-pop 0.55s cubic-bezier(0.2, 1.3, 0.5, 1) both;
}
@keyframes hero-pop {
  0% { transform: scale(0.2) rotate(-14deg); opacity: 0; }
  55% { transform: scale(1.2) rotate(6deg); }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}
</style>
