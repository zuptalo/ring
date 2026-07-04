<template>
  <!-- The 3×3 board. Composed from ion-grid (no Ionic primitive is a game
       board — the Principle XI carve-out reasoned in the spec 0008 plan);
       cells are plain buttons styled with the existing theme tokens only.
       Direction-neutral by construction (a symmetric grid), so RTL is safe. -->
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
          {{ cellAt(r, c) === 0 ? '✕' : cellAt(r, c) === 1 ? '◯' : '' }}
        </button>
      </ion-col>
    </ion-row>
  </ion-grid>
</template>

<script setup lang="ts">
import { IonGrid, IonRow, IonCol } from '@ionic/vue';
import type { TicTacToeState } from './logic';

const props = defineProps<{
  state: TicTacToeState;
  /** This viewer's role (0 = starter/✕, 1 = ◯) — labels cells for a11y. */
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
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
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
