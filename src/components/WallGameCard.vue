<template>
  <!-- A Wall challenge post's live face (spec 0009 US3): the post IS the board.
       Open → the animated call-to-arms + I'm in; seated → the same GameBubble
       chats use (players named, observers read-only, result overlay), with a
       private Follow for spectators. Everything renders from the DERIVED
       session (wallGameSession replays the engagement rows), reactive via the
       idb bus — no state of its own. -->
  <div v-if="session" class="wgc">
    <template v-if="phase === 'open'">
      <!-- One row: the pointing hero, then EVERYTHING else in the copy column
           (title, game, and the waiting line / accept button) so nothing floats
           off to the card edge on wide or narrow screens. -->
      <div class="wgc-announce">
        <animated-emoji emoji="🫵" large class="wgc-point" />
        <div class="wgc-copy">
          <span class="wgc-title">{{ isOwn ? 'You threw down a challenge' : `${authorName} throws down a challenge` }}</span>
          <span class="wgc-game">
            <animated-emoji emoji="🎲" />
            {{ module?.displayName ?? 'a game' }}
            <template v-if="themeName"> · {{ themeName }}</template>
          </span>
          <span v-if="isOwn" class="wgc-waiting">Waiting for a challenger…</span>
          <div v-else class="wgc-actions">
            <ion-button size="small" shape="round" @click.stop="onAccept">
              <animated-emoji emoji="💪" />&nbsp;I'm in
            </ion-button>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <game-bubble
        class="wgc-board"
        :game="session"
        :outgoing="isOwn"
        :self-id="selfId"
        :names="names"
        :followed="followed"
        @move="onMove"
        @resign="onResign"
        @rematch="onRematch"
        @follow="onFollow"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { IonButton } from '@ionic/vue';
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';
import GameBubble from '@/components/GameBubble.vue';
import { GAMES } from '@/games/registry';
import { challengePhase } from '@/games/challenge';
import { useLiveQuery } from '@/composables/useLiveQuery';
import {
  wallGameSession,
  acceptWallChallenge,
  playWallGameMove,
  resignWallGame,
  followGame,
  unfollowGame,
  followedGames,
  listContacts,
} from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import type { Contact } from '@/db/types';
import type { GameSession } from '@/games/types';

const props = defineProps<{
  postId: string;
  authorName: string;
  isOwn: boolean;
}>();

const router = useRouter();
const selfId = computed(() => getSelfUserId() ?? '');
// The derived session re-computes whenever the post or its engagement changes
// (live sync, the WS nudge, our own optimistic rows).
const session = useLiveQuery<GameSession | null>(
  () => wallGameSession(props.postId),
  ['posts', 'postEngagement'],
  null,
);
const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);
const follows = useLiveQuery(() => followedGames(), ['settings'], {} as Record<string, number>);

const module = computed(() => (session.value ? GAMES[session.value.gameType] ?? null : null));
const phase = computed(() => (session.value ? challengePhase(session.value) : 'open'));
const followed = computed(() => follows.value[props.postId] !== undefined);
const names = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const c of contacts.value) map[c.id] = c.name;
  return map;
});
const themeName = computed(
  () =>
    module.value?.themes.find((t) => t.id === session.value?.theme && t.id !== 'classic')?.name ?? '',
);

const onAccept = () => void acceptWallChallenge(props.postId);
const onMove = (mv: unknown) => void playWallGameMove(props.postId, mv);
const onResign = () => void resignWallGame(props.postId);
const onFollow = () => void (followed.value ? unfollowGame(props.postId) : followGame(props.postId));
// A Wall rematch is a fresh challenge POST — anyone may throw the next one.
const onRematch = () => void router.push('/wall/compose');
</script>

<style scoped>
.wgc {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 6px 0 2px;
}
.wgc-announce {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 28px; /* scales the large (2.6em) pointing hero */
}
.wgc-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-size: 15px;
}
.wgc-title {
  font-weight: 700;
  line-height: 1.25;
}
.wgc-game {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--app-text-muted);
}
.wgc-actions {
  display: flex;
  margin-top: 2px;
}
.wgc-actions ion-button {
  font-size: 14px;
  text-transform: none;
  margin-inline-start: 0;
}
.wgc-waiting {
  font-size: 13px;
  color: var(--app-text-muted);
}
.wgc-board {
  margin: 0 auto;
}
</style>
