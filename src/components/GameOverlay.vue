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
        :opponent-name="opponentName"
        :opponent-avatar="opponentAvatar"
        :self-avatar="selfAvatar"
        :opponent-in-game="opponentInGame"
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
import { computed, watch, onUnmounted } from 'vue';
import { IonButton, IonIcon, alertController } from '@ionic/vue';
import { chevronDownOutline, volumeHighOutline, volumeMuteOutline } from 'ionicons/icons';
import { GAMES } from '@/games/registry';
import { GAME_BOARDS } from '@/games/boards';
import { replayState, localMoveAllowed, deriveStatus } from '@/games/session';
import { hasActivity } from '@/composables/useTyping';
import { startGamePresence, stopGamePresence } from '@/services/game-presence';
import { playerIndexOf, challengePhase } from '@/games/challenge';
import type { GameSession } from '@/games/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { overlayGame, overlayOpen, closeGame, gameSessionKey } from '@/composables/useGameOverlay';
import { useKeyGuard } from '@/composables/useKeyGuard';
import { getChat, getMessage, getSetting, setSetting, wallGameSession, playGameMove, playWallGameMove, resignGame, resignWallGame, sendGame, findOngoingGame } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import { appToast } from '@/services/toast';
import { openGame } from '@/composables/useGameOverlay';
import { useSelfProfile } from '@/composables/useSelfProfile';

interface Loaded {
  session: GameSession | null;
  me: 0 | 1 | null;
  subtitle: string;
  /** Opponent display name for boards that show it (chess panels). 1:1 chat
   *  only; absent on wall/group where no single peer name is at hand. */
  opponentName?: string;
  /** Opponent avatar (data-URL) for boards that show faces. 1:1 chat only. */
  opponentAvatar?: string;
  /** Opponent userId — the peer we exchange in-game presence with. Absent for
   *  spectators or an unseated challenge (nobody to be present against). */
  opponentId?: string;
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
      // Flavor tag from the game's own card copy ("Naval duel" / "Chess match"),
      // falling back to its display name.
      const mod = GAMES[g.gameType];
      const tag = mod?.card?.tagline ?? mod?.displayName ?? 'Game';
      // The peer we track presence with: the other seat in an explicit-players
      // (challenge) session, else the 1:1 chat's single peer.
      const opponentId =
        m.game.players
          ? me !== null && m.game.players.length === 2
            ? m.game.players[1 - me]
            : undefined
          : chat?.participantIds?.[0];
      return {
        session: m.game,
        me,
        subtitle: chat?.name ? `${tag} · vs ${chat.name}` : tag,
        opponentName: chat?.name,
        opponentAvatar: chat?.avatar,
        opponentId,
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
    const opponentId = me !== null && session.players?.length === 2 ? session.players[1 - me] : undefined;
    return { session, me, subtitle: 'Open challenge · from the Wall', opponentId, gone: false, goneReason: '' };
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
const opponentName = computed(() => loaded.value.opponentName);
const opponentAvatar = computed(() => loaded.value.opponentAvatar);
const opponentId = computed(() => loaded.value.opponentId);
// The local user's own avatar (data-URL) for the "you" seat on the board.
const { avatar: selfAvatar } = useSelfProfile();

const module = computed(() => (overlayGame.value ? GAMES[overlayGame.value.gameType] ?? null : null));
const boardComponent = computed(() => (overlayGame.value ? GAME_BOARDS[overlayGame.value.gameType] ?? null : null));
const title = computed(() => (module.value?.displayName ?? 'Game').toUpperCase());
const sessionKey = computed(() => (overlayGame.value ? gameSessionKey(overlayGame.value) : ''));

// "In this game right now": is the opponent currently viewing THIS session's
// board? Reactive read of the ephemeral activity store, keyed by session key —
// self-clears ~6s after their last heartbeat (they left / backgrounded).
const opponentInGame = computed(() =>
  !!opponentId.value && !!sessionKey.value && hasActivity(sessionKey.value, opponentId.value, 'in-game'),
);

// Announce our own presence to the opponent while the board is actually open
// (minimizing to the pill or closing stops it — the honest "I'm here" signal).
watch(
  [overlayOpen, sessionKey, opponentId],
  ([open, key, opp]) => {
    if (open && key && opp) startGamePresence(key, opp);
    else stopGamePresence();
  },
  { immediate: true },
);
onUnmounted(stopGamePresence);

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

// Rematch from the medal ceremony. One game at a time in a 1:1 chat: if a game
// is already ongoing (the peer rematched first, or a stray double-tap), JOIN it
// instead of spawning a second — a rematch race must never leave two live games
// in the chat. Otherwise start the successor here (the finished session freed
// the gate). On the wall a rematch is a fresh post — return to throw it.
async function onRematch(): Promise<void> {
  const g = overlayGame.value;
  if (!g) return;
  if (g.surface !== 'chat') {
    closeGame();
    return;
  }
  const existing = await findOngoingGame(g.chatId);
  if (existing) {
    // A new game is already waiting (ours or theirs) — go straight into it.
    openGame({ surface: 'chat', chatId: g.chatId, messageId: existing.messageId, gameType: existing.gameType });
    void appToast({ message: 'A new game is already waiting — jump in!', duration: 2000 });
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
  animation: go-in 0.3s ease-out;

  /* Shared "game UI kit" tokens (spec: unified fullscreen-game theme). Defined
     here on the overlay and INHERITED by both boards — CSS custom properties
     pierce scoped-style boundaries — so chess and Armada draw their buttons,
     surfaces, text, and accents from one source of truth.

     The surface FOLLOWS THE APP THEME: light values by default, dark values
     under :root.ion-palette-dark below. The game BOARDS themselves (chess
     squares, Armada's radar) keep their own fixed palette — a board is its own
     object — but everything AROUND them (chrome, buttons, panels, text) flips
     with the system light/dark theme like the rest of the app. */
  --g-text: #10241b;
  --g-text-dim: rgba(16, 36, 27, 0.64);
  --g-text-faint: rgba(16, 36, 27, 0.45);
  --g-surface: rgba(16, 120, 90, 0.07);
  --g-surface-strong: rgba(16, 120, 90, 0.12);
  --g-panel: #ffffff; /* opaque panel/card fill */
  --g-border: rgba(16, 36, 27, 0.12);
  --g-border-accent: rgba(16, 185, 129, 0.32);
  --g-accent: #10b981; /* Ring emerald — the one brand color */
  --g-accent-bright: #10b981;
  --g-accent-soft: #0a7d59; /* legible emerald for text on a LIGHT surface */
  --g-on-accent: #ffffff;
  --g-danger: #d33a4a;
  --g-danger-border: rgba(211, 58, 74, 0.4);
  --g-warn: #b07d00; /* dark amber, legible on a light surface */
  --g-radius: 16px;
  --g-radius-sm: 12px;
  --g-pill: 999px;
  --g-shadow-card: 0 22px 55px rgba(16, 40, 28, 0.22);

  /* Light emerald wash — mirrors the app's own --app-bg-gradient personality. */
  background: linear-gradient(165deg, rgba(16, 185, 129, 0.14), rgba(16, 185, 129, 0.03) 70%), #ffffff;
  color: var(--g-text);
}
:root.ion-palette-dark .game-overlay {
  --g-text: #e9f5ee;
  --g-text-dim: rgba(223, 240, 232, 0.62);
  --g-text-faint: rgba(223, 240, 232, 0.42);
  --g-surface: rgba(255, 255, 255, 0.05);
  --g-surface-strong: rgba(255, 255, 255, 0.08);
  --g-panel: #161d19;
  --g-border: rgba(255, 255, 255, 0.1);
  --g-border-accent: rgba(110, 231, 183, 0.24);
  --g-accent-bright: #2fd27f;
  --g-accent-soft: #57e0a0;
  --g-on-accent: #04120c;
  --g-danger: #ff8a97;
  --g-danger-border: rgba(235, 68, 90, 0.4);
  --g-warn: #ffc409;
  --g-shadow-card: 0 24px 60px rgba(0, 0, 0, 0.5);
  background: radial-gradient(900px 500px at 50% -8%, #18221c 0%, #111814 48%, #0b0f0d 100%);
}
.go-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px;
  border-bottom: 1px solid var(--g-border);
  flex-shrink: 0;
}
.go-exit {
  --color: var(--g-text);
  --border-radius: 12px;
  --padding-start: 0;
  --padding-end: 0;
  width: 40px;
  height: 40px;
  margin: 0;
  border: 1px solid var(--g-border-accent);
  border-radius: 12px;
  background: var(--g-surface);
  flex-shrink: 0;
}
.go-title-block {
  min-width: 0;
  flex: 1;
}
.go-mute {
  --color: var(--g-text);
  --border-radius: 12px;
  --padding-start: 0;
  --padding-end: 0;
  width: 40px;
  height: 40px;
  margin: 0;
  border: 1px solid var(--g-border-accent);
  border-radius: 12px;
  background: var(--g-surface);
  flex-shrink: 0;
}
.go-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 2px;
}
.go-subtitle {
  font-size: 12px;
  color: var(--g-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.go-pill {
  height: 40px; /* match the exit/mute buttons beside it */
  display: flex;
  align-items: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--g-accent-soft);
  border: 1px solid var(--g-border-accent);
  background: var(--g-surface);
  padding: 0 12px;
  border-radius: 12px;
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
