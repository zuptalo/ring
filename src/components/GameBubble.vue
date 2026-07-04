<template>
  <div class="game">
    <div class="game-head">
      <ion-icon :icon="gameControllerOutline" class="game-icon" aria-hidden="true" />
      <span class="game-name">{{ module?.displayName ?? 'Game' }}</span>
    </div>

    <!-- A gameType this build doesn't know (a newer app started it): show a
         graceful fallback rather than a broken board (contract §1). -->
    <div v-if="!module || !boardComponent" class="game-fallback">
      Update Ring to play this game.
    </div>
    <template v-else>
      <component
        :is="boardComponent"
        :state="boardState"
        :my-player="myPlayer"
        :can-move="canMove"
        @move="(mv: unknown) => $emit('move', mv)"
      />
      <div class="game-status" role="status">{{ statusLine }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { gameControllerOutline } from 'ionicons/icons';
import { GAMES } from '@/games/registry';
import { GAME_BOARDS } from '@/games/boards';
import { deriveStatus, replayState } from '@/games/session';
import type { GameSession } from '@/games/types';

// The bubble renders ONLY derived state: board and status come from replaying
// the session's validated move log (src/games/session.ts), never from anything
// a peer claimed — the tamper-containment property the spec rests on (FR-004).
const props = defineProps<{
  game: GameSession;
  /** Whether this bubble is our own message — the starter is player 0. */
  outgoing: boolean;
}>();
defineEmits<{ (e: 'move', move: unknown): void }>();

const module = computed(() => GAMES[props.game.gameType] ?? null);
const boardComponent = computed(() => GAME_BOARDS[props.game.gameType] ?? null);
const myPlayer = computed<0 | 1>(() => (props.outgoing ? 0 : 1));
const status = computed(() => deriveStatus(module.value, props.game));
const boardState = computed(() => (module.value ? replayState(module.value, props.game) : null));
const canMove = computed(
  () => status.value.state === 'ongoing' && status.value.turn === myPlayer.value,
);

const statusLine = computed((): string => {
  const s = status.value;
  switch (s.state) {
    case 'ongoing':
      return s.turn === myPlayer.value ? 'Your turn' : 'Their turn';
    case 'won':
      return s.winner === myPlayer.value ? 'You won! 🎉' : 'They won';
    case 'draw':
      return "It's a draw";
    case 'resigned':
      return s.winner === myPlayer.value ? 'They resigned. You win!' : 'You resigned';
    case 'out-of-sync':
      return 'This game got out of sync';
  }
  return '';
});
</script>

<style scoped>
.game {
  width: 220px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.game-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
}
.game-icon {
  font-size: 17px;
  color: var(--ion-color-primary);
}
.game-status {
  font-size: 13px;
  color: var(--app-text-muted);
}
.game-fallback {
  font-size: 14px;
  color: var(--app-text-muted);
  padding: 8px 0;
}
</style>
