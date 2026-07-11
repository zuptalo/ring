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
    :class="{ 'fgb-collapsed': collapsed }"
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
import { computed, onUnmounted, ref, watch } from 'vue';
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

// The pill covers a whole message-card width when it lingers over the chat, so it
// tucks itself into just the circular glyph after a moment (the label appears long
// enough to be learnable, then gets out of the way). It re-expands briefly when it
// (re)appears or when a new "your move" lands, so urgency still catches the eye.
const collapsed = ref(false);
let collapseTimer: ReturnType<typeof setTimeout> | null = null;
function expandBriefly(): void {
  collapsed.value = false;
  if (collapseTimer) clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => (collapsed.value = true), 2500);
}
watch(show, (on) => {
  if (on) expandBriefly();
  else if (collapseTimer) clearTimeout(collapseTimer);
}, { immediate: true });
watch(awaitingCount, (n, prev) => {
  if (show.value && n > (prev ?? 0)) expandBriefly();
});
onUnmounted(() => {
  if (collapseTimer) clearTimeout(collapseTimer);
});

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
  background: linear-gradient(135deg, #14b686, #0b7d5b);
  border: 1px solid rgba(110, 231, 183, 0.5);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
  cursor: grab;
  touch-action: none;
  max-width: 230px;
  transition: padding 0.25s ease, gap 0.25s ease;
}
/* Tucked away: just the circular glyph, hugging the left edge — the chat stays
   readable. The badge rides the circle's shoulder so urgency is still visible. */
.fgb-collapsed {
  padding: 6px;
  gap: 0;
}
.fgb-collapsed .fgb-text {
  max-width: 0;
  opacity: 0;
}
.fgb-collapsed .fgb-badge {
  position: absolute;
  top: -5px;
  right: -5px;
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
  max-width: 180px;
  transition: max-width 0.25s ease, opacity 0.2s ease;
}
.fgb-badge {
  flex: none;
  font-size: 11px;
  --padding-start: 6px;
  --padding-end: 6px;
}
</style>
