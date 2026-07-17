<template>
  <!-- The 3×3 board. Composed from ion-grid (no Ionic primitive is a game
       board — the Principle XI carve-out reasoned in the spec 0008 plan);
       cells are plain buttons styled with the existing theme tokens plus an
       optional soft per-theme accent tint. Direction-neutral by construction
       (a symmetric grid), so RTL is safe.

       Marks render through GameMark: themed emoji (the most recently played
       cell ANIMATES to draw the eye, FR-023) or the classic color-coded SVG. -->
  <ion-grid
    class="ttt"
    :class="{ frozen: !canMove }"
    :style="accent ? { '--game-accent': accent, '--game-accent-a': '0.12' } : undefined"
  >
    <ion-row v-for="r in 3" :key="r">
      <ion-col v-for="c in 3" :key="c" class="ttt-cell-col">
        <button
          type="button"
          class="ttt-cell"
          :class="{ x: cellAt(r, c) === 0, o: cellAt(r, c) === 1 }"
          :disabled="!canMove || cellAt(r, c) !== null"
          :aria-label="cellLabel(r, c)"
          @click.stop="$emit('move', { cell: idx(r, c) })"
        >
          <game-mark
            v-if="cellAt(r, c) !== null"
            :mark="marks?.[cellAt(r, c)!]"
            :player="cellAt(r, c)!"
            :animated="idx(r, c) === lastMove?.cell"
          />
        </button>
      </ion-col>
    </ion-row>
  </ion-grid>
</template>

<script setup lang="ts">
import { IonGrid, IonRow, IonCol } from '@ionic/vue';
import GameMark from '@/components/GameMark.vue';
import type { TicTacToeState, TicTacToeMove } from './logic';

const props = defineProps<{
  state: TicTacToeState;
  /** This viewer's role (0 = starter, moves first) — drives the a11y labels. */
  myPlayer: 0 | 1;
  /** Whether tapping an empty cell is allowed right now (your turn + ongoing). */
  canMove: boolean;
  /** The theme's [player 0, player 1] emoji marks; absent = classic SVG X/O. */
  marks?: [string, string];
  /** Soft board tint as an "r, g, b" triplet (from the theme). */
  accent?: string;
  /** The most recently played move — its cell animates (FR-023). */
  lastMove?: TicTacToeMove | null;
}>();
defineEmits<{ (e: 'move', move: TicTacToeMove): void }>();

const idx = (r: number, c: number): number => (r - 1) * 3 + (c - 1);
const cellAt = (r: number, c: number): 0 | 1 | null => props.state.cells[idx(r, c)];
const cellLabel = (r: number, c: number): string => {
  const v = cellAt(r, c);
  const what = v === null ? 'empty' : v === props.myPlayer ? 'yours' : 'theirs';
  return `Row ${r}, column ${c}, ${what}`;
};
</script>

<style scoped>
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
  background: rgba(var(--game-accent, 0, 0, 0), var(--game-accent-a, 0.06));
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: var(--ion-color-primary);
  cursor: pointer;
}
.ttt-cell.o {
  color: var(--ion-color-secondary, var(--ion-color-tertiary));
}
.ttt-cell:disabled {
  cursor: default;
}
.frozen .ttt-cell:not(.x):not(.o) {
  opacity: 0.6;
}
</style>
