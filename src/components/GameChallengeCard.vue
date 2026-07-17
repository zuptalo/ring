<template>
  <!-- The challenge card (spec 1038 FR-005): the compact chat/wall face of a
       fullscreen-presentation game. Never a playable board — it identifies the
       game and its CURRENT state at a glance, and (for anyone who can enter) the
       whole card taps into the overlay. It renders FLAT inside the chat's
       neutral game-card bubble — no second card chrome — so it isn't a box in a
       box. There is deliberately no big "open" button for an ongoing game: the
       global "Back to the game" pill already does that; a second one is just
       noise. -->
  <component
    :is="canEnter ? 'button' : 'div'"
    class="gcc"
    :class="{ enterable: canEnter, urgent, wall: surface === 'wall' }"
    :type="canEnter ? 'button' : undefined"
    :aria-label="canEnter ? `${title}: ${subtitle}. Open` : `${title}: ${subtitle}`"
    @click.stop="canEnter && $emit('open')"
  >
    <span class="gcc-glyph" :class="{ withdrawn: cardState === 'cancelled' }" aria-hidden="true">
      <ion-icon :icon="cardState === 'cancelled' ? arrowUndoOutline : module?.icon" />
    </span>
    <span class="gcc-titles">
      <span class="gcc-title">{{ title }}</span>
      <span class="gcc-state">
        <span class="gcc-dot" aria-hidden="true" />
        <span class="gcc-state-text">{{ subtitle }}</span>
      </span>
    </span>
    <medal-svg v-if="cardState === 'finished' && medalWon !== null" :won="medalWon" small class="gcc-side" />
    <span v-else-if="acceptCta" class="gcc-cta">{{ acceptCta }}</span>
    <ion-icon v-else-if="canEnter" :icon="chevronForwardOutline" class="gcc-side gcc-chev" aria-hidden="true" />
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { chevronForwardOutline, arrowUndoOutline } from 'ionicons/icons';
import MedalSvg from '@/games/armada/MedalSvg.vue';
import { GAMES } from '@/games/registry';
import { deriveStatus, localMoveAllowed } from '@/games/session';
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
// The game's own name IS the card's identity now (the state line no longer
// repeats it), so a plain, readable name beats the old shouty all-caps.
const title = computed(() => module.value?.displayName ?? 'Game');
const status = computed(() => deriveStatus(module.value, props.session));
const name = computed(() => props.opponentName || 'your opponent');
// Per-game card copy (Armada's naval voice, chess's own, …); absent ⇒ neutral
// generic phrasing below.
const card = computed(() => module.value?.card ?? null);
// Parallel-opening games (Armada) treat the first two moves as both-players
// SETUP rather than strict turns; everything else alternates from move 1.
const parallelOpening = computed(() => card.value?.parallelOpening === true);

type CardState =
  | 'challenged'
  | 'awaiting-setup'
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
  // A resignation before anything happened is a WITHDRAWN challenge, not a
  // victory — nobody moved, nobody won anything worth a medal.
  if (st.state === 'resigned' && props.session.moves.length === 0) return 'cancelled';
  if (st.state !== 'ongoing') return 'finished';
  // Only a genuinely OPEN challenge (or an untouched 1:1 invitation) reads as
  // "challenged" — an accepted challenge with no moves yet is SETUP/first move.
  if (phase.value === 'open') return 'challenged';
  if (!props.session.challenge && props.session.moves.length === 0) return 'challenged';
  // Parallel-opening games: the first two moves are order-independent setup,
  // so who-owes-what is derived from "have I moved yet", not from turn order.
  if (parallelOpening.value && props.session.moves.length < 2) {
    if (props.me === null) return 'their-turn';
    const mine = props.session.moves.some((m) => m.player === props.me);
    return mine ? 'awaiting-setup' : 'your-move';
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

// The state line: a few words that say what's happening RIGHT NOW. It no longer
// repeats the game name (the title owns that), so it stays short and glanceable.
const subtitle = computed(() => {
  const st = status.value;
  const c = card.value;
  switch (cardState.value) {
    case 'update':
      return 'Update Ring to play this game';
    case 'cancelled':
      return 'Challenge withdrawn';
    case 'out-of-sync':
      return 'Out of step — the game had to stop';
    case 'finished': {
      if (st.state === 'draw') return "It's a draw";
      const won = medalWon.value;
      if (props.me === null) return c?.spectateFinished ?? 'Game decided';
      if (st.state === 'resigned') {
        return won ? c?.resignWin ?? 'They resigned. The win is yours' : c?.resignLoss ?? 'You resigned';
      }
      return won ? c?.win ?? 'You won' : c?.loss ?? 'You lost';
    }
    case 'challenged':
      if (props.surface === 'wall') return props.me === 0 ? 'Open challenge — waiting for a rival' : `Challenge from ${name.value}`;
      return props.me === 0 ? `You challenged ${name.value}` : `${name.value} challenged you`;
    case 'awaiting-setup':
      return c?.awaitingOpening?.(name.value) ?? `Waiting for ${name.value}`;
    case 'your-move':
      if (parallelOpening.value && props.session.moves.length < 2) return c?.deployLine ?? 'Your move';
      return 'Your move';
    case 'their-turn':
    default:
      return props.me === null ? c?.spectateOngoing ?? 'Game under way' : c?.theirTurn?.(name.value) ?? `${name.value} to move`;
  }
});

// Whether THIS viewer can open the overlay. A pure spectator can't (except to
// accept a still-open wall challenge); neither can the host of an open wall
// challenge (nothing to enter until a rival takes the seat); nor a
// terminal-but-unenterable state (update/cancelled/out-of-sync).
const openWallSeat = computed(() => props.surface === 'wall' && phase.value === 'open' && props.me !== 0);
const canEnter = computed(() => {
  if (props.surface === 'wall' && phase.value === 'open' && props.me === 0) return false;
  if (props.me === null && !openWallSeat.value) return false;
  return cardState.value !== 'update' && cardState.value !== 'cancelled' && cardState.value !== 'out-of-sync';
});

// A call-to-action pill only where a distinct verb earns its place: taking an
// open wall challenge's seat. Everywhere else the subtle chevron is enough.
const acceptCta = computed(() => (openWallSeat.value && cardState.value === 'challenged' ? 'Accept' : null));

// "It's on you" states get the emerald, pulsing emphasis: your move, or a
// challenge you've been handed (1:1 invitee or a wall seat you can take).
const urgent = computed(
  () => cardState.value === 'your-move' || (cardState.value === 'challenged' && props.me !== 0 && canEnter.value),
);
</script>

<style scoped>
/* Flat content inside the chat's neutral game-card bubble (ChatDetailPage
   .game-row .bubble already provides bg/border/radius/padding) — no second card,
   no wasted nesting. Theme-aware tokens so it reads in light and dark. */
.gcc {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--app-text);
  font-family: inherit;
  text-align: left;
}
.gcc.enterable {
  cursor: pointer;
}
/* On the Wall the post is far wider than a chat bubble. Stretching the card
   makes the flex:1 title column push the medal/chevron out to the far edge
   ("content going way to the sides"). Shrink the card to its content instead, so
   the icon, text and medal/chevron stay grouped and left-aligned with the body. */
.gcc.wall {
  width: fit-content;
  max-width: 100%;
}
.gcc.wall .gcc-titles {
  flex: 0 1 auto; /* don't expand and shove the side element away */
}
.gcc-glyph {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 12px;
  background: var(--ion-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.gcc-glyph ion-icon {
  font-size: 23px;
  color: var(--ion-color-primary-contrast);
}
/* Withdrawn (someone pulled out before the game began): a muted, grey "backed
   out" badge instead of the live emerald game icon — reads at a glance as
   "this challenge was withdrawn", distinct from an active or finished game. */
.gcc-glyph.withdrawn {
  background: var(--app-surface);
}
.gcc-glyph.withdrawn ion-icon {
  color: var(--app-text-muted);
}
.gcc-titles {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.gcc-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text);
}
.gcc-state {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12.5px;
  color: var(--app-text-secondary);
}
.gcc-state-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gcc-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--app-text-muted);
}
.gcc.urgent .gcc-dot {
  background: var(--ion-color-primary);
  animation: gcc-pulse 1.4s infinite;
}
.gcc.urgent .gcc-state {
  color: var(--ion-color-primary);
  font-weight: 600;
}
@keyframes gcc-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
.gcc-side {
  flex-shrink: 0;
}
.gcc-chev {
  font-size: 22px;
  color: var(--ion-color-primary);
}
.gcc-cta {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--ion-color-primary-contrast);
  background: var(--ion-color-primary);
  padding: 7px 14px;
  border-radius: 999px;
}
@media (prefers-reduced-motion: reduce) {
  .gcc.urgent .gcc-dot {
    animation: none;
  }
}
</style>
