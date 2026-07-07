<template>
  <!-- Skeleton (T007): compiles and renders the deployment grid so the module
       can register; the full handoff UI (deploy/battle/result faces) lands
       with US1 (T013–T015). -->
  <div class="armada-board">
    <div class="ab-grid">
      <div v-for="i in SIZE * SIZE" :key="i" class="ab-cell" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { SIZE, type ArmadaMove, type ArmadaState } from './logic';

defineProps<{
  state: ArmadaState;
  myPlayer: 0 | 1;
  canMove: boolean;
  marks?: [string, string];
  accent?: string;
  lastMove?: ArmadaMove | null;
}>();

defineEmits<{ (e: 'move', move: ArmadaMove): void }>();
</script>

<style scoped>
.ab-grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 4px;
}
.ab-cell {
  aspect-ratio: 1;
  border-radius: 7px;
  background: rgba(123, 156, 255, 0.055);
  border: 1px solid rgba(123, 156, 255, 0.09);
}
</style>
