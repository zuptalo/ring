<template>
  <!-- Cold-start launch reveal. Like KeyGuard / InstallGuard this overlays the
       (always-mounted) router outlet as an opaque ion-page and sits ABOVE both
       gates (z-index 40), so it's the very first thing seen on a fresh launch.
       It plays once, then fades out and unmounts, handing off to whatever is
       beneath (the passcode gate, the install gate, or a tab). The content uses
       the app background wash, so the hand-off is seamless — no flash (see the
       note in index.html about the launch screen → passcode gate transition). -->
  <ion-page v-if="visible" class="launch-reveal" :class="{ leaving }">
    <ion-content :fullscreen="true">
      <div class="rv-content" aria-hidden="true">
        <!-- Encrypted-glyph field: sealed ciphertext scatters, then converges
             into the mark. Anchored on the mark's center. -->
        <div class="rv-glyphs">
          <span
            v-for="(g, i) in GLYPHS"
            :key="i"
            class="rv-glyph"
            :style="{
              '--sx': g.sx + 'px', '--sy': g.sy + 'px',
              '--tx': g.tx + 'px', '--ty': g.ty + 'px',
              '--o': g.o,
              fontSize: g.size + 'px',
              animationDelay: g.d + 'ms',
            }"
          >{{ chars[i] }}</span>
        </div>

        <!-- The app icon (matches the brand block in InstallGuard / Auth). -->
        <div class="rv-tile">
          <svg class="rv-mark" viewBox="0 0 100 100">
            <!-- Shield outline drawn in white on the emerald tile, then filled. -->
            <path
              class="rv-shield-stroke"
              d="M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z"
              pathLength="100" fill="none" stroke="#fff" stroke-width="3"
              stroke-linejoin="round" stroke-linecap="round"
            />
            <path
              class="rv-shield-fill"
              d="M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z"
              fill="#fff"
            />
            <!-- The ring: a combination dial that spins, then clicks shut. -->
            <circle class="rv-pulse" cx="50" cy="49" r="18" fill="none" stroke="var(--ion-color-primary)" stroke-width="2" />
            <circle class="rv-ring-dial" cx="50" cy="49" r="18" fill="none" stroke="var(--ion-color-primary)" stroke-width="7" stroke-dasharray="6 7" stroke-linecap="round" />
            <circle class="rv-ring-solid" cx="50" cy="49" r="18" fill="none" stroke="var(--ion-color-primary)" stroke-width="7" />
          </svg>
        </div>

        <!-- Wordmark. -->
        <div class="rv-word">
          <div class="rv-name">Ring</div>
          <div class="rv-tag">Private, end-to-end encrypted</div>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';

// Set true to only play inside the installed PWA (skips it in a plain browser
// tab / dev server). Left false so it's visible during local development too.
const STANDALONE_ONLY = false;

// Each glyph's scatter start (sx,sy) and convergence target (tx,ty) as pixel
// offsets from the mark's center, plus its opacity, size, and stagger delay.
const GLYPHS = [
  { sx: -220, sy: -120, tx: -38, ty: -70, o: 0.5, size: 13, d: 0 },
  { sx: 210, sy: -150, tx: 42, ty: -60, o: 0.45, size: 14, d: 40 },
  { sx: -180, sy: 160, tx: -30, ty: 72, o: 0.5, size: 13, d: 20 },
  { sx: 190, sy: 180, tx: 40, ty: 66, o: 0.4, size: 15, d: 60 },
  { sx: -10, sy: -260, tx: 0, ty: -78, o: 0.55, size: 14, d: 0 },
  { sx: -250, sy: 20, tx: -46, ty: -10, o: 0.5, size: 12, d: 50 },
  { sx: 250, sy: 30, tx: 48, ty: -8, o: 0.45, size: 13, d: 30 },
  { sx: -120, sy: 250, tx: -30, ty: 76, o: 0.4, size: 14, d: 70 },
  { sx: 130, sy: 250, tx: 36, ty: 74, o: 0.5, size: 13, d: 10 },
  { sx: -230, sy: 110, tx: -44, ty: 38, o: 0.45, size: 12, d: 50 },
  { sx: 240, sy: -90, tx: 46, ty: -30, o: 0.5, size: 15, d: 20 },
  { sx: -60, sy: -200, tx: -18, ty: -72, o: 0.4, size: 13, d: 60 },
  { sx: 70, sy: -230, tx: 22, ty: -76, o: 0.5, size: 14, d: 0 },
  { sx: -200, sy: -50, tx: -40, ty: -24, o: 0.45, size: 13, d: 40 },
  { sx: 205, sy: 120, tx: 44, ty: 40, o: 0.5, size: 12, d: 30 },
  { sx: -90, sy: 210, tx: -30, ty: 62, o: 0.4, size: 14, d: 70 },
  { sx: 120, sy: 200, tx: 36, ty: 60, o: 0.5, size: 13, d: 20 },
  { sx: 10, sy: 270, tx: 0, ty: 78, o: 0.45, size: 15, d: 50 },
  { sx: -150, sy: -160, tx: -34, ty: -64, o: 0.5, size: 12, d: 10 },
  { sx: 160, sy: -180, tx: 42, ty: -62, o: 0.4, size: 13, d: 60 },
  { sx: 40, sy: 250, tx: 20, ty: 76, o: 0.5, size: 14, d: 30 },
  { sx: -110, sy: 130, tx: -30, ty: 44, o: 0.45, size: 12, d: 20 },
];

const CHARSET = '0123456789ABCDEF#<>*/{}=+';
const randChar = (): string => CHARSET[(Math.random() * CHARSET.length) | 0];

const chars = ref<string[]>(GLYPHS.map(randChar));

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const standalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

// Automation (Playwright e2e, the drive harness) loads hundreds of pages; a
// 2.7s opaque overlay on each would slow the suite and block UI clicks. Real
// browsers never set navigator.webdriver. `?launch-reveal` forces it back on
// for visual previews under automation.
const automated = (navigator as unknown as { webdriver?: boolean }).webdriver === true;
const forced = window.location.search.includes('launch-reveal');

const visible = ref(forced || (!automated && (STANDALONE_ONLY ? standalone : true)));
const leaving = ref(false);

let cyc: number | undefined;

onMounted(() => {
  if (!visible.value) return;

  // Cycle the glyph characters while they scatter/converge, then freeze.
  if (!reduce) {
    cyc = window.setInterval(() => {
      chars.value = GLYPHS.map(randChar);
    }, 70);
    window.setTimeout(() => {
      if (cyc) clearInterval(cyc);
    }, 1500);
  }

  // Play once, then fade out and unmount so the app takes over.
  const REVEAL_MS = reduce ? 500 : 2350;
  const FADE_MS = 350;
  window.setTimeout(() => {
    leaving.value = true;
  }, REVEAL_MS);
  window.setTimeout(() => {
    visible.value = false;
  }, REVEAL_MS + FADE_MS);
});

onUnmounted(() => {
  if (cyc) clearInterval(cyc);
});
</script>

<style scoped>
/* Overlay everything, including both gates (KeyGuard z-20, InstallGuard z-30). */
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

/* Zero-size anchor at the mark's center; glyph children position against it. */
.rv-glyphs {
  position: absolute;
  left: 50%;
  top: 50%;
}
.rv-glyph {
  position: absolute;
  left: 0;
  top: 0;
  color: var(--ion-color-primary);
  font-family: ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace;
  font-weight: 600;
  opacity: 0;
  text-shadow: 0 0 8px color-mix(in srgb, var(--ion-color-primary) 55%, transparent);
  will-change: transform, opacity;
  animation: rv-glyph 1.5s ease-in-out both;
}

/* App icon tile — the InstallGuard/Auth brand block. */
.rv-tile {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 84px;
  height: 84px;
  border-radius: 24px;
  background: var(--ion-color-primary);
  box-shadow: 0 14px 34px rgba(16, 185, 129, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%) scale(0);
  animation: rv-iris 0.64s cubic-bezier(0.34, 1.56, 0.64, 1) 0.62s both;
}
.rv-mark {
  width: 64px;
  height: 64px;
  overflow: visible;
}
.rv-shield-stroke {
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: rv-draw 0.55s cubic-bezier(0.4, 0, 0.2, 1) 0.9s both,
             rv-sfade 0.3s ease 1.5s both;
}
.rv-shield-fill {
  clip-path: inset(100% 0 0 0);
  animation: rv-fill 0.55s cubic-bezier(0.4, 0, 0.2, 1) 1.35s both;
}
.rv-pulse {
  transform-box: fill-box;
  transform-origin: center;
  opacity: 0;
  animation: rv-pulse 0.7s ease-out 2.02s both;
}
.rv-ring-dial {
  transform-box: fill-box;
  transform-origin: center;
  opacity: 0;
  animation: rv-dial 0.9s cubic-bezier(0.16, 1, 0.3, 1) 1.15s both;
}
.rv-ring-solid {
  transform-box: fill-box;
  transform-origin: center;
  opacity: 0;
  animation: rv-solid 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) 2.02s both;
}

/* Wordmark, centered below the tile. */
.rv-word {
  position: absolute;
  left: 50%;
  top: calc(50% + 68px);
  transform: translateX(-50%);
  text-align: center;
  width: max-content;
}
.rv-name {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--app-text);
  opacity: 0;
  animation: rv-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) 1.9s both;
}
.rv-tag {
  margin-top: 8px;
  font-size: 14px;
  color: var(--app-text-muted);
  opacity: 0;
  animation: rv-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) 2.05s both;
}

@keyframes rv-glyph {
  0% { opacity: 0; transform: translate(calc(-50% + var(--sx)), calc(-50% + var(--sy))); }
  12% { opacity: var(--o); }
  40% { opacity: var(--o); transform: translate(calc(-50% + var(--sx)), calc(-50% + var(--sy))); }
  88% { opacity: 0; transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))); }
}
@keyframes rv-iris { from { transform: translate(-50%, -50%) scale(0); } to { transform: translate(-50%, -50%) scale(1); } }
@keyframes rv-draw { to { stroke-dashoffset: 0; } }
@keyframes rv-sfade { to { opacity: 0; } }
@keyframes rv-fill { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes rv-dial {
  0% { opacity: 0; transform: rotate(0deg); }
  12% { opacity: 1; }
  88% { opacity: 1; transform: rotate(800deg); }
  100% { opacity: 0; transform: rotate(812deg); }
}
@keyframes rv-solid {
  0% { opacity: 0; transform: scale(0.55); }
  60% { opacity: 1; transform: scale(1.16); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes rv-pulse {
  0% { opacity: 0; transform: scale(1); }
  8% { opacity: 0.55; }
  100% { opacity: 0; transform: scale(2.4); }
}
@keyframes rv-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Respect reduced motion: skip the choreography, just settle and hand off. */
@media (prefers-reduced-motion: reduce) {
  .rv-glyph { display: none; }
  .rv-tile,
  .rv-shield-stroke,
  .rv-shield-fill,
  .rv-ring-dial,
  .rv-ring-solid,
  .rv-pulse,
  .rv-name,
  .rv-tag {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
  }
}
</style>
