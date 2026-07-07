<template>
  <!-- The challenge card (spec 1038 FR-005): the compact chat/wall face of a
       fullscreen-presentation game. Never a playable board — one glanceable
       state line that always names who the game is waiting on, and one button
       into the overlay (players only; the card itself IS the spectator view). -->
  <div class="gcc" :class="{ finished: cardState === 'finished' }">
    <div class="gcc-top">
      <span class="gcc-glyph" aria-hidden="true">
        <ion-icon :icon="module?.icon" />
      </span>
      <span class="gcc-titles">
        <span class="gcc-title">{{ title }}</span>
        <span class="gcc-sub">{{ subtitle }}</span>
      </span>
      <medal-svg v-if="cardState === 'finished' && medalWon !== null" :won="medalWon" small class="gcc-medal" />
    </div>
    <button v-if="buttonLabel" type="button" class="gcc-btn" :class="{ urgent: cardState === 'your-move' }" @click.stop="$emit('open')">
      {{ buttonLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import MedalSvg from '@/games/armada/MedalSvg.vue';
import { GAMES } from '@/games/registry';
import { deriveStatus, localMoveAllowed, replayState } from '@/games/session';
import { challengePhase } from '@/games/challenge';
import type { GameSession } from '@/games/types';

const props = defineProps<{
  session: GameSession;
  /** The viewer's seat; null = spectator (card-only, no overlay entry). */
  me: 0 | 1 | null;
  /** The other player's display name (or the challenger's, for spectators). */
  opponentName?: string;
  surface: 'chat' | 'wall';
}>();
defineEmits<{ (e: 'open'): void }>();

const module = computed(() => GAMES[props.session.gameType] ?? null);
const title = computed(() => (module.value?.displayName ?? 'Game').toUpperCase());
const status = computed(() => deriveStatus(module.value, props.session));
const name = computed(() => props.opponentName || 'your opponent');

type CardState =
  | 'challenged'
  | 'awaiting-fleet'
  | 'your-move'
  | 'their-turn'
  | 'finished'
  | 'cancelled'
  | 'out-of-sync'
  | 'update';

const phase = computed(() => (props.session.challenge ? challengePhase(props.session) : null));

const cardState = computed<CardState>(() => {
  if (!module.value) return 'update';
  if (phase.value === 'cancelled') return 'cancelled';
  const st = status.value;
  if (st.state === 'out-of-sync') return 'out-of-sync';
  if (st.state !== 'ongoing') return 'finished';
  // Only a genuinely OPEN challenge (or an untouched 1:1 invitation) reads as
  // "challenged" — an accepted challenge with no moves yet is DEPLOYMENT.
  if (phase.value === 'open') return 'challenged';
  if (!props.session.challenge && props.session.moves.length === 0) return 'challenged';
  if (props.session.moves.length < 2) {
    if (props.me === null) return 'their-turn';
    const mine = props.session.moves.some((m) => m.player === props.me);
    return mine ? 'awaiting-fleet' : 'your-move';
  }
  return myTurn.value ? 'your-move' : 'their-turn';
});

const myTurn = computed(() => {
  if (props.me === null || !module.value) return false;
  return localMoveAllowed(module.value, props.session, props.me);
});

const medalWon = computed<boolean | null>(() => {
  const st = status.value;
  if (st.state === 'won' || st.state === 'resigned') {
    return props.me === null ? true : st.winner === props.me;
  }
  if (st.state === 'draw') return false;
  return null;
});

const subtitle = computed(() => {
  const st = status.value;
  switch (cardState.value) {
    case 'update':
      return 'Update Ring to play this game';
    case 'cancelled':
      return 'Challenge withdrawn';
    case 'out-of-sync':
      return 'This game got out of step and had to stop';
    case 'finished': {
      if (st.state === 'draw') return "It's a draw";
      const won = medalWon.value;
      if (props.me === null) return 'Battle decided';
      return won ? 'Victory at sea' : 'Your fleet was lost';
    }
    case 'challenged':
      if (props.surface === 'wall') return props.me === 0 ? 'Open challenge · waiting for a rival' : `Open challenge · from ${name.value}`;
      return props.me === 0 ? `Naval duel · you challenged ${name.value}` : `Naval duel · ${name.value} challenged you`;
    case 'awaiting-fleet':
      return `Awaiting ${name.value}'s fleet`;
    case 'your-move':
      return props.session.moves.length < 2 ? 'Your fleet awaits deployment' : 'Your move';
    case 'their-turn':
    default:
      return props.me === null ? 'Battle under way' : `${name.value} is aiming…`;
  }
});

const buttonLabel = computed<string | null>(() => {
  // Spectators stay on the card — EXCEPT on an OPEN wall challenge, where any
  // non-host viewer is a potential acceptor (no seat exists yet by design).
  // The HOST of a still-open wall challenge has nothing to enter either:
  // deployment starts once a rival takes the seat.
  const openWallSeat = props.surface === 'wall' && phase.value === 'open' && props.me !== 0;
  if (props.surface === 'wall' && phase.value === 'open' && props.me === 0) return null;
  if (props.me === null && !openWallSeat) return null;
  switch (cardState.value) {
    case 'update':
    case 'cancelled':
    case 'out-of-sync':
      return null;
    case 'finished':
      return 'View result ▸';
    case 'challenged':
      return openWallSeat ? 'Accept challenge ▸' : 'Play in fullscreen ▸';
    case 'awaiting-fleet':
      return 'Review fleet ▸';
    case 'your-move':
      return 'Play in fullscreen ▸';
    case 'their-turn':
    default:
      return 'Watch ▸';
  }
});
</script>

<style scoped>
.gcc {
  max-width: 320px;
  margin: 0 auto;
  border-radius: 16px;
  padding: 14px;
  background: linear-gradient(160deg, #1b2440, #141a2b);
  border: 1px solid rgba(143, 174, 255, 0.25);
  color: #f5f7ff;
}
.gcc-top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.gcc-glyph {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: 12px;
  background: linear-gradient(135deg, #41537e, #2c3e70);
  border: 1px solid rgba(143, 174, 255, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.gcc-glyph ion-icon {
  font-size: 24px;
  color: #dce2f5;
}
.gcc-titles {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gcc-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
}
.gcc-sub {
  font-size: 12px;
  color: rgba(220, 226, 245, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
}
.gcc-medal {
  flex-shrink: 0;
}
.gcc-btn {
  width: 100%;
  margin-top: 12px;
  padding: 11px;
  border-radius: 10px;
  border: 1px solid rgba(143, 174, 255, 0.5);
  background: linear-gradient(135deg, #41537e, #2c3e70);
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.gcc-btn.urgent {
  border-color: rgba(123, 156, 255, 0.9);
  box-shadow: 0 0 14px rgba(123, 156, 255, 0.35);
}
</style>
