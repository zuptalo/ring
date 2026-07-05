<template>
  <!-- One player mark (spec 0008 FR-022/FR-023). Themed marks are emoji (picked
       from the animated set in docs/ANIMATED-EMOJI.md, so `animated` can pulse
       the latest move); the classic theme has no marks and renders the
       color-coded stroke SVG — identical geometry on every platform, which is
       why we never use the ✕/◯ TEXT glyphs (iOS font metrics mismatch). Sized
       by the surrounding font-size (1em box either way). -->
  <animated-emoji v-if="mark && animated" :emoji="mark" class="gm" />
  <span v-else-if="mark" class="gm gm-emoji" aria-hidden="true">{{ mark }}</span>
  <svg
    v-else
    class="gm gm-svg"
    :class="player === 0 ? 'x' : 'o'"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path v-if="player === 0" d="M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5" />
    <circle v-else cx="12" cy="12" r="6.5" />
  </svg>
</template>

<script setup lang="ts">
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';

defineProps<{
  /** The theme's emoji for this player; absent = classic SVG. */
  mark?: string;
  player: 0 | 1;
  /** Play the mark's animation (used for the most recently played cell). */
  animated?: boolean;
}>();
</script>

<style scoped>
.gm {
  display: inline-block;
  width: 1em;
  height: 1em;
  line-height: 1;
  vertical-align: -0.12em;
}
.gm-emoji {
  text-align: center;
}
.gm-svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.6;
  stroke-linecap: round;
}
.gm-svg.x {
  color: var(--ion-color-primary);
}
.gm-svg.o {
  color: var(--ion-color-secondary, var(--ion-color-tertiary));
}
</style>
