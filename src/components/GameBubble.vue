<template>
  <div class="game" :class="{ wide: game.gameType === 'battleship' }">
    <!-- A gameType this build doesn't know (a newer app started it): show a
         graceful fallback rather than a broken board (contract §1). -->
    <div v-if="!module || !boardComponent" class="game-fallback">
      <ion-icon :icon="gameControllerOutline" aria-hidden="true" />
      Update Ring to play this game.
    </div>
    <template v-else>
      <!-- Matchup header (FR-019/FR-023): who plays what, minimal words. In
           explicit-players sessions (spec 0009) seats render in play order;
           1:1 keeps you-first exactly as shipped. -->
      <div class="game-vs">
        <span class="game-side you">
          <span v-if="game.gameType === 'battleship'" class="mini-sub" aria-hidden="true"><submarine-svg :len="1" /></span>
          <game-mark v-else :mark="theme.marks?.[leftSeat]" :player="leftSeat" />
          <user-avatar v-if="seatAvatar(leftSeat)" :src="seatAvatar(leftSeat)!" :alt="seatName(leftSeat)" class="side-face" />
          <span class="side-name">{{ seatName(leftSeat) }}</span>
        </span>
        <span class="game-vs-word">vs</span>
        <span class="game-side">
          <span class="side-name">{{ seatName(rightSeat) }}</span>
          <user-avatar v-if="seatAvatar(rightSeat)" :src="seatAvatar(rightSeat)!" :alt="seatName(rightSeat)" class="side-face" />
          <span v-if="game.gameType === 'battleship'" class="mini-sub mirrored" aria-hidden="true"><submarine-svg :len="1" /></span>
          <game-mark v-else :mark="theme.marks?.[rightSeat]" :player="rightSeat" />
        </span>
      </div>

      <div class="game-stage">
        <component
          :is="boardComponent"
          :state="boardState"
          :my-player="myPlayer ?? 0"
          :can-move="canMove"
          :marks="theme.marks"
          :accent="theme.accent"
          :last-move="lastMove"
          @move="(mv: unknown) => $emit('move', mv)"
        />
        <!-- Result overlay (FR-025): the finished board announces itself — gold
             trophy, silver medal, or a handshake — large and animated over a
             half-transparent backdrop. PLAYERS can tap to peek at the final
             board and get the phoenix rematch; OBSERVERS (spec 0009) get the
             winner by name and an invitation to throw their own challenge —
             the finished board is the players' business, not a replay surface. -->
        <div
          v-if="showOverlay"
          class="game-overlay"
          :role="isObserver ? undefined : 'button'"
          :tabindex="isObserver ? undefined : 0"
          :aria-label="isObserver ? statusLine : `${statusLine}. Show the board`"
          @click.stop="isObserver ? undefined : (peeked = true)"
          @keydown.enter.stop="isObserver ? undefined : (peeked = true)"
        >
          <!-- Battleship earns the struck medallion (spec 1033); the other
               games keep the platform's emoji result language. -->
          <medallion-svg
            v-if="game.gameType === 'battleship' && status.state !== 'draw'"
            :kind="overlayEmoji === '🏆' ? 'gold' : 'silver'"
          />
          <animated-emoji v-else :emoji="overlayEmoji" large class="game-overlay-result" />
          <span v-if="game.gameType === 'battleship' && !isObserver" class="game-overlay-line">{{ statusLine }}</span>
          <span v-if="isObserver" class="game-overlay-line">{{ statusLine }}</span>
          <ion-button
            v-if="!isObserver"
            size="small"
            fill="clear"
            class="game-overlay-again"
            @click.stop="$emit('rematch', game.gameType)"
          >
            <animated-emoji emoji="🐦‍🔥" />&nbsp;Play again
          </ion-button>
          <ion-button
            v-else
            size="small"
            fill="clear"
            class="game-overlay-again"
            @click.stop="$emit('rematch', game.gameType)"
          >
            <animated-emoji emoji="🫵" />&nbsp;Start your own challenge
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
            v-if="status.state === 'ongoing' && myPlayer !== null"
            size="small"
            fill="clear"
            color="medium"
            @click.stop="confirmResign"
          >
            Resign
          </ion-button>
          <!-- Observers can privately follow a live game for move/result alerts
               (spec 0009 FR-006 — device-local, nobody learns who follows). -->
          <ion-button
            v-else-if="status.state === 'ongoing' && myPlayer === null && explicit"
            size="small"
            fill="clear"
            :color="followed ? 'primary' : 'medium'"
            @click.stop="$emit('follow')"
          >
            <animated-emoji emoji="👀" />&nbsp;{{ followed ? 'Following' : 'Follow' }}
          </ion-button>
          <!-- Rematch only once the game is OVER (observers included — anyone
               may throw the next open challenge, spec 0009). -->
          <ion-button
            v-else-if="status.state !== 'ongoing'"
            size="small"
            fill="clear"
            @click.stop="$emit('rematch', game.gameType)"
          >
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
import UserAvatar from '@/components/UserAvatar.vue';
import MedallionSvg from '@/games/battleship/MedallionSvg.vue';
import SubmarineSvg from '@/games/battleship/SubmarineSvg.vue';
import { GAMES } from '@/games/registry';
import { GAME_BOARDS } from '@/games/boards';
import { deriveStatus, replayState } from '@/games/session';
import { playerIndexOf, resolveOpponent } from '@/games/challenge';
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
  /** Explicit-players sessions (spec 0009 challenges): who I am… */
  selfId?: string;
  /** …and how to name the seats (userId → display name). */
  names?: Record<string, string>;
  /** Observer follow state (spec 0009 FR-006, device-local). */
  followed?: boolean;
  /** Seat avatars (userId → image src), e.g. from the wall's sealed player
   *  meta. Rendered beside the seat names when available. */
  avatars?: Record<string, string>;
}>();
const emit = defineEmits<{
  (e: 'move', move: unknown): void;
  (e: 'resign'): void;
  /** Play again: start a fresh bubble of the same game (the chooser moves first). */
  (e: 'rematch', gameType: string): void;
  /** Observer toggling their private follow of this game. */
  (e: 'follow'): void;
}>();

const module = computed(() => GAMES[props.game.gameType] ?? null);
const boardComponent = computed(() => GAME_BOARDS[props.game.gameType] ?? null);
// Seats: explicit players (group/wall) map by userId — null = observer,
// read-only board. 1:1 keeps the spec-0008 direction-derived roles untouched.
const explicit = computed(() => !!props.game.players);
const myPlayer = computed<0 | 1 | null>(() =>
  explicit.value ? playerIndexOf(props.game, props.selfId ?? '') : props.outgoing ? 0 : 1,
);
const seatAvatar = (idx: 0 | 1): string | null => {
  if (!explicit.value || !props.avatars) return null;
  const uid = props.game.players?.[idx] ?? (idx === 1 ? resolveOpponent(props.game) ?? '' : '');
  return (uid && props.avatars[uid]) || null;
};
const seatName = (idx: 0 | 1): string => {
  if (!explicit.value) return idx === myPlayer.value ? 'You' : peerFirstName.value;
  const uid = props.game.players?.[idx] ?? (idx === 1 ? resolveOpponent(props.game) ?? '' : '');
  if (uid && uid === props.selfId) return 'You';
  // 'Someone' matches how the Wall names non-contact comment authors — a wall
  // game's players aren't necessarily each other's contacts.
  return (props.names?.[uid ?? ''] ?? 'Someone').split(' ')[0];
};
const peerFirstName = computed(() => (props.peerName ?? 'Them').split(' ')[0]);
// Header order: play order for explicit seats; you-first for 1:1 (as shipped).
const leftSeat = computed<0 | 1>(() => (explicit.value ? 0 : ((myPlayer.value ?? 0) as 0 | 1)));
const rightSeat = computed<0 | 1>(() => (1 - leftSeat.value) as 0 | 1);
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
  () => myPlayer.value !== null && status.value.state === 'ongoing' && status.value.turn === myPlayer.value,
);

// As few words as possible (FR-023); the animated cue carries the feeling.
// Observers (spec 0009) read everything third-person by seat name.
const statusLine = computed((): string => {
  const s = status.value;
  switch (s.state) {
    case 'ongoing':
      return s.turn === myPlayer.value ? 'Your move' : `${seatName(s.turn)}'s move`;
    case 'won':
      return s.winner === myPlayer.value ? 'You won!' : `${seatName(s.winner)} won`;
    case 'draw':
      return 'Draw';
    case 'resigned': {
      const loser = (1 - s.winner) as 0 | 1;
      if (s.winner === myPlayer.value) return `${seatName(loser)} gave up. You win!`;
      if (loser === myPlayer.value) return 'You gave up';
      return `${seatName(loser)} gave up. ${seatName(s.winner)} wins`;
    }
    case 'out-of-sync':
      return 'Out of sync';
  }
  return '';
});

// The paired cue — same concept, same emoji, everywhere (docs/ANIMATED-EMOJI.md):
// results are 🏆 (winner) / 🥈 (losing player) / 🤝 (draw); observers see the 🏆.
const statusEmoji = computed((): string => {
  const s = status.value;
  if (s.state === 'ongoing') return s.turn === myPlayer.value ? '🎲' : '⏳';
  if (s.state === 'won' || s.state === 'resigned') {
    if (myPlayer.value === null) return '🏆';
    return s.winner === myPlayer.value ? '🏆' : '🥈';
  }
  if (s.state === 'draw') return '🤝';
  if (s.state === 'out-of-sync') return '😵';
  return '';
});

// Result overlay (FR-025): shown for every finished-with-a-result state until
// the player peeks at the final board. Peeking is per-mount, local only — and
// players-only: observers keep the announcement (spec 0009).
const peeked = ref(false);
const isObserver = computed(() => explicit.value && myPlayer.value === null);
const showOverlay = computed(
  () =>
    (!peeked.value || isObserver.value) &&
    (status.value.state === 'won' || status.value.state === 'draw' || status.value.state === 'resigned'),
);
const overlayEmoji = computed((): string => {
  const s = status.value;
  if (s.state === 'draw') return '🤝';
  if (myPlayer.value === null) return '🏆'; // observers celebrate the winner
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
  /* Full-width inside the shared game card (spec 1033). Small square boards
     (tic-tac-toe, Connect Four) stay their compact size, centered; 'wide'
     games (Battleship's two seas) use the whole card. */
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.game:not(.wide) .game-vs,
.game:not(.wide) .game-stage {
  width: 100%;
  max-width: 240px;
  margin-inline: auto;
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
  gap: 8px;
  min-width: 0;
}
.game-side:last-child {
  justify-content: flex-end;
}
.mini-sub {
  width: 30px;
  height: 22px;
  flex: none;
  display: inline-flex;
}
.mini-sub.mirrored {
  transform: scaleX(-1);
}
.game-side .side-face {
  width: 18px;
  height: 18px;
  flex: none;
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
.game-overlay-line {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  text-align: center;
  padding: 0 8px;
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
