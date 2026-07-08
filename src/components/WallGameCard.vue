<template>
  <!-- A Wall challenge post's live face (spec 0009 US3): the post IS the board.
       Open → the animated call-to-arms + I'm in; seated → the same GameBubble
       chats use (players named, observers read-only, result overlay), with a
       private Follow for spectators. Everything renders from the DERIVED
       session (wallGameSession replays the engagement rows), reactive via the
       idb bus — no state of its own. -->
  <div v-if="session" class="wgc">
    <!-- An OPEN challenge — for EVERY game, fullscreen or not — leads with the
         animated call-to-arms: the pointing hero calls out a rival, then the
         copy column (title, game, and the waiting line / accept button) so
         nothing floats off to the card edge on wide or narrow screens. -->
    <template v-if="phase === 'open'">
      <div class="wgc-announce">
        <animated-emoji emoji="🫵" large class="wgc-point" />
        <div class="wgc-copy">
          <span class="wgc-title">{{ isOwn ? 'You threw down a challenge' : `${authorName} throws down a challenge` }}</span>
          <span class="wgc-game">
            <animated-emoji :emoji="module?.card?.emoji ?? '🎲'" />
            {{ module?.displayName ?? 'a game' }}
            <template v-if="themeName"> · {{ themeName }}</template>
          </span>
          <span v-if="isOwn" class="wgc-waiting">Waiting for a challenger…</span>
          <div v-else class="wgc-actions">
            <ion-button size="small" shape="round" @click.stop="onAcceptChallenge">
              <animated-emoji emoji="💪" />&nbsp;I'm in
            </ion-button>
          </div>
        </div>
      </div>
    </template>

    <!-- Accepted / in-progress / finished. Fullscreen games (spec 1038) show the
         compact state card (entering goes through the app-global overlay);
         classic inline games render their board. -->
    <template v-else-if="module?.presentation === 'fullscreen'">
      <game-challenge-card
        :session="session"
        :me="fsSeat"
        :opponent-name="fsOpponentName"
        surface="wall"
        @open="onFsOpen"
      />
    </template>

    <template v-else>
      <game-bubble
        class="wgc-board"
        :game="session"
        :outgoing="isOwn"
        :self-id="selfId"
        :names="names"
        :avatars="avatars"
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
import GameChallengeCard from '@/components/GameChallengeCard.vue';
import { GAMES } from '@/games/registry';
import { challengePhase, playerIndexOf } from '@/games/challenge';
import { openGame } from '@/composables/useGameOverlay';
import { useLiveQuery } from '@/composables/useLiveQuery';
import {
  wallGameSession,
  wallGamePlayerMeta,
  acceptWallChallenge,
  playWallGameMove,
  resignWallGame,
  followWallGame,
  unfollowWallGame,
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
// Player display info carried SEALED with the game (spec 0009): names/avatars
// for players who aren't this viewer's contacts. Contacts override (fresher).
const meta = useLiveQuery(
  () => wallGamePlayerMeta(props.postId),
  ['posts', 'postEngagement'],
  {} as Record<string, { name?: string; avatar?: string }>,
);

const module = computed(() => (session.value ? GAMES[session.value.gameType] ?? null : null));
const phase = computed(() => (session.value ? challengePhase(session.value) : 'open'));
const followed = computed(() => follows.value[props.postId] !== undefined);
const names = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const [id, m] of Object.entries(meta.value)) if (m.name) map[id] = m.name;
  for (const c of contacts.value) map[c.id] = c.name;
  return map;
});
const avatars = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const [id, m] of Object.entries(meta.value)) if (m.avatar) map[id] = m.avatar;
  for (const c of contacts.value) if (c.avatar) map[c.id] = c.avatar;
  return map;
});
const themeName = computed(
  () =>
    module.value?.themes.find((t) => t.id === session.value?.theme && t.id !== 'classic')?.name ?? '',
);

const onAccept = () => void acceptWallChallenge(props.postId);
// "I'm in" from the call-to-arms: a fullscreen game accepts AND drops the new
// rival straight into deployment (via the overlay); a classic game accepts and
// the board renders inline.
function onAcceptChallenge(): void {
  if (module.value?.presentation === 'fullscreen') void onFsOpen();
  else onAccept();
}
const onMove = (mv: unknown) => void playWallGameMove(props.postId, mv);
const onResign = () => void resignWallGame(props.postId);
const onFollow = () =>
  void (followed.value ? unfollowWallGame(props.postId) : followWallGame(props.postId));
// A Wall rematch is a fresh challenge POST — anyone may throw the next one.
const onRematch = () => void router.push('/wall/compose');

/* ---- fullscreen presentation (spec 1038) ---- */
const fsSeat = computed<0 | 1 | null>(() =>
  session.value ? playerIndexOf(session.value, selfId.value) : null,
);
const fsOpponentName = computed(() => {
  const s = session.value;
  if (!s) return props.authorName;
  const other = s.players?.find((id) => id !== selfId.value);
  return (other && names.value[other]) || props.authorName;
});
/** Accept-and-deploy in one tap (spec US3): the seat race settles while the
 *  acceptor authors their fleet; a lost race surfaces in the overlay. */
async function onFsOpen(): Promise<void> {
  const s = session.value;
  if (!s) return;
  if (challengePhase(s) === 'open' && !props.isOwn && fsSeat.value === null) {
    await acceptWallChallenge(props.postId);
  }
  openGame({ surface: 'wall', postId: props.postId, gameType: s.gameType });
}
</script>

<style scoped>
.wgc {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Same horizontal inset as the post body (.body margin 14px) — the game card
     is post CONTENT, it must not run flush to the card edges. */
  margin: 6px 14px 2px;
}
.wgc-announce {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 28px; /* scales the large (2.6em) pointing hero */
  /* Shrink to content + left-align (like the post body) so on a wide iPad the
     hero + copy stay grouped instead of clustering with a huge empty right. */
  width: fit-content;
  max-width: 100%;
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
