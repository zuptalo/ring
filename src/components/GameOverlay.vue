<template>
  <!-- The fullscreen game host (spec 1038 FR-006). Mounted once in App.vue,
       above MinimizedCall (15000) and BELOW the notification banners (19000),
       so other chats' toasts render over the game and stay tappable (FR-007).
       The launching surface stays mounted underneath: exiting is literally
       removing this element. -->
  <div v-if="overlayOpen && overlayGame" class="game-overlay" role="dialog" aria-label="Game">
    <header class="go-header">
      <ion-button fill="clear" class="go-exit" aria-label="Leave the game" @click="closeGame()">
        <ion-icon slot="icon-only" :icon="chevronDownOutline" />
      </ion-button>
      <div class="go-title-block">
        <div class="go-title">{{ title }}</div>
        <div class="go-subtitle">{{ subtitle }}</div>
      </div>
      <!-- Mute toggles the SAME switch as Settings → Notifications → Game
           sounds (the one gate every cue already respects), so it stays in
           sync with the settings screen in both directions. -->
      <ion-button
        fill="clear"
        class="go-mute"
        :aria-label="soundsOn ? 'Mute game sounds' : 'Unmute game sounds'"
        @click="toggleSounds"
      >
        <ion-icon slot="icon-only" :icon="soundsOn ? volumeHighOutline : volumeMuteOutline" />
      </ion-button>
      <span class="go-pill">{{ overlayGame.surface === 'wall' ? 'WALL' : '1:1' }}</span>
    </header>

    <div class="go-body">
      <div v-if="gone" class="go-gone">
        <p>{{ goneReason }}</p>
        <ion-button size="small" @click="closeGame()">Back to Ring</ion-button>
      </div>
      <component
        :is="boardComponent"
        v-else-if="boardComponent && session && me !== null"
        :state="boardState"
        :my-player="me"
        :can-move="canMove"
        :last-move="null"
        :session-key="sessionKey"
        :session-status="sessionStatus"
        @move="onMove"
        @leave="closeGame()"
        @rematch="onRematch"
        @resign="onResign"
      />
      <div v-else class="go-gone">
        <p>This game needs a newer version of Ring.</p>
        <ion-button size="small" @click="closeGame()">Back to Ring</ion-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { IonButton, IonIcon, alertController } from '@ionic/vue';
import { chevronDownOutline, volumeHighOutline, volumeMuteOutline } from 'ionicons/icons';
import { GAMES } from '@/games/registry';
import { GAME_BOARDS } from '@/games/boards';
import { replayState, localMoveAllowed, deriveStatus } from '@/games/session';
import { playerIndexOf, challengePhase } from '@/games/challenge';
import type { GameSession } from '@/games/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { overlayGame, overlayOpen, closeGame, gameSessionKey } from '@/composables/useGameOverlay';
import { useKeyGuard } from '@/composables/useKeyGuard';
import { getChat, getMessage, getSetting, setSetting, wallGameSession, playGameMove, playWallGameMove, resignGame, resignWallGame, sendGame } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import { openGame } from '@/composables/useGameOverlay';

interface Loaded {
  session: GameSession | null;
  me: 0 | 1 | null;
  subtitle: string;
  gone: boolean;
  goneReason: string;
}

const EMPTY: Loaded = { session: null, me: null, subtitle: '', gone: false, goneReason: '' };

// The live session behind the overlay: message row (chat) or derived wall
// session — inbound moves repaint the board through the same stores the rest
// of the app watches.
const loaded = useLiveQuery<Loaded>(
  async () => {
    const g = overlayGame.value;
    if (!g) return EMPTY;
    if (g.surface === 'chat') {
      const m = await getMessage(g.messageId);
      if (!m?.game || m.deleted) {
        return { ...EMPTY, gone: true, goneReason: 'This game is no longer in the chat.' };
      }
      const chat = await getChat(m.chatId);
      const me = m.game.players
        ? playerIndexOf(m.game, getSelfUserId() ?? '')
        : ((m.outgoing ? 0 : 1) as 0 | 1);
      return {
        session: m.game,
        me,
        subtitle: chat?.name ? `Naval duel · vs ${chat.name}` : 'Naval duel',
        gone: false,
        goneReason: '',
      };
    }
    const session = await wallGameSession(g.postId);
    if (!session) return { ...EMPTY, gone: true, goneReason: 'This challenge post is gone.' };
    const me = playerIndexOf(session, getSelfUserId() ?? '');
    // Seat race lost mid-deployment (spec §Edge Cases): the seats locked to
    // someone else — a clear notice instead of a board.
    const seated = challengePhase(session) === 'accepted';
    if (seated && me === null) {
      return { ...EMPTY, gone: true, goneReason: 'Someone else took the seat first. Next battle is yours.' };
    }
    return { session, me, subtitle: 'Open challenge · from the Wall', gone: false, goneReason: '' };
  },
  ['messages', 'posts', 'postEngagement', 'chats'],
  EMPTY,
  () => overlayGame.value,
);

const session = computed(() => loaded.value.session);
const me = computed(() => loaded.value.me);
const gone = computed(() => loaded.value.gone);
const goneReason = computed(() => loaded.value.goneReason);
const subtitle = computed(() => loaded.value.subtitle);

const module = computed(() => (overlayGame.value ? GAMES[overlayGame.value.gameType] ?? null : null));
const boardComponent = computed(() => (overlayGame.value ? GAME_BOARDS[overlayGame.value.gameType] ?? null : null));
const title = computed(() => (module.value?.displayName ?? 'Game').toUpperCase());
const sessionKey = computed(() => (overlayGame.value ? gameSessionKey(overlayGame.value) : ''));

const boardState = computed(() =>
  module.value && session.value ? replayState(module.value, session.value) : module.value?.createInitialState(),
);
const canMove = computed(() =>
  module.value && session.value && me.value !== null
    ? localMoveAllowed(module.value, session.value, me.value)
    : false,
);
// Session-level verdict for the board (resignation/out-of-sync are invisible
// to the replayed protocol state).
const sessionStatus = computed(() =>
  module.value && session.value ? deriveStatus(module.value, session.value) : null,
);

function onMove(move: unknown): void {
  const g = overlayGame.value;
  if (!g) return;
  if (g.surface === 'chat') void playGameMove(g.chatId, g.messageId, move);
  else void playWallGameMove(g.postId, move);
}

// Rematch from the medal ceremony: in a chat, start the successor game right
// here (the finished session freed the one-game-per-chat gate); on the wall a
// rematch is a fresh post — return to the surface to throw it.
async function onRematch(): Promise<void> {
  const g = overlayGame.value;
  if (!g) return;
  if (g.surface !== 'chat') {
    closeGame();
    return;
  }
  const gt = GAMES[g.gameType]?.successor ?? g.gameType;
  try {
    const messageId = await sendGame(g.chatId, gt);
    openGame({ surface: 'chat', chatId: g.chatId, messageId, gameType: gt });
  } catch {
    closeGame();
  }
}

// Game-sounds mute (the header toggle) — live-bound to the settings row so a
// change made on the settings screen shows here too.
const soundsSetting = useLiveQuery<boolean>(
  () => getSetting('notifications.gameSounds', true),
  ['settings'],
  true,
);
const soundsOn = computed(() => soundsSetting.value);
function toggleSounds(): void {
  void setSetting('notifications.gameSounds', !soundsOn.value);
}

// Surrender (the board's control): a deliberate, confirmed end — the win goes
// to the opponent. A game nobody has really started (no commits yet) reads as
// a WITHDRAWN challenge instead: the resigner's overlay simply closes and the
// card carries the "withdrawn" line.
async function onResign(): Promise<void> {
  const g = overlayGame.value;
  const s = session.value;
  if (!g || !s) return;
  const untouched = s.moves.length === 0;
  const alert = await alertController.create({
    header: untouched ? 'Withdraw this challenge?' : 'Surrender this battle?',
    message: untouched ? 'The game ends before it begins.' : 'Your opponent takes the win.',
    buttons: [
      { text: 'Keep playing', role: 'cancel' },
      {
        text: untouched ? 'Withdraw' : 'Surrender',
        role: 'destructive',
        handler: () => {
          void (async () => {
            if (g.surface === 'chat') await resignGame(g.chatId, g.messageId);
            else await resignWallGame(g.postId);
            if (untouched) closeGame(); // nothing to ceremonize — the card says withdrawn
          })();
        },
      },
    ],
  });
  await alert.present();
}

// The key gate (app lock) sits at a LOWER z-index than this overlay — locking
// must therefore close the game view (the session is untouched; the pill
// brings the player back after unlock).
const { showGate } = useKeyGuard();
watch(showGate, (locked) => {
  if (locked && overlayOpen.value) closeGame();
});
</script>

<style scoped>
.game-overlay {
  position: fixed;
  inset: 0;
  z-index: 16000; /* above MinimizedCall (15000), below NotificationBanners (19000) */
  display: flex;
  flex-direction: column;
  overflow: hidden; /* nothing inside may widen or pan the overlay itself */
  overscroll-behavior: none;
  background: radial-gradient(900px 500px at 50% -8%, #18221c 0%, #111814 48%, #0b0f0d 100%);
  color: #e9f5ee;
  animation: go-in 0.3s ease-out;
}
.go-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}
.go-exit {
  --color: #e6f4ec;
  --border-radius: 12px;
  --padding-start: 0;
  --padding-end: 0;
  width: 40px;
  height: 40px;
  margin: 0;
  border: 1px solid rgba(110, 231, 183, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
}
.go-title-block {
  min-width: 0;
  flex: 1;
}
.go-mute {
  --color: #e6f4ec;
  --border-radius: 12px;
  --padding-start: 0;
  --padding-end: 0;
  width: 40px;
  height: 40px;
  margin: 0;
  border: 1px solid rgba(110, 231, 183, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
}
.go-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 2px;
}
.go-subtitle {
  font-size: 12px;
  color: rgba(220, 240, 230, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.go-pill {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: rgba(110, 231, 183, 0.7);
  border: 1px solid rgba(110, 231, 183, 0.22);
  padding: 4px 9px;
  border-radius: 8px;
  flex-shrink: 0;
}
.go-body {
  flex: 1;
  /* Vertical scroll ONLY. The board's effect layers (smoke columns, radar,
     drag shadows) are absolutely positioned and can poke past the right edge;
     without the x-clamp iOS lets the whole game pan sideways. touch-action
     pan-y kills the horizontal gesture at the source (ship dragging still
     works — the ships opt out with their own touch-action: none), and
     overscroll-behavior stops the rubber-band from chaining to the page. */
  overflow-x: hidden;
  overflow-y: auto;
  touch-action: pan-y;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 6px 12px calc(env(safe-area-inset-bottom, 0px) + 36px);
}
.go-gone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 24px;
  text-align: center;
  color: rgba(220, 226, 245, 0.7);
  font-size: 14px;
}
@keyframes go-in {
  0% { opacity: 0; transform: translateY(14px); }
  100% { opacity: 1; transform: translateY(0); }
}
</style>
