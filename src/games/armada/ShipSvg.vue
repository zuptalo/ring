<template>
  <!-- Top-down warship silhouette (spec 1038; port of the handoff's parametric
       shipTopSVG). Drawn bow-to-right in an L×S box of INTERNAL units (cell 40,
       gap 4) and stretched to whatever cells the ship spans, so one drawing
       scales to any cell size. Vertical ships rotate the same drawing 90°. -->
  <svg
    :viewBox="vertical ? `0 0 ${S} ${L}` : `0 0 ${L} ${S}`"
    width="100%"
    height="100%"
    preserveAspectRatio="none"
    class="ship-svg"
    aria-hidden="true"
  >
    <g :transform="vertical ? `translate(${S} 0) rotate(90)` : undefined">
      <path :d="hull" :fill="pal.hull" :stroke="pal.stroke" :stroke-width="Math.max(0.6, S * 0.03)" />
      <template v-if="!wrecked">
        <!-- superstructure per class -->
        <template v-if="shipKey === 'carrier'">
          <line :x1="L * 0.06" :y1="cy" :x2="L * 0.94" :y2="cy" :stroke="pal.mark" :stroke-width="Math.max(0.7, S * 0.045)" :stroke-dasharray="`${S * 0.18} ${S * 0.14}`" />
          <rect :x="L * 0.56" :y="cy - S * 0.44" :width="L * 0.06" :height="S * 0.22" :rx="S * 0.03" :fill="pal.struct" />
          <rect :x="L * 0.2" :y="cy - S * 0.4" :width="L * 0.02" :height="S * 0.06" :fill="pal.mark" />
          <rect :x="L * 0.2" :y="cy + S * 0.34" :width="L * 0.02" :height="S * 0.06" :fill="pal.mark" />
        </template>
        <template v-else-if="shipKey === 'battleship'">
          <g v-for="t in [{ x: L * 0.2, d: 1 }, { x: L * 0.34, d: 1 }, { x: L * 0.82, d: -1 }]" :key="t.x">
            <rect :x="t.d > 0 ? t.x : t.x - S * 0.36" :y="cy - S * 0.124" :width="S * 0.36" :height="S * 0.064" :fill="pal.barrel" />
            <rect :x="t.d > 0 ? t.x : t.x - S * 0.36" :y="cy + S * 0.06" :width="S * 0.36" :height="S * 0.064" :fill="pal.barrel" />
            <circle :cx="t.x" :cy="cy" :r="S * 0.2" :fill="pal.struct" />
          </g>
          <rect :x="L * 0.46" :y="cy - S * 0.24" :width="L * 0.12" :height="S * 0.48" :rx="S * 0.08" :fill="pal.struct" />
          <circle :cx="L * 0.64" :cy="cy" :r="S * 0.11" :fill="pal.struct" />
        </template>
        <template v-else-if="shipKey === 'cruiser'">
          <g v-for="t in [{ x: L * 0.24, d: 1, r: S * 0.19 }, { x: L * 0.8, d: -1, r: S * 0.18 }]" :key="t.x">
            <rect :x="t.d > 0 ? t.x : t.x - t.r * 1.8" :y="cy - t.r * 0.62" :width="t.r * 1.8" :height="t.r * 0.32" :fill="pal.barrel" />
            <rect :x="t.d > 0 ? t.x : t.x - t.r * 1.8" :y="cy + t.r * 0.3" :width="t.r * 1.8" :height="t.r * 0.32" :fill="pal.barrel" />
            <circle :cx="t.x" :cy="cy" :r="t.r" :fill="pal.struct" />
          </g>
          <rect :x="L * 0.44" :y="cy - S * 0.2" :width="L * 0.12" :height="S * 0.4" :rx="S * 0.07" :fill="pal.struct" />
          <circle :cx="L * 0.62" :cy="cy" :r="S * 0.09" :fill="pal.struct" />
        </template>
        <template v-else-if="shipKey === 'submarine'">
          <rect :x="L * 0.4" :y="cy - S * 0.2" :width="L * 0.16" :height="S * 0.4" :rx="S * 0.1" :fill="pal.struct" />
          <line :x1="L * 0.48" :y1="cy" :x2="L * 0.6" :y2="cy" :stroke="pal.mark" :stroke-width="Math.max(0.6, S * 0.04)" />
        </template>
        <template v-else>
          <!-- destroyer -->
          <rect :x="L * 0.3" :y="cy - S * 0.104" :width="S * 0.306" :height="S * 0.054" :fill="pal.barrel" />
          <rect :x="L * 0.3" :y="cy + S * 0.051" :width="S * 0.306" :height="S * 0.054" :fill="pal.barrel" />
          <circle :cx="L * 0.3" :cy="cy" :r="S * 0.17" :fill="pal.struct" />
          <rect :x="L * 0.5" :y="cy - S * 0.16" :width="L * 0.14" :height="S * 0.32" :rx="S * 0.06" :fill="pal.struct" />
          <rect :x="L * 0.72" :y="cy - S * 0.1" :width="L * 0.05" :height="S * 0.2" :rx="S * 0.04" :fill="pal.struct" />
        </template>
        <!-- insignia: the class letter on a small disc at hull center -->
        <template v-if="insignia">
          <circle :cx="L * 0.5" :cy="cy" :r="S * 0.16" fill="rgba(8,16,12,0.55)" :stroke="pal.stroke" :stroke-width="Math.max(0.5, S * 0.02)" />
          <text :x="L * 0.5" :y="cy + S * 0.055" text-anchor="middle" :font-size="S * 0.19" font-weight="700" :fill="pal.mark" font-family="ui-monospace, monospace">{{ letter }}</text>
        </template>
      </template>
      <template v-else>
        <!-- wreckage: charred gashes + smouldering rim + central ember -->
        <path :d="`M ${L * 0.3} ${cy - S * 0.28} L ${L * 0.42} ${cy - S * 0.05} L ${L * 0.34} ${cy + S * 0.2} L ${L * 0.24} ${cy - S * 0.02} Z`" fill="rgba(0,0,0,0.55)" />
        <path :d="`M ${L * 0.58} ${cy + S * 0.26} L ${L * 0.68} ${cy - S * 0.02} L ${L * 0.6} ${cy - S * 0.24} L ${L * 0.52} ${cy + S * 0.04} Z`" fill="rgba(0,0,0,0.5)" />
        <line :x1="L * 0.14" :y1="cy - S * 0.05" :x2="L * 0.9" :y2="cy + S * 0.08" stroke="rgba(90,40,25,0.7)" :stroke-width="Math.max(0.6, S * 0.03)" />
        <circle :cx="L * 0.5" :cy="cy" :r="S * 0.06" fill="rgba(235,90,42,0.5)" />
      </template>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Ship class key ('carrier' | 'battleship' | 'cruiser' | 'submarine' | 'destroyer'). */
    shipKey: string;
    /** Hull length in cells. */
    len: number;
    vertical?: boolean;
    wrecked?: boolean;
    /** Show the class-letter insignia disc (afloat, own fleet). */
    insignia?: boolean;
  }>(),
  { vertical: false, wrecked: false, insignia: false },
);

// Internal drawing units — cell 40, gap 4 — stretched by preserveAspectRatio:none.
const U = 40;
const G = 4;
const S = U;
const L = computed(() => props.len * U + (props.len - 1) * G);
const cy = S / 2;
const letter = computed(() => (props.shipKey?.[0] ?? '?').toUpperCase());

const pal = computed(() => {
  const p = props.wrecked
    ? { hull: '#2c2723', stroke: 'rgba(150,74,48,0.65)', struct: '#3a322c', barrel: 'rgba(0,0,0,0.55)', mark: 'rgba(150,80,50,0.4)' }
    : { hull: '#40514a', stroke: 'rgba(110,231,183,0.55)', struct: '#6b8377', barrel: 'rgba(8,16,12,0.6)', mark: 'rgba(190,227,210,0.45)' };
  if (props.shipKey === 'submarine') p.hull = props.wrecked ? '#282320' : '#37463f';
  return p;
});

// Hull outlines per class (handoff geometry, verbatim proportions).
const hull = computed(() => {
  const l = L.value;
  if (props.shipKey === 'carrier') {
    const ty = S * 0.1;
    const by = S * 0.9;
    return `M ${l * 0.03} ${ty} L ${l * 0.8} ${ty} Q ${l * 0.97} ${S * 0.14} ${l - 0.5} ${cy} Q ${l * 0.97} ${S * 0.86} ${l * 0.8} ${by} L ${l * 0.03} ${by} Q ${l * 0.006} ${by} ${l * 0.006} ${S * 0.78} L ${l * 0.006} ${S * 0.22} Q ${l * 0.006} ${ty} ${l * 0.03} ${ty} Z`;
  }
  if (props.shipKey === 'submarine') {
    const ty = S * 0.28;
    const by = S - ty;
    return `M ${l * 0.5} ${ty} L ${l * 0.84} ${ty} Q ${l - 0.5} ${ty} ${l - 0.5} ${cy} Q ${l - 0.5} ${by} ${l * 0.84} ${by} L ${l * 0.16} ${by} Q ${0.5} ${by} ${0.5} ${cy} Q ${0.5} ${ty} ${l * 0.16} ${ty} Z`;
  }
  const ty = props.shipKey === 'destroyer' ? S * 0.24 : props.shipKey === 'cruiser' ? S * 0.2 : S * 0.16;
  const by = S - ty;
  return `M ${l * 0.05} ${ty} L ${l * 0.62} ${ty} Q ${l * 0.85} ${ty} ${l - 0.5} ${cy} Q ${l * 0.85} ${by} ${l * 0.62} ${by} L ${l * 0.05} ${by} Q ${0.5} ${by} ${0.5} ${S * 0.6} L ${0.5} ${S * 0.4} Q ${0.5} ${ty} ${l * 0.05} ${ty} Z`;
});
</script>

<style scoped>
.ship-svg {
  display: block;
}
</style>
