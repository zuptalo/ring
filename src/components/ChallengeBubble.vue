<template>
  <!-- An open group game challenge (spec 0009). Three faces:
       open      → the animated announcement + Accept (Cancel for the creator);
       accepted  → the live GameBubble board (players by name, observers read-only);
       cancelled → a quiet withdrawn note.
       Everything renders from derived state (challengePhase/resolveOpponent),
       so every member's device shows the same face for the same data. -->
  <div class="ch">
    <template v-if="phase === 'open'">
      <div class="ch-announce">
        <animated-emoji emoji="🫵" large class="ch-point" />
        <div class="ch-copy">
          <span class="ch-title">{{ challengerName }} challenges the group</span>
          <span class="ch-game">
            <animated-emoji emoji="🎲" />
            {{ module?.displayName ?? 'a game' }}
            <template v-if="themeName"> · {{ themeName }}</template>
          </span>
        </div>
      </div>
      <div class="ch-actions">
        <ion-button v-if="isCreator" size="small" fill="clear" color="medium" @click.stop="$emit('cancel')">
          Withdraw
        </ion-button>
        <ion-button v-else size="small" shape="round" @click.stop="$emit('accept')">
          <animated-emoji emoji="💪" />&nbsp;I'm in
        </ion-button>
      </div>
    </template>

    <template v-else-if="phase === 'cancelled'">
      <div class="ch-withdrawn">
        <animated-emoji emoji="🫠" />
        <span>{{ challengerName }} withdrew the challenge</span>
      </div>
    </template>

    <template v-else>
      <!-- Seated: the real board. A racing accepter who lost the seat gets a
           gentle nod before settling in as an observer. -->
      <div v-if="lostRace" class="ch-race-lost">
        <animated-emoji emoji="😅" />
        <span>{{ opponentName }} got there first</span>
      </div>
      <game-bubble
        :game="game"
        :outgoing="outgoing"
        :self-id="selfId"
        :names="names"
        @move="(mv: unknown) => $emit('move', mv)"
        @resign="$emit('resign')"
        @rematch="(gt: string) => $emit('rematch', gt)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonButton } from '@ionic/vue';
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';
import GameBubble from '@/components/GameBubble.vue';
import { GAMES } from '@/games/registry';
import { challengePhase, resolveOpponent } from '@/games/challenge';
import type { GameSession } from '@/games/types';

const props = defineProps<{
  game: GameSession;
  outgoing: boolean;
  selfId: string;
  /** userId → display name for everyone who might appear on the bubble. */
  names: Record<string, string>;
}>();
defineEmits<{
  (e: 'accept'): void;
  (e: 'cancel'): void;
  (e: 'move', move: unknown): void;
  (e: 'resign'): void;
  (e: 'rematch', gameType: string): void;
}>();

const module = computed(() => GAMES[props.game.gameType] ?? null);
const phase = computed(() => challengePhase(props.game));
const challengerId = computed(() => props.game.players?.[0] ?? '');
const isCreator = computed(() => challengerId.value === props.selfId);
const nameOf = (uid: string): string =>
  uid === props.selfId ? 'You' : (props.names[uid] ?? 'Someone').split(' ')[0];
const challengerName = computed(() => nameOf(challengerId.value));
const opponentName = computed(() => nameOf(resolveOpponent(props.game) ?? ''));
const themeName = computed(
  () => module.value?.themes.find((t) => t.id === props.game.theme && t.id !== 'classic')?.name ?? '',
);
// I accepted but someone else took the seat — the race-lost nod (spec 0009).
const lostRace = computed(() => {
  const seat = resolveOpponent(props.game);
  return (
    !!seat &&
    seat !== props.selfId &&
    (props.game.challenge?.accepts ?? []).some((a) => a.userId === props.selfId)
  );
});
</script>

<style scoped>
.ch {
  width: 230px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ch-announce {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 26px; /* scales the large (2.6em) pointing hero */
}
.ch-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-size: 14px;
}
.ch-title {
  font-weight: 700;
  line-height: 1.25;
}
.ch-game {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--app-text-muted);
}
.ch-actions {
  display: flex;
  justify-content: flex-end;
}
.ch-actions ion-button {
  font-size: 13px;
  text-transform: none;
}
.ch-withdrawn,
.ch-race-lost {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--app-text-muted);
}
</style>
