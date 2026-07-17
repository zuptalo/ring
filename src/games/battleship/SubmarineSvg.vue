<template>
  <!-- One continuous submarine vessel (spec 1033 handoff §Submarine artwork).
       Drawn horizontally (bow to the right) in a len*100 × 100 space; vertical
       boats wrap the same art in translate(100,0) rotate(90). The gentle
       scale(1,1.14) around y=54 fattens the beam. `wreck` swaps in the sunken
       ghost: spectral hull, crack, breach, dead X eyes, rising bubbles. -->
  <svg
    :viewBox="vertical ? `0 0 100 ${W}` : `0 0 ${W} 100`"
    preserveAspectRatio="none"
    width="100%"
    height="100%"
    class="sub"
    :class="{ wreck, invalid }"
  >
    <g :transform="vertical ? 'translate(100,0) rotate(90)' : undefined">
      <g transform="translate(0,54) scale(1,1.14) translate(0,-54)">
        <template v-if="!wreck">
          <!-- stern shaft + rudder + propeller -->
          <line x1="4" y1="56" x2="13" y2="56" :stroke="C.dark" stroke-width="3" stroke-linecap="round" />
          <path d="M11 49 L5 46 L5 66 L11 63 Z" :fill="C.tower" :stroke="C.dark" stroke-width="1.2" stroke-linejoin="round" />
          <g transform="translate(5,56)">
            <ellipse cx="0" cy="0" rx="2" ry="6" :fill="C.prop" />
            <ellipse cx="0" cy="0" rx="6" ry="2" :fill="C.prop" />
            <circle cx="0" cy="0" r="1.7" :fill="C.dark" />
          </g>
          <!-- pressure hull -->
          <path :d="hullPath" :fill="C.hull" :stroke="C.dark" stroke-width="2.5" stroke-linejoin="round" />
          <path :d="`M16 49 Q${cx} 45.5 ${W - 18} 49`" fill="none" :stroke="C.hullHi" stroke-width="2.4" stroke-linecap="round" opacity="0.7" />
          <path :d="`M18 64 H${W - 20}`" fill="none" :stroke="C.hullLo" stroke-width="2.5" stroke-linecap="round" opacity="0.5" />
          <!-- bow dive plane -->
          <path :d="`M${W - 24} 60 L${W - 8} 63 L${W - 24} 66 Z`" :fill="C.tower" :stroke="C.dark" stroke-width="1" stroke-linejoin="round" />
          <!-- glowing portholes -->
          <circle v-for="lx in portholes" :key="lx" :cx="lx" cy="57" r="2" :fill="C.glow" opacity="0.9" />
          <!-- conning tower + light + periscope + antenna -->
          <path :d="`M${tx - 11} 44 V33 Q${tx - 11} 27 ${tx - 5} 27 H${tx + 7} Q${tx + 13} 27 ${tx + 13} 33 V44 Z`" :fill="C.tower" :stroke="C.dark" stroke-width="2" stroke-linejoin="round" />
          <line :x1="tx - 8" y1="31" :x2="tx + 9" y2="31" :stroke="C.trim" stroke-width="1.5" opacity="0.55" />
          <rect :x="tx - 2" y="35" width="4" height="4" rx="1" :fill="C.glow" opacity="0.85" />
          <line :x1="tx - 3" y1="27" :x2="tx - 3" y2="15" :stroke="C.dark" stroke-width="2" stroke-linecap="round" />
          <line :x1="tx - 4" y1="16" :x2="tx + 1" y2="16" :stroke="C.dark" stroke-width="2" stroke-linecap="round" />
          <line :x1="tx + 5" y1="27" :x2="tx + 5" y2="19" :stroke="C.trim" stroke-width="1.6" stroke-linecap="round" />
        </template>
        <template v-else>
          <!-- the broken, powerless wreck -->
          <path :d="ghostHull" :fill="G.g" :stroke="G.gd" stroke-width="2" stroke-linejoin="round" />
          <path :d="`M${cx - 9} 44 V34 Q${cx - 9} 30 ${cx - 4} 30 H${cx + 6} Q${cx + 10} 30 ${cx + 10} 34 V44 Z`" :fill="G.g" :stroke="G.gd" stroke-width="1.6" />
          <path :d="`M${cx - 20} 52 l7 4 l-4 4`" fill="none" :stroke="G.dk" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          <circle :cx="cx + W * 0.24" cy="58" r="3.5" :fill="G.dk" />
          <path :d="`M${cx - 5} 35 l4 4 M${cx - 1} 35 l-4 4`" stroke="#33414f" stroke-width="1.4" stroke-linecap="round" />
          <path :d="`M${cx + 2} 35 l4 4 M${cx + 6} 35 l-4 4`" stroke="#33414f" stroke-width="1.4" stroke-linecap="round" />
          <circle class="bub bub-a" :cx="cx - W * 0.2" cy="30" r="2.4" :fill="G.gd" />
          <circle class="bub bub-b" :cx="cx + W * 0.26" cy="26" r="1.9" :fill="G.gd" />
        </template>
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  len: number;
  vertical?: boolean;
  wreck?: boolean;
  invalid?: boolean;
}>();

// Palette from the handoff design tokens (fixed art colors, not themed).
const C = {
  hull: '#454f5a', hullHi: '#707b86', hullLo: '#262d34', dark: '#1a2026',
  tower: '#374049', trim: '#8b96a1', glow: '#7dd3fc', prop: '#c6a24a',
} as const;
const G = { g: 'rgba(200,214,226,0.58)', gd: 'rgba(255,255,255,0.55)', dk: 'rgba(6,12,20,0.32)' } as const;

const W = computed(() => props.len * 100);
const cx = computed(() => W.value * 0.5);
const tx = computed(() => cx.value - W.value * 0.05);
const hullPath = computed(
  () => `M18 43 H${W.value - 20} Q${W.value - 4} 43 ${W.value - 4} 56 Q${W.value - 4} 69 ${W.value - 20} 69 H18 Q8 69 8 56 Q8 43 18 43 Z`,
);
const ghostHull = computed(
  () => `M18 44 H${W.value - 20} Q${W.value - 5} 44 ${W.value - 5} 56 Q${W.value - 5} 68 ${W.value - 20} 68 H18 Q8 68 8 56 Q8 44 18 44 Z`,
);
const portholes = computed(() => {
  const lights = Math.max(2, props.len + 1);
  const out: number[] = [];
  for (let i = 0; i < lights; i++) {
    const lx = 24 + i * ((W.value - 48) / lights);
    if (Math.abs(lx - tx.value) < 12) continue;
    out.push(lx);
  }
  return out;
});
</script>

<style scoped>
.sub {
  display: block;
  overflow: visible;
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.28));
  animation: ship-in 0.4s ease both;
}
.sub.invalid {
  filter: drop-shadow(0 0 2px rgba(239, 68, 68, 0.95)) drop-shadow(0 0 3px rgba(239, 68, 68, 0.75));
}
.sub.wreck {
  animation: ghost-in 0.55s ease both;
}
.bub-a {
  animation: bob 2.4s ease-in-out infinite;
}
.bub-b {
  animation: bob 2.8s ease-in-out 0.5s infinite;
}
@keyframes ship-in {
  from { opacity: 0; transform: translateY(-2px) scale(0.94); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes ghost-in {
  0% { opacity: 0; transform: translateY(7px) scale(0.9) rotate(-3deg); }
  60% { opacity: 0.8; }
  100% { opacity: 1; transform: translateY(0) scale(1) rotate(-4deg); }
}
@keyframes bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2.5px); }
}
</style>
