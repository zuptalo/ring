<template>
  <div class="game">
    <!-- A gameType this build doesn't know (a newer app started it): show a
         graceful fallback rather than a broken board (contract §1). -->
    <div v-if="!module || !boardComponent" class="game-fallback">
      <ion-icon :icon="gameControllerOutline" aria-hidden="true" />
      Update Ring to play this game.
    </div>
    <template v-else>
      <!-- Matchup header (FR-019/FR-023): who plays what, minimal words. -->
      <div class="game-vs">
        <span class="game-side you">
          <game-mark :mark="theme.marks?.[myPlayer]" :player="myPlayer" />
          <span class="side-name">You</span>
        </span>
        <span class="game-vs-word">vs</span>
        <span class="game-side">
          <span class="side-name">{{ peerFirstName }}</span>
          <game-mark :mark="theme.marks?.[theirPlayer]" :player="theirPlayer" />
        </span>
      </div>

      <div class="game-stage">
        <component
          :is="boardComponent"
          :state="boardState"
          :my-player="myPlayer"
          :can-move="canMove"
          :marks="theme.marks"
          :accent="theme.accent"
          :last-move="lastMove"
          @move="(mv: unknown) => $emit('move', mv)"
        />
        <!-- Result overlay (FR-025): the finished board announces itself — gold
             trophy, silver medal, or a handshake — large and animated over a
             half-transparent backdrop, with a phoenix rematch. Tapping it peeks
             at the final board (the compact line below keeps the outcome). -->
        <div
          v-if="showOverlay"
          class="game-overlay"
          role="button"
          tabindex="0"
          :aria-label="`${statusLine}. Show the board`"
          @click.stop="peeked = true"
          @keydown.enter.stop="peeked = true"
        >
          <animated-emoji :emoji="overlayEmoji" large class="game-overlay-result" />
          <ion-button size="small" fill="clear" class="game-overlay-again" @click.stop="$emit('rematch', game.gameType)">
            <animated-emoji emoji="🐦‍🔥" />&nbsp;Play again
          </ion-button>
        </div>
      </div>

      <!-- Glanceable state (FR-020/FR-023): an animated cue + as few words as
           possible, from the palette in docs/ANIMATED-EMOJI.md. Hidden while
           the result overlay carries the outcome. -->
      <template v-if="!showOverlay">
        <div class="game-status" role="status">
          <animated-emoji v-if="statusEmoji" :key="statusEmoji" :emoji="statusEmoji" />
          <span>{{ statusLine }}</span>
        </div>
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
          <ion-button v-else size="small" fill="clear" @click.stop="$emit('rematch', game.gameType)">
            <animated-emoji emoji="🐦‍🔥" />&nbsp;Play again
          </ion-button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonIcon, IonButton, alertController } from '@ionic/vue';
import { gameControllerOutline } from 'ionicons/icons';
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';
import GameMark from '@/components/GameMark.vue';
import { GAMES } from '@/games/registry';
import { GAME_BOARDS } from '@/games/boards';
import { deriveStatus, replayState } from '@/games/session';
import type { GameSession, GameTheme } from '@/games/types';

// The bubble renders ONLY derived state: board and status come from replaying
// the session's validated move log (src/games/session.ts), never from anything
// a peer claimed — the tamper-containment property the spec rests on (FR-004).
const props = defineProps<{
  game: GameSession;
  /** Whether this bubble is our own message — the starter is player 0. */
  outgoing: boolean;
  /** The opponent's display name (the 1:1 chat's name). */
  peerName?: string;
}>();
const emit = defineEmits<{
  (e: 'move', move: unknown): void;
  (e: 'resign'): void;
  /** Play again: start a fresh bubble of the same game (the chooser moves first). */
  (e: 'rematch', gameType: string): void;
}>();

const module = computed(() => GAMES[props.game.gameType] ?? null);
const boardComponent = computed(() => GAME_BOARDS[props.game.gameType] ?? null);
const myPlayer = computed<0 | 1>(() => (props.outgoing ? 0 : 1));
const theirPlayer = computed<0 | 1>(() => (props.outgoing ? 1 : 0));
const peerFirstName = computed(() => (props.peerName ?? 'Them').split(' ')[0]);
// Unknown/absent theme id → the module's first theme (classic), never an error
// (FR-022; a newer app may ship themes this build doesn't know).
const theme = computed<GameTheme>(() => {
  const list = module.value?.themes ?? [];
  return list.find((t) => t.id === props.game.theme) ?? list[0] ?? { id: 'classic', name: 'Classic' };
});
const status = computed(() => deriveStatus(module.value, props.game));
const boardState = computed(() => (module.value ? replayState(module.value, props.game) : null));
const lastMove = computed(() => {
  const rec = props.game.moves[props.game.moves.length - 1];
  return rec ? (rec.move as { cell: number }) : null;
});
const canMove = computed(
  () => status.value.state === 'ongoing' && status.value.turn === myPlayer.value,
);

// As few words as possible (FR-023); the animated cue carries the feeling.
const statusLine = computed((): string => {
  const s = status.value;
  const them = peerFirstName.value;
  switch (s.state) {
    case 'ongoing':
      return s.turn === myPlayer.value ? 'Your move' : `${them}'s move`;
    case 'won':
      return s.winner === myPlayer.value ? 'You won!' : `${them} won`;
    case 'draw':
      return 'Draw';
    case 'resigned':
      return s.winner === myPlayer.value ? `${them} gave up. You win!` : 'You gave up';
    case 'out-of-sync':
      return 'Out of sync';
  }
  return '';
});

// The paired cue — same concept, same emoji, everywhere (docs/ANIMATED-EMOJI.md):
// results are 🏆 (winner) / 🥈 (other player) / 🤝 (draw), matching the overlay.
const statusEmoji = computed((): string => {
  const s = status.value;
  if (s.state === 'ongoing') return s.turn === myPlayer.value ? '🎲' : '⏳';
  if (s.state === 'won' || s.state === 'resigned') return s.winner === myPlayer.value ? '🏆' : '🥈';
  if (s.state === 'draw') return '🤝';
  if (s.state === 'out-of-sync') return '😵';
  return '';
});

// Result overlay (FR-025): shown for every finished-with-a-result state until
// the player peeks at the final board. Peeking is per-mount, local only.
const peeked = ref(false);
const showOverlay = computed(
  () =>
    !peeked.value &&
    (status.value.state === 'won' || status.value.state === 'draw' || status.value.state === 'resigned'),
);
const overlayEmoji = computed((): string => {
  const s = status.value;
  if (s.state === 'draw') return '🤝';
  return (s.state === 'won' || s.state === 'resigned') && s.winner === myPlayer.value ? '🏆' : '🥈';
});

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
</script>

<style scoped>
.game {
  width: 220px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* Grid keeps "vs" DEAD CENTER regardless of name lengths (T041): the two
   sides get equal tracks and ellipsize long names instead of pushing it. */
.game-vs {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}
.game-side {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.game-side:last-child {
  justify-content: flex-end;
}
.game-side .side-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.game-vs-word {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--app-text-muted);
  flex: none;
}
.game-stage {
  position: relative;
}
.game-overlay {
  position: absolute;
  inset: 0;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  /* Scales the `large` (2.6em) result emoji to hero size. */
  font-size: 26px;
}
.game-overlay-again {
  font-size: 13px;
  text-transform: none;
  --color: #fff;
}
.game-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--app-text-muted);
}
.game-fallback {
  display: flex;
  align-items: center;
  gap: 6px;
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
