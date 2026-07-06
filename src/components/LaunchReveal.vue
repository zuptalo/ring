<template>
  <!-- Cold-start reveal, shown on first install and after each update. Overlays
       the (always-mounted) router outlet as an opaque ion-page above both gates
       (z-index 40), plays once, then fades out and unmounts — handing off to the
       passcode gate / install gate / tab beneath. A single white silhouette
       inside the app tile morphs through a symbol for each feature (messaging →
       voice → video → group → wall & games) and resolves into the Ring mark,
       name, purpose, and the running version.

       Drop-in replacement for the previous LaunchReveal.vue: same component name,
       same App.vue slot, same version + show-once-per-version wiring. Requires
       flubber for path morphing:  npm i flubber
       and an ambient declaration (flubber ships no types) — add to
       src/vite-env.d.ts:  declare module 'flubber'; -->
  <ion-page v-if="visible" class="launch-reveal" :class="{ leaving }">
    <ion-content :fullscreen="true">
      <div class="rv-content" aria-hidden="true">
        <!-- ambient glow -->
        <div class="rv-glow" :style="{ opacity: 0.5 + 0.5 * glowPulse }"></div>

        <!-- app tile with the morphing silhouette -->
        <div class="rv-tile" :style="{ transform: `translate(-50%, -50%) scale(${f.breathe})` }">
          <svg :width="MARK" :height="MARK" viewBox="0 0 100 100" style="display:block; overflow:visible">
            <path :d="f.d" fill="#fff" />

            <!-- gamepad detail: visible only while the controller is held -->
            <g v-if="f.detailOp > 0" :style="{ opacity: f.detailOp }">
              <rect x="17" y="53.5" width="19" height="7" rx="2.2" :fill="PRIMARY" />
              <rect x="23" y="47.5" width="7" height="19" rx="2.2" :fill="PRIMARY" />
              <circle cx="72" cy="50" r="3.1" :fill="PRIMARY" />
              <circle cx="64.5" cy="57" r="3.1" :fill="PRIMARY" />
              <circle cx="79.5" cy="57" r="3.1" :fill="PRIMARY" />
              <circle cx="72" cy="64" r="3.1" :fill="PRIMARY" />
              <circle cx="50" cy="64" r="7" :fill="PRIMARY" />
              <circle cx="50" cy="64" r="3.2" fill="#fff" />
            </g>

            <!-- finale: the ring spins in and clicks shut -->
            <template v-if="f.finale">
              <circle v-if="f.pulseOp > 0" :cx="RING.cx" :cy="RING.cy" :r="f.pulseR" fill="none" :stroke="PRIMARY" stroke-width="1.6" :style="{ opacity: f.pulseOp }" />
              <g :transform="f.ringTransform" :style="{ opacity: f.ringOp }">
                <circle :cx="RING.cx" :cy="RING.cy" :r="RING.r" fill="none" :stroke="PRIMARY" :stroke-width="f.rsw" stroke-linecap="round" :stroke-dasharray="f.solid ? undefined : '5 6'" />
              </g>
            </template>
          </svg>
        </div>

        <!-- caption: feature label during the montage; name/purpose/version at the end -->
        <div class="rv-word">
          <div v-if="!f.finale" class="rv-feature" :style="{ opacity: f.labelOp }">{{ f.label }}</div>
          <template v-else>
            <div class="rv-name" :style="{ opacity: f.w1, transform: `translateY(${(1 - f.w1) * 14}px)` }">Ring</div>
            <div class="rv-tag" :style="{ opacity: f.w2, transform: `translateY(${(1 - f.w2) * 10}px)` }">Private, end-to-end encrypted</div>
            <div class="rv-version" :style="{ opacity: f.w3 }">v{{ version }}</div>
          </template>
        </div>

        <!-- through-line pill -->
        <div class="rv-pill" :style="{ opacity: f.pillOp }">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M6 11h12v9a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" :stroke="PRIMARY" stroke-width="2.2" stroke-linejoin="round" />
            <path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11" :stroke="PRIMARY" stroke-width="2.2" stroke-linecap="round" />
          </svg>
          <span>All inside Ring</span>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import { interpolate, separate, combine } from 'flubber';

const PRIMARY = 'var(--ion-color-primary)';
const MARK = 84; // px, the morphing symbol inside the 128px tile

// ── single-outline silhouettes (viewBox 100, no arcs so flubber parses cleanly) ──
const BUBBLE = 'M28 22 L72 22 C77.5 22 82 26.5 82 32 L82 58 C82 63.5 77.5 68 72 68 L44 68 L30 82 L30 68 L28 68 C22.5 68 18 63.5 18 58 L18 32 C18 26.5 22.5 22 28 22 Z';
const HANDSET = 'M32 20 C40 18 46 24 48 32 L50 44 C48 47 45 49 42 50 C48 60 54 66 64 72 C65 69 67 66 70 64 L82 66 C90 68 94 76 90 84 C84 94 70 95 60 90 C38 80 22 60 16 36 C14 27 22 20 32 20 Z';
const CAMERA = 'M24 36 L56 36 C60.4 36 64 39.6 64 44 L64 47 L84 35 L84 77 L64 65 L64 68 C64 72.4 60.4 76 56 76 L24 76 C19.6 76 16 72.4 16 68 L16 44 C16 39.6 19.6 36 24 36 Z';
const CONTROLLER = 'M34 38 L66 38 C78 38 87 47 90 59 L93 73 C95 82 86 87 79 83 L71 75 L29 75 L21 83 C14 87 5 82 7 73 L10 59 C13 47 22 38 34 38 Z';
// Shield pre-transformed to the favicon's inner placement (translate 8.98,8.16 · scale 0.82).
const SHIELD = 'M49.98 14.72 L81.14 25.38 L81.14 50.8 C81.14 67.2 68.02 79.5 49.98 85.24 C31.94 79.5 18.82 67.2 18.82 50.8 L18.82 25.38 Z';
const RING = { cx: 49.98, cy: 48.34, r: 14.76, sw: 5.74 };

function circlePts(cx: number, cy: number, r: number, n = 34): [number, number][] {
  return Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number]; });
}
const CIRCLES = [circlePts(32, 39, 12), circlePts(68, 39, 12), circlePts(32, 71, 12), circlePts(68, 71, 12)];

// ── flubber interpolators (built once) ───────────────────────────────────────
const O = { maxSegmentLength: 3 };
const I = {
  a: interpolate(BUBBLE, HANDSET, O),
  b: interpolate(HANDSET, CAMERA, O),
  c: separate(CAMERA, CIRCLES, { single: true, ...O }),
  d: combine(CIRCLES, CONTROLLER, { single: true, ...O }),
  e: interpolate(CONTROLLER, SHIELD, O),
} as Record<string, (t: number) => string>;

// ── timeline ─────────────────────────────────────────────────────────────────
const H = 1.05, M = 0.68, FINALE_DUR = 3.6;
type Seg = { kind: 'hold'; shape: string; label: string; t0: number; t1: number } | { kind: 'morph'; key: string; t0: number; t1: number };
const SEG: Seg[] = [];
let cur = 0;
const hold = (shape: string, label: string) => { SEG.push({ kind: 'hold', shape, label, t0: cur, t1: cur + H }); cur += H; };
const morph = (key: string) => { SEG.push({ kind: 'morph', key, t0: cur, t1: cur + M }); cur += M; };
hold('bubble', 'Messaging'); morph('a');
hold('handset', 'Voice calls'); morph('b');
hold('camera', 'Video calls'); morph('c');
hold('group', 'Group calls'); morph('d');
hold('controller', 'Wall & games'); morph('e');
const FINALE_START = cur;
const TOTAL = FINALE_START + FINALE_DUR;

// ── easing ───────────────────────────────────────────────────────────────────
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

const holdD = (shape: string): string => {
  switch (shape) {
    case 'bubble': return BUBBLE;
    case 'handset': return HANDSET;
    case 'camera': return CAMERA;
    case 'group': return I.c(1);
    case 'controller': return CONTROLLER;
    default: return SHIELD;
  }
};

// ── per-frame state ──────────────────────────────────────────────────────────
const t = ref(0);
const glowPulse = computed(() => Math.sin(t.value * 1.8) * 0.5 + 0.5);

const f = computed(() => {
  const tv = t.value;
  const inFinale = tv >= FINALE_START;
  let d = SHIELD, label = '', labelOp = 1, detailOp = 0;

  if (!inFinale) {
    const seg = SEG.find((s) => tv >= s.t0 && tv < s.t1) || SEG[SEG.length - 1];
    if (seg.kind === 'hold') {
      d = holdD(seg.shape);
      label = seg.label;
      labelOp = 1;
      if (seg.shape === 'controller') detailOp = 1;
    } else {
      const dur = seg.t1 - seg.t0;
      const tt = easeInOutCubic(clamp((tv - seg.t0) / dur, 0, 1));
      d = I[seg.key](tt);
      const half = (tv - seg.t0) / dur;
      const i = SEG.indexOf(seg);
      const prev = SEG[i - 1] as Seg | undefined;
      const next = SEG[i + 1] as Seg | undefined;
      label = half < 0.5 ? (prev && prev.kind === 'hold' ? prev.label : '') : (next && next.kind === 'hold' ? next.label : '');
      labelOp = Math.abs(half - 0.5) * 2;
      if (seg.key === 'd') detailOp = clamp((half - 0.6) / 0.4, 0, 1);
      if (seg.key === 'e') detailOp = clamp(1 - half / 0.4, 0, 1);
    }
  }

  // finale ring assembly
  const fl = tv - FINALE_START;
  const ringStart = 0.35, spinEnd = 1.25;
  const ringOp = inFinale ? clamp((fl - ringStart) / 0.28, 0, 1) : 0;
  const spinP = clamp((fl - ringStart) / (spinEnd - ringStart), 0, 1);
  const rot = easeOutQuart(spinP) * 812;
  const solid = fl >= spinEnd;
  const rsw = 1.6 + (RING.sw - 1.6) * easeOutCubic(clamp((fl - ringStart) / 0.35, 0, 1));
  const clickP = clamp((fl - spinEnd) / 0.14, 0, 1);
  const ringScale = clickP > 0 && clickP < 1 ? 1 + Math.sin(clickP * Math.PI) * 0.14 : 1;
  const pulseP = clamp((fl - spinEnd) / 0.7, 0, 1);
  const pulseR = RING.r + 28 * easeOutCubic(pulseP);
  const pulseOp = inFinale && pulseP > 0 && pulseP < 1 ? 0.55 * (1 - pulseP) : 0;
  const ringTransform = `translate(${RING.cx} ${RING.cy}) scale(${ringScale}) translate(${-RING.cx} ${-RING.cy}) rotate(${rot} ${RING.cx} ${RING.cy})`;

  return {
    d, finale: inFinale, label, labelOp, detailOp,
    ringOp, rot, solid, rsw, ringScale, pulseR, pulseOp, ringTransform,
    w1: inFinale ? easeOutCubic(clamp((fl - 1.7) / 0.6, 0, 1)) : 0,
    w2: inFinale ? easeOutCubic(clamp((fl - 1.95) / 0.6, 0, 1)) : 0,
    w3: inFinale ? easeOutCubic(clamp((fl - 2.2) / 0.6, 0, 1)) : 0,
    pillOp: inFinale ? clamp(1 - fl / 0.6, 0, 1) : clamp((tv - 0.3) / 0.5, 0, 1),
    breathe: 1 + Math.sin(tv * 1.8) * 0.008,
  };
});

// ── show-once-per-version wiring (identical to the previous LaunchReveal) ─────
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const automated = (navigator as unknown as { webdriver?: boolean }).webdriver === true;
const forced = window.location.search.includes('launch-reveal');

const version = __APP_VERSION__;
const REVEAL_SEEN_KEY = 'ring.revealSeenVersion';
const isNewVersion = ((): boolean => {
  try { return localStorage.getItem(REVEAL_SEEN_KEY) !== version; } catch { return true; }
})();

const visible = ref(forced || (isNewVersion && !automated));
const leaving = ref(false);

let raf: number | undefined;
let startTs: number | undefined;
let done = false;

function beginExit(): void {
  if (done) return;
  done = true;
  window.setTimeout(() => { leaving.value = true; }, 0);
  window.setTimeout(() => { visible.value = false; }, 350);
}

onMounted(() => {
  if (!visible.value) return;
  // Mark this version revealed immediately, so an interrupted launch doesn't replay forever.
  try { localStorage.setItem(REVEAL_SEEN_KEY, version); } catch { /* private-mode: may replay */ }

  if (reduce) {
    // Skip the montage; hold the final logo + version briefly, then hand off.
    t.value = TOTAL;
    window.setTimeout(beginExit, 900);
    return;
  }

  const loop = (now: number): void => {
    if (startTs === undefined) startTs = now;
    const elapsed = (now - startTs) / 1000;
    if (elapsed >= TOTAL) {
      t.value = TOTAL;
      beginExit();
      return;
    }
    t.value = elapsed;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
});

onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf);
});
</script>

<style scoped>
.launch-reveal {
  z-index: 40;
  opacity: 1;
  transition: opacity 350ms ease;
}
.launch-reveal.leaving {
  opacity: 0;
  pointer-events: none;
}
.rv-content {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.rv-glow {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 300px;
  height: 300px;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(16, 185, 129, 0.3), rgba(16, 185, 129, 0) 62%);
  filter: blur(6px);
  pointer-events: none;
}
.rv-tile {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 128px;
  height: 128px;
  border-radius: 30px;
  background: var(--ion-color-primary);
  box-shadow: 0 16px 40px rgba(16, 185, 129, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
}
.rv-word {
  position: absolute;
  left: 50%;
  top: calc(50% + 96px);
  transform: translateX(-50%);
  text-align: center;
  width: max-content;
}
.rv-feature {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--app-text);
}
.rv-name {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--app-text);
}
.rv-tag {
  margin-top: 8px;
  font-size: 14px;
  color: var(--app-text-muted);
}
.rv-version {
  margin-top: 10px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--app-text-muted) 75%, transparent);
}
.rv-pill {
  position: absolute;
  left: 50%;
  top: calc(50% - 150px);
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.4);
  white-space: nowrap;
}
.rv-pill span {
  font-family: ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--ion-color-primary) 78%, #fff);
}
</style>
