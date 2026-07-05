<template>
  <!-- The wall game's story in numbers (spec 0009, mirroring the chat's Message
       info Game section): derived purely from the session the engagement rows
       replay to — nothing extra crosses the wire. Rendered on the post detail
       page once someone has taken the seat. -->
  <ion-list v-if="session && stats && seated" :inset="true" class="wgs">
    <ion-list-header>
      <animated-emoji emoji="🎲" />
      <ion-label>{{ module?.displayName ?? 'Game' }}</ion-label>
    </ion-list-header>
    <ion-item lines="inset">
      <ion-label>Players</ion-label>
      <ion-note slot="end" class="wgs-vs">
        <game-mark :mark="theme?.marks?.[0]" :player="0" />
        {{ seatName(0) }} vs {{ seatName(1) }}
        <game-mark :mark="theme?.marks?.[1]" :player="1" />
      </ion-note>
    </ion-item>
    <ion-item v-if="theme && theme.id !== 'classic'" lines="inset">
      <ion-label>Style</ion-label>
      <ion-note slot="end">{{ theme.name }}</ion-note>
    </ion-item>
    <ion-item lines="inset">
      <ion-label>Result</ion-label>
      <ion-note slot="end" class="wgs-vs">
        <animated-emoji v-if="resultEmoji" :emoji="resultEmoji" />
        {{ resultLine }}
      </ion-note>
    </ion-item>
    <ion-item v-if="stats.startedAt" lines="inset">
      <ion-label>Started</ion-label>
      <ion-note slot="end">{{ formatTime(stats.startedAt) }}</ion-note>
    </ion-item>
    <ion-item v-if="stats.durationMs != null" lines="inset">
      <ion-label>Game time</ion-label>
      <ion-note slot="end">{{ durLabel(stats.durationMs) }}</ion-note>
    </ion-item>
    <ion-item lines="inset">
      <ion-label>Moves</ion-label>
      <ion-note slot="end">{{ stats.moveCount }}</ion-note>
    </ion-item>
    <ion-item v-for="p in [0, 1] as const" v-show="stats.players[p].avgReplyMs != null" :key="p" lines="inset">
      <ion-label>{{ seatName(p) === 'You' ? 'Your average move' : `${seatName(p)}'s average move` }}</ion-label>
      <ion-note slot="end">{{ stats.players[p].avgReplyMs != null ? durLabel(stats.players[p].avgReplyMs!) : '' }}</ion-note>
    </ion-item>
    <ion-item v-if="fastest" lines="none">
      <ion-label>Fastest move</ion-label>
      <ion-note slot="end" class="wgs-vs">
        <animated-emoji emoji="⚡" />
        {{ durLabel(fastest.ms) }} by {{ fastest.who }}
      </ion-note>
    </ion-item>
  </ion-list>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonList, IonListHeader, IonItem, IonLabel, IonNote } from '@ionic/vue';
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';
import GameMark from '@/components/GameMark.vue';
import { GAMES } from '@/games/registry';
import { computeGameStats } from '@/games/stats';
import { deriveStatus } from '@/games/session';
import { challengePhase, playerIndexOf } from '@/games/challenge';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { wallGameSession, listContacts } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import type { Contact } from '@/db/types';
import type { GameSession, GameTheme } from '@/games/types';

const props = defineProps<{ postId: string }>();

const session = useLiveQuery<GameSession | null>(
  () => wallGameSession(props.postId),
  ['posts', 'postEngagement'],
  null,
);
const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);

const selfId = computed(() => getSelfUserId() ?? '');
const module = computed(() => (session.value ? GAMES[session.value.gameType] ?? null : null));
const seated = computed(() => !!session.value && challengePhase(session.value) === 'accepted');
const stats = computed(() => (session.value ? computeGameStats(module.value, session.value) : null));
const status = computed(() => (session.value ? deriveStatus(module.value, session.value) : null));
const theme = computed<GameTheme | null>(() => {
  const list = module.value?.themes ?? [];
  return list.find((t) => t.id === session.value?.theme) ?? list[0] ?? null;
});
const me = computed(() => (session.value ? playerIndexOf(session.value, selfId.value) : null));

const seatName = (idx: 0 | 1): string => {
  const uid = session.value?.players?.[idx];
  if (uid && uid === selfId.value) return 'You';
  return (contacts.value.find((c) => c.id === uid)?.name ?? 'Someone').split(' ')[0];
};

const resultLine = computed((): string => {
  const s = status.value;
  if (!s) return '';
  switch (s.state) {
    case 'ongoing':
      return s.turn === me.value ? 'Your move' : `${seatName(s.turn)}'s move`;
    case 'won':
      return s.winner === me.value ? 'You won' : `${seatName(s.winner)} won`;
    case 'draw':
      return 'Draw';
    case 'resigned': {
      const loser = (1 - s.winner) as 0 | 1;
      return loser === me.value ? 'You gave up' : `${seatName(loser)} gave up`;
    }
    case 'out-of-sync':
      return 'Out of sync';
  }
  return '';
});
const resultEmoji = computed((): string => {
  const s = status.value;
  if (!s) return '';
  if (s.state === 'ongoing') return s.turn === me.value ? '🎲' : '⏳';
  if (s.state === 'won' || s.state === 'resigned') {
    if (me.value === null) return '🏆';
    return s.winner === me.value ? '🏆' : '🥈';
  }
  if (s.state === 'draw') return '🤝';
  if (s.state === 'out-of-sync') return '😵';
  return '';
});

const fastest = computed((): { ms: number; who: string } | null => {
  if (!stats.value) return null;
  const a = stats.value.players[0].fastestReplyMs;
  const b = stats.value.players[1].fastestReplyMs;
  if (a == null && b == null) return null;
  const idx: 0 | 1 = b == null || (a != null && a <= b) ? 0 : 1;
  return { ms: stats.value.players[idx].fastestReplyMs!, who: seatName(idx) };
});

function durLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
const formatTime = (ts: number): string =>
  new Date(ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
</script>

<style scoped>
.wgs-vs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
