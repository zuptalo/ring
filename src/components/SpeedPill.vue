<template>
  <!-- Playback-speed toggle shared by every player. Tap to cycle 1× → 1.5× → 2×.
       Translucent so it reads on both dark (video/overlay) and light (bubble) media. -->
  <button
    type="button"
    class="speed-pill"
    :class="{ on: rate !== 1 }"
    :aria-label="`Playback speed ${label}`"
    @click.stop="$emit('cycle')"
  >
    {{ label }}
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { rateLabel } from '@/utils/playback';

const props = defineProps<{ rate: number }>();
defineEmits<{ (e: 'cycle'): void }>();
const label = computed(() => rateLabel(props.rate));
</script>

<style scoped>
.speed-pill {
  flex: none;
  min-width: 34px;
  height: 22px;
  padding: 0 7px;
  border: none;
  border-radius: 11px;
  background: rgba(127, 127, 127, 0.22);
  color: inherit;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.speed-pill.on {
  background: var(--ion-color-primary);
  color: #fff;
}
</style>
