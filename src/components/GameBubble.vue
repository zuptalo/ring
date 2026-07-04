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
      <div class="game-actions">
        <ion-button
          v-if="status.state === 'ongoing'"
          size="small"
          fill="clear"
          color="medium"
          @click.stop="confirmResign"
        >
          Resign
        </ion-button>
        <ion-button
          v-else
          size="small"
          fill="clear"
          @click.stop="$emit('rematch', game.gameType)"
        >
          Play again
        </ion-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon, IonButton, alertController } from '@ionic/vue';
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
const emit = defineEmits<{
  (e: 'move', move: unknown): void;
  (e: 'resign'): void;
  /** Play again: start a fresh bubble of the same game (the chooser moves first). */
  (e: 'rematch', gameType: string): void;
}>();

// Resigning concedes the game — worth one explicit confirmation.
async function confirmResign(): Promise<void> {
  const alert = await alertController.create({
    header: 'Resign this game?',
    message: 'Your friend wins the game.',
    buttons: [
      { text: 'Keep playing', role: 'cancel' },
      { text: 'Resign', role: 'destructive', handler: () => emit('resign') },
    ],
  });
  await alert.present();
}

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
.game-actions {
  display: flex;
  justify-content: flex-end;
  margin: -4px -8px -6px 0;
}
.game-actions ion-button {
  --padding-start: 8px;
  --padding-end: 8px;
  font-size: 13px;
  text-transform: none;
}
</style>
