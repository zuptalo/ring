<template>
  <!-- The 7×6 Connect Four board (spec 0010). Same construction reasoning as
       TicTacToeBoard (ion-grid + plain buttons, Principle XI carve-out), but
       input is per COLUMN: every slot in a column is one drop target, so the
       effective tap target is the full column height even though single slots
       are small. Row 0 renders at the top; discs live in the lowest free
       slots, exactly as the pure state lays them out. -->
  <ion-grid
    class="c4"
    :class="{ frozen: !canMove }"
    :style="accent ? { '--game-accent': accent, '--game-accent-a': '0.14' } : undefined"
  >
    <ion-row v-for="r in ROWS" :key="r">
      <ion-col v-for="c in COLS" :key="c" class="c4-slot-col">
        <button
          type="button"
          class="c4-slot"
          :disabled="!canMove || colFull(c - 1)"
          :aria-label="slotLabel(r - 1, c - 1)"
          @click.stop="$emit('move', { col: c - 1 })"
        >
          <game-mark
            v-if="cellAt(r - 1, c - 1) !== null"
            :mark="marks?.[cellAt(r - 1, c - 1)!]"
            :player="cellAt(r - 1, c - 1)!"
            :animated="isLastDrop(r - 1, c - 1)"
            class="c4-disc"
          />
        </button>
      </ion-col>
    </ion-row>
  </ion-grid>
</template>

<script setup lang="ts">
import { IonGrid, IonRow, IonCol } from '@ionic/vue';
import GameMark from '@/components/GameMark.vue';
import { COLS, ROWS, type C4Move, type C4State } from './logic';

const props = defineProps<{
  state: C4State;
  /** This viewer's role (0 = starter, moves first) — drives the a11y labels. */
  myPlayer: 0 | 1;
  /** Whether dropping a disc is allowed right now (your turn + ongoing). */
  canMove: boolean;
  /** The theme's [player 0, player 1] marks. */
  marks?: [string, string];
  /** Soft board tint as an "r, g, b" triplet (from the theme). */
  accent?: string;
  /** The most recently played move — its landed disc animates (FR-023). */
  lastMove?: C4Move | null;
}>();
defineEmits<{ (e: 'move', move: C4Move): void }>();

const cellAt = (r: number, c: number): 0 | 1 | null => props.state.cells[r * COLS + c];
const colFull = (c: number): boolean => props.state.cells[c] !== null; // row 0 = top
// The last drop is the TOPMOST disc of the last move's column (gravity means
// the newest disc in a column is always its highest filled slot).
const isLastDrop = (r: number, c: number): boolean => {
  if (props.lastMove?.col !== c) return false;
  for (let row = 0; row < ROWS; row++) {
    if (cellAt(row, c) !== null) return row === r;
  }
  return false;
};
const slotLabel = (r: number, c: number): string => {
  const v = cellAt(r, c);
  const what = v === null ? 'empty' : v === props.myPlayer ? 'yours' : 'theirs';
  return `Column ${c + 1}, row ${r + 1}, ${what}. Drop in column ${c + 1}`;
};
</script>

<style scoped>
.c4 {
  padding: 4px;
  width: 100%;
  border-radius: 10px;
  /* The classic plastic frame reads as a tinted panel behind the slots. */
  background: rgba(var(--game-accent, 0, 0, 0), calc(var(--game-accent-a, 0.06) * 0.6));
}
.c4-slot-col {
  padding: 1px;
}
.c4-slot {
  width: 100%;
  aspect-ratio: 1;
  border: none;
  border-radius: 50%;
  background: rgba(var(--game-accent, 0, 0, 0), var(--game-accent-a, 0.06));
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 220px bubble → ~28px slots; the mark sizes off this. */
  font-size: 17px;
  color: var(--ion-color-primary);
  cursor: pointer;
}
.c4-slot:disabled {
  cursor: default;
}
.frozen .c4-slot {
  opacity: 0.85;
}
.c4-disc {
  line-height: 1;
}
</style>
