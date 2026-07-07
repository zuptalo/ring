<template>
  <!-- The floating return-to-game button (spec 1038 FR-008). Shown whenever at
       least one ongoing fullscreen game holds a seat for this user and the
       overlay is closed — fully DERIVED from stored sessions, so it survives
       reloads and disappears on its own when the last game ends. Docked at the
       bottom-LEFT so it never collides with the minimized-call widget (right).
       Tap = open the most urgent game; drag = move it out of the way. -->
  <div
    v-if="show"
    class="fgb"
    :style="style"
    role="button"
    :aria-label="label"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <span class="fgb-glyph" aria-hidden="true">
      <ion-icon :icon="locateOutline" />
    </span>
    <span class="fgb-text">{{ games.length > 1 ? `Games ×${games.length}` : 'Back to the game' }}</span>
    <ion-badge v-if="awaitingCount > 0" class="fgb-badge" color="danger">{{ awaitingCount }}</ion-badge>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonBadge, IonIcon } from '@ionic/vue';
import { locateOutline } from 'ionicons/icons';
import { useOngoingGames } from '@/composables/useOngoingGames';
import { openGame, overlayOpen } from '@/composables/useGameOverlay';

const { games, awaitingCount } = useOngoingGames();

const show = computed(() => games.value.length > 0 && !overlayOpen.value);
const label = computed(() =>
  awaitingCount.value > 0
    ? `Back to your game, ${awaitingCount.value} awaiting your move`
    : 'Back to your game',
);

/* ---- free drag (tap = open the most urgent game); MinimizedCall pattern ---- */
const pos = ref<{ x: number; y: number } | null>(null);
const style = computed(() =>
  pos.value ? { left: `${pos.value.x}px`, top: `${pos.value.y}px`, right: 'auto', bottom: 'auto' } : {},
);
let down = false;
let moved = false;
let sx = 0;
let sy = 0;
let ox = 0;
let oy = 0;
function onDown(e: PointerEvent): void {
  down = true;
  moved = false;
  sx = e.clientX;
  sy = e.clientY;
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  ox = r.left;
  oy = r.top;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}
function onMove(e: PointerEvent): void {
  if (!down) return;
  const dx = e.clientX - sx;
  const dy = e.clientY - sy;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
  if (moved) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pos.value = {
      x: Math.min(Math.max(6, ox + dx), window.innerWidth - r.width - 6),
      y: Math.min(Math.max(6, oy + dy), window.innerHeight - r.height - 6),
    };
  }
}
function onUp(): void {
  // A tap (not a drag) re-enters the most urgent game: awaiting-you first,
  // newest activity breaking ties — the list arrives pre-sorted (D7).
  if (down && !moved) {
    const target = games.value[0];
    if (target) openGame(target.ref);
  }
  down = false;
  moved = false;
}
</script>

<style scoped>
.fgb {
  position: fixed;
  left: 12px;
  /* Default above the bottom tab bar; dragging overrides via inline left/top.
     Bottom-left dock: MinimizedCall owns the bottom-right corner. */
  bottom: calc(max(12px, env(safe-area-inset-bottom)) + 66px);
  z-index: 15000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px 8px 9px;
  border-radius: 28px;
  background: linear-gradient(135deg, #41537e, #2c3e70);
  border: 1px solid rgba(143, 174, 255, 0.5);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
  cursor: grab;
  touch-action: none;
  max-width: 230px;
}
.fgb-glyph {
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
}
.fgb-glyph ion-icon {
  font-size: 18px;
}
.fgb-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fgb-badge {
  flex: none;
  font-size: 11px;
  --padding-start: 6px;
  --padding-end: 6px;
}
</style>
