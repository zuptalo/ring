<template>
  <!-- The 3×3 board. Composed from ion-grid (no Ionic primitive is a game
       board — the Principle XI carve-out reasoned in the spec 0008 plan);
       cells are plain buttons styled with the existing theme tokens only.
       Direction-neutral by construction (a symmetric grid), so RTL is safe.

       Marks are stroke SVGs, NOT text glyphs: ✕/◯ come from platform fonts
       whose metrics differ wildly (they render at visibly mismatched sizes on
       iOS), while an SVG path is identical geometry everywhere (FR-019 fix). -->
  <div class="ttt-wrap">
    <ion-grid class="ttt" :class="{ frozen: !canMove }">
      <ion-row v-for="r in 3" :key="r">
        <ion-col v-for="c in 3" :key="c" class="ttt-cell-col">
          <button
            type="button"
            class="ttt-cell"
            :class="{ x: cellAt(r, c) === 0, o: cellAt(r, c) === 1 }"
            :disabled="!canMove || cellAt(r, c) !== null"
            :aria-label="cellLabel(r, c)"
            @click.stop="$emit('move', { cell: (r - 1) * 3 + (c - 1) })"
          >
            <svg v-if="cellAt(r, c) !== null" class="ttt-mark" viewBox="0 0 24 24" aria-hidden="true">
              <path v-if="cellAt(r, c) === 0" d="M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5" />
              <circle v-else cx="12" cy="12" r="6.5" />
            </svg>
          </button>
        </ion-col>
      </ion-row>
    </ion-grid>
    <!-- Who plays what (FR-019): your mark, in its board color, always visible. -->
    <div class="ttt-legend">
      <span>You play</span>
      <svg
        class="ttt-mark legend"
        :class="myPlayer === 0 ? 'x' : 'o'"
        viewBox="0 0 24 24"
        role="img"
        :aria-label="myPlayer === 0 ? 'cross' : 'circle'"
      >
        <path v-if="myPlayer === 0" d="M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5" />
        <circle v-else cx="12" cy="12" r="6.5" />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IonGrid, IonRow, IonCol } from '@ionic/vue';
import type { TicTacToeState } from './logic';

const props = defineProps<{
  state: TicTacToeState;
  /** This viewer's role (0 = starter/cross, 1 = circle) — drives the legend + a11y labels. */
  myPlayer: 0 | 1;
  /** Whether tapping an empty cell is allowed right now (your turn + ongoing). */
  canMove: boolean;
}>();
defineEmits<{ (e: 'move', move: { cell: number }): void }>();

const cellAt = (r: number, c: number): 0 | 1 | null => props.state.cells[(r - 1) * 3 + (c - 1)];
const cellLabel = (r: number, c: number): string => {
  const v = cellAt(r, c);
  const what = v === null ? 'empty' : v === props.myPlayer ? 'yours' : 'theirs';
  return `Row ${r}, column ${c}, ${what}`;
};
</script>

<style scoped>
.ttt-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ttt {
  padding: 0;
  width: 100%;
}
.ttt-cell-col {
  padding: 2px;
}
.ttt-cell {
  width: 100%;
  aspect-ratio: 1;
  border: none;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.06);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ion-color-primary);
  cursor: pointer;
}
.ttt-mark {
  width: 58%;
  height: 58%;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
}
.ttt-cell.o,
.ttt-mark.o {
  color: var(--ion-color-secondary, var(--ion-color-tertiary));
}
.ttt-mark.x {
  color: var(--ion-color-primary);
}
.ttt-cell:disabled {
  cursor: default;
}
.frozen .ttt-cell:not(.x):not(.o) {
  opacity: 0.6;
}
.ttt-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--app-text-muted);
}
.ttt-legend .ttt-mark {
  width: 13px;
  height: 13px;
  stroke-width: 3;
}
</style>
