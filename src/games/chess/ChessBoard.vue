<template>
  <!-- Chess (design_handoff_chess/Chess.reference.dc.html is the visual spec).
       Hosted by the fullscreen GameOverlay, never inline. The overlay owns the
       app-bar (exit / title / mute); this board renders the game surface only.
       No protocol bookkeeping — chess is perfect-information and strictly
       alternating, so every action is a direct wire move (including the three
       draw-negotiation moves offer/accept/decline). The board squares keep the
       handoff's fixed palette (a board is its own object, theme-independent);
       the surrounding chrome matches the overlay's dark surface. -->
  <div class="chess">
    <!-- board-local seat line (the overlay owns back/title/mute; the board is
         always oriented to YOUR side, so there's no flip control). -->
    <div class="ch-bar">
      <span class="ch-seat">{{ seatText }}</span>
    </div>

    <!-- Opponent panel -->
    <div class="ch-player">
      <div class="ch-avatar opp">
        <img v-if="opponentAvatar" class="ch-avatar-img" :src="opponentAvatar" :alt="oppName" />
        <span v-else>{{ oppInitial }}</span>
        <!-- Live presence badge: filled green when they're viewing THIS game
             right now, hollow/grey when they've left. Distinct from the turn
             dot (which says whose move it is). -->
        <span class="ch-presence" :class="{ on: opponentInGame }" :title="presenceTitle" aria-hidden="true" />
      </div>
      <div class="ch-pinfo">
        <div class="ch-prow">
          <span class="ch-name">{{ oppName }}</span>
          <span class="ch-chip">{{ oppColorLabel }}</span>
          <span class="ch-presence-text" :class="{ on: opponentInGame }">{{ presenceTitle }}</span>
          <span v-if="oppActive" class="ch-dot" aria-hidden="true" />
        </div>
        <div class="ch-tray">
          <span v-for="(gph, i) in oppCaptured" :key="i" class="ch-cap">{{ gph }}</span>
          <span v-if="oppMaterial" class="ch-material">{{ oppMaterial }}</span>
        </div>
      </div>
    </div>

    <!-- Board -->
    <div class="ch-boardwrap">
      <div class="ch-board" :style="boardStyle">
        <button
          v-for="sq in squares"
          :key="sq.key"
          type="button"
          class="ch-sq"
          :aria-label="sq.aria"
          @click="onSquare(sq.r, sq.c)"
        >
          <span class="ch-base" :style="{ background: sq.light ? LIGHT : DARK }" aria-hidden="true" />
          <span v-if="sq.last" class="ch-ov" :style="{ background: LAST }" aria-hidden="true" />
          <span v-if="sq.check" class="ch-ov" :style="{ background: CHECK }" aria-hidden="true" />
          <span v-if="sq.selected" class="ch-ov ch-selring" aria-hidden="true" />
          <span v-if="sq.showRank" class="ch-coord ch-rank" aria-hidden="true">{{ sq.rankLabel }}</span>
          <span v-if="sq.showFile" class="ch-coord ch-file" aria-hidden="true">{{ sq.fileLabel }}</span>
          <span v-if="sq.dot" class="ch-move-dot" :style="{ background: sq.light ? DOT_L : DOT_D }" aria-hidden="true" />
          <span v-if="sq.ring" class="ch-move-ring" :style="{ borderColor: sq.light ? RING_L : RING_D }" aria-hidden="true" />
          <span v-if="sq.glyph" class="ch-piece" :class="sq.white ? 'w' : 'b'">{{ sq.glyph }}</span>
        </button>
      </div>
    </div>

    <!-- You panel -->
    <div class="ch-player">
      <div class="ch-avatar you">
        <img v-if="selfAvatar" class="ch-avatar-img" :src="selfAvatar" alt="You" />
        <span v-else>{{ youInitial }}</span>
      </div>
      <div class="ch-pinfo">
        <div class="ch-prow">
          <span class="ch-name">{{ youName }}</span>
          <span class="ch-chip">{{ youColorLabel }}</span>
          <span v-if="youActive" class="ch-dot" aria-hidden="true" />
        </div>
        <div class="ch-tray">
          <span v-for="(gph, i) in youCaptured" :key="i" class="ch-cap">{{ gph }}</span>
          <span v-if="youMaterial" class="ch-material">{{ youMaterial }}</span>
        </div>
      </div>
    </div>

    <!-- Status. When the game ends there is NO covering ceremony (the board
         stays visible for review, the controls below already carry Rematch /
         Leave) — the final result reads right here instead. -->
    <div v-if="over" class="ch-status ch-final">
      <span class="ch-final-icon" aria-hidden="true">{{ overIcon }}</span>
      <span class="ch-final-text">
        <b>{{ overTitle }}</b>
        <span class="ch-final-sub">{{ overSub }}</span>
      </span>
    </div>
    <div v-else class="ch-status">{{ statusText }}</div>

    <!-- Incoming draw offer — kept above the controls so its Accept/Decline is
         always in view without scrolling (a mid-board offer, mobile especially). -->
    <div v-if="theyOfferedDraw && !over" class="ch-drawbar">
      <span class="ch-drawtext">{{ oppName }} offers a draw</span>
      <button type="button" class="ch-mini" @click="emitMove({ t: 'decline' })">Decline</button>
      <button type="button" class="ch-mini primary" @click="emitMove({ t: 'accept' })">Accept</button>
    </div>

    <!-- Controls -->
    <div class="ch-controls">
      <template v-if="!over">
        <button type="button" class="ch-btn" @click="onResign">Resign</button>
        <button type="button" class="ch-btn" :disabled="!canOfferDraw" @click="emitMove({ t: 'offer' })">
          {{ iOfferedDraw ? 'Draw offered…' : 'Offer draw' }}
        </button>
      </template>
      <template v-else>
        <button type="button" class="ch-btn primary" @click="$emit('rematch')">Rematch</button>
        <button type="button" class="ch-btn" @click="$emit('leave')">Leave</button>
      </template>
    </div>

    <!-- Promotion chooser -->
    <div v-if="promo" class="ch-modal">
      <div class="ch-card">
        <div class="ch-card-title">Promote to</div>
        <div class="ch-promos">
          <button v-for="pt in (['q', 'r', 'b', 'n'] as const)" :key="pt" type="button" class="ch-promo" @click="promoteTo(pt)">
            {{ TGLYPH[pt] }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GameSessionStatus } from '@/games/types';
import { GLYPH, VALUES, color as pieceColor, type as pieceType, inCheck, findKing, legalMoves, type PieceType, type Square } from './engine';
import { colorOf, type ChessState, type ChessMove } from './logic';

const props = defineProps<{
  state: ChessState;
  myPlayer: 0 | 1;
  canMove: boolean;
  /** Overlay passes null for every game; we use state.lastMove instead. */
  lastMove?: unknown;
  sessionKey?: string;
  sessionStatus?: GameSessionStatus | null;
  /** Opponent display name (1:1 chat); absent ⇒ a generic label. */
  opponentName?: string;
  /** Opponent + self avatars (data-URLs) for the seat faces; fall back to an initial. */
  opponentAvatar?: string;
  selfAvatar?: string;
  /** True while the opponent has this game's board open right now (live). */
  opponentInGame?: boolean;
}>();

const emit = defineEmits<{
  (e: 'move', move: ChessMove): void;
  (e: 'leave'): void;
  (e: 'rematch'): void;
  (e: 'resign'): void;
}>();

// Fixed board palette from the handoff — deliberately theme-independent.
const LIGHT = '#EAEFE6';
const DARK = '#4A9E7C';
const LAST = 'rgba(240,196,74,.34)';
const CHECK = 'rgba(214,64,64,.5)';
const DOT_L = 'rgba(20,50,35,.22)';
const DOT_D = 'rgba(255,255,255,.34)';
const RING_L = 'rgba(20,50,35,.28)';
const RING_D = 'rgba(255,255,255,.42)';
const FILES = 'abcdefgh';

// Force TEXT (not emoji) presentation of the piece glyphs. The board uses the
// filled Unicode set for both sides and tells them apart by CSS color; but
// several platforms — iOS/Safari notably — render the pawn ♟ (U+265F, and
// sometimes others) as a COLOR EMOJI, which ignores our color and paints
// White's pawns black (a row of white + a row of black). Appending U+FE0E (the
// text variation selector) pins the monochrome text form so color wins. Widely
// supported, unlike the newer font-variant-emoji.
const VS_TEXT = '\uFE0E'; // U+FE0E text variation selector
const TGLYPH = Object.fromEntries(
  (Object.keys(GLYPH) as PieceType[]).map((k) => [k, GLYPH[k] + VS_TEXT]),
) as Record<PieceType, string>;

const g = computed(() => props.state.game);
const myColor = computed(() => colorOf(props.myPlayer));
const oppColor = computed(() => (myColor.value === 'w' ? 'b' : 'w'));
const oppPlayer = computed(() => (props.myPlayer === 0 ? 1 : 0));

// --- Terminal / result (session-level: covers resign + out-of-sync too) ---
const ss = computed(() => props.sessionStatus ?? null);
const over = computed(() => !!ss.value && ss.value.state !== 'ongoing');

// --- Draw negotiation (modeled as moves; state carries the pending offer) ---
const pendingDraw = computed(() => props.state.drawOffer);
const iOfferedDraw = computed(() => pendingDraw.value === props.myPlayer);
const theyOfferedDraw = computed(() => pendingDraw.value !== null && pendingDraw.value === oppPlayer.value);
// I can move a piece only when it's my turn AND no draw is awaiting a response.
const canPlay = computed(() => props.canMove && pendingDraw.value === null && !over.value);
const canOfferDraw = computed(() => canPlay.value && !iOfferedDraw.value);

const check = computed(() => !over.value && inCheck(g.value.board, g.value.turn));

// --- Local, un-synced UI state ---
// The board is ALWAYS drawn from your own side — your pieces at the bottom, as
// if you're sitting at the board — so there's no flip control and no confusion.
// (White is always player 0, the one who started the game.)
const flipped = computed(() => props.myPlayer === 1);
const selected = ref<Square | null>(null);
const targets = ref<Record<string, ChessMove & { t: 'move' }>>({});
const promo = ref<{ from: Square; to: Square } | null>(null);

// Any change to the actual position (a move landed, or the draw flag flipped)
// invalidates a local selection — clear it so stale targets can't be tapped.
const posKey = computed(
  () => g.value.board.map((row) => row.map((c) => c ?? '.').join('')).join('/') + g.value.turn + String(pendingDraw.value),
);
watch(posKey, () => {
  selected.value = null;
  targets.value = {};
  promo.value = null;
});

// --- Names / seats ---
const oppName = computed(() => props.opponentName || 'Opponent');
const youName = 'You';
const oppInitial = computed(() => (oppName.value.trim()[0] || '?').toUpperCase());
const youInitial = 'Y';
const oppColorLabel = computed(() => (oppColor.value === 'w' ? 'White' : 'Black'));
const youColorLabel = computed(() => (myColor.value === 'w' ? 'White' : 'Black'));
const oppActive = computed(() => !over.value && g.value.turn === oppColor.value);
const youActive = computed(() => !over.value && g.value.turn === myColor.value);
const presenceTitle = computed(() => (props.opponentInGame ? 'in the game' : 'away'));
const seatText = computed(() => {
  const side = myColor.value === 'w' ? 'White' : 'Black';
  if (iOfferedDraw.value) return `You're ${side} · draw offered`;
  return `You're ${side} · vs ${oppName.value}`;
});

// --- Material / captured trays (mirrors the handoff view-model) ---
const START: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
function present(): Record<'w' | 'b', Partial<Record<PieceType, number>>> {
  const acc: Record<'w' | 'b', Partial<Record<PieceType, number>>> = { w: {}, b: {} };
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = g.value.board[r][c];
      if (p) {
        const col = pieceColor(p) as 'w' | 'b';
        const t = pieceType(p) as PieceType;
        acc[col][t] = (acc[col][t] ?? 0) + 1;
      }
    }
  return acc;
}
const ORDER: PieceType[] = ['q', 'r', 'b', 'n', 'p'];
function scoreOf(side: 'w' | 'b', pres: ReturnType<typeof present>): number {
  const enemy = side === 'w' ? 'b' : 'w';
  return ORDER.reduce((s, t) => s + ((START[t] ?? 0) - (pres[enemy][t] ?? 0)) * VALUES[t], 0);
}
function capturedBy(side: 'w' | 'b', pres: ReturnType<typeof present>): string[] {
  const enemy = side === 'w' ? 'b' : 'w';
  const arr: string[] = [];
  for (const t of ORDER) {
    const miss = (START[t] ?? 0) - (pres[enemy][t] ?? 0);
    for (let k = 0; k < miss; k++) arr.push(TGLYPH[t]);
  }
  return arr;
}
const advantage = computed(() => {
  const pres = present();
  return scoreOf(myColor.value, pres) - scoreOf(oppColor.value, pres);
});
const youMaterial = computed(() => (advantage.value > 0 ? `+${advantage.value}` : ''));
const oppMaterial = computed(() => (advantage.value < 0 ? `+${-advantage.value}` : ''));
const youCaptured = computed(() => capturedBy(myColor.value, present()));
const oppCaptured = computed(() => capturedBy(oppColor.value, present()));

// --- Board squares ---
const boardStyle = computed(() => ({
  fontSize: 'calc(min(94vw, 52vh, 560px) / 8 * 0.86)',
  width: 'min(94vw, 52vh, 560px)',
  height: 'min(94vw, 52vh, 560px)',
}));

interface SqVM {
  key: string;
  r: number;
  c: number;
  light: boolean;
  glyph: string;
  white: boolean;
  selected: boolean;
  last: boolean;
  check: boolean;
  dot: boolean;
  ring: boolean;
  showRank: boolean;
  rankLabel: string;
  showFile: boolean;
  fileLabel: string;
  aria: string;
}

const squares = computed<SqVM[]>(() => {
  const board = g.value.board;
  const last = props.state.lastMove;
  const kingSq = check.value ? findKing(board, g.value.turn) : null;
  const sel = selected.value;
  const tg = targets.value;
  const order: Square[] = [];
  if (!flipped.value) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) order.push([r, c]);
  } else {
    for (let r = 7; r >= 0; r--) for (let c = 7; c >= 0; c--) order.push([r, c]);
  }
  return order.map(([r, c]) => {
    const light = (r + c) % 2 === 0;
    const piece = board[r][c];
    const key = `${r},${c}`;
    const target = tg[key];
    const isTarget = !!target;
    const isCapture = isTarget && !!piece;
    const leftEdge = flipped.value ? c === 7 : c === 0;
    const bottomEdge = flipped.value ? r === 0 : r === 7;
    return {
      key,
      r,
      c,
      light,
      glyph: piece ? TGLYPH[pieceType(piece) as PieceType] : '',
      white: !!piece && pieceColor(piece) === 'w',
      selected: !!sel && sel[0] === r && sel[1] === c,
      last: !!last && ((last.from[0] === r && last.from[1] === c) || (last.to[0] === r && last.to[1] === c)),
      check: !!kingSq && kingSq[0] === r && kingSq[1] === c,
      dot: isTarget && !isCapture,
      ring: isTarget && isCapture,
      showRank: leftEdge,
      rankLabel: String(8 - r),
      showFile: bottomEdge,
      fileLabel: FILES[c],
      aria: `${FILES[c]}${8 - r}${piece ? ` ${pieceColor(piece) === 'w' ? 'white' : 'black'} ${pieceType(piece)}` : ''}`,
    };
  });
});

// --- Status line ---
const statusText = computed(() => {
  if (over.value) return '';
  if (theyOfferedDraw.value) return `${oppName.value} offers a draw`;
  if (iOfferedDraw.value) return 'Draw offered — waiting';
  const myTurn = g.value.turn === myColor.value;
  if (myTurn) return check.value ? "Your move — you're in check" : 'Your move';
  return (check.value ? 'Check! ' : '') + `${oppName.value} to move`;
});

// --- Game-over ceremony copy (from the session-level verdict) ---
const overIcon = computed(() => {
  const s = ss.value;
  if (!s) return '';
  if (s.state === 'out-of-sync') return '⚠️';
  if (s.state === 'won' || s.state === 'resigned') return s.state === 'resigned' ? '🏳️' : '♛' + VS_TEXT;
  return '½';
});
const overTitle = computed(() => {
  const s = ss.value;
  if (!s) return '';
  if (s.state === 'out-of-sync') return 'Out of sync';
  if (s.state === 'resigned') return 'Resignation';
  if (s.state === 'won') return 'Checkmate';
  // draw: distinguish agreed / stalemate
  return props.state.agreed ? 'Draw' : 'Stalemate';
});
const overSub = computed(() => {
  const s = ss.value;
  if (!s) return '';
  if (s.state === 'out-of-sync') return 'This game got out of step and had to stop';
  if (s.state === 'draw') return props.state.agreed ? 'The game is a draw' : 'Draw — no legal moves';
  const winnerName = s.state === 'won' || s.state === 'resigned' ? (s.winner === props.myPlayer ? youName : oppName.value) : '';
  if (s.state === 'resigned') return `${winnerName} wins by resignation`;
  return `${winnerName} wins`;
});

// --- Interactions ---
function emitMove(move: ChessMove): void {
  emit('move', move);
}

function onSquare(r: number, c: number): void {
  if (over.value || pendingDraw.value !== null) return;
  const key = `${r},${c}`;
  const target = targets.value[key];
  if (target) {
    play(target);
    return;
  }
  const piece = g.value.board[r][c];
  if (piece && pieceColor(piece) === g.value.turn && canPlay.value) {
    // Build the destination → move map for this piece's legal moves. We compute
    // via the engine's legalMoves through the wrapper's own knowledge: emit a
    // move only for squares the engine allows.
    const map: Record<string, ChessMove & { t: 'move' }> = {};
    for (const m of legalFrom(r, c)) {
      map[`${m.to[0]},${m.to[1]}`] = { t: 'move', from: m.from, to: m.to };
    }
    selected.value = [r, c];
    targets.value = map;
  } else {
    selected.value = null;
    targets.value = {};
  }
}

function play(move: ChessMove & { t: 'move' }): void {
  // Promotion needs the piece choice first; otherwise emit straight away.
  if (isPromotion(move.from, move.to)) {
    promo.value = { from: move.from, to: move.to };
    selected.value = null;
    targets.value = {};
    return;
  }
  selected.value = null;
  targets.value = {};
  emitMove(move);
}

function promoteTo(pt: PieceType): void {
  if (!promo.value) return;
  const { from, to } = promo.value;
  promo.value = null;
  emitMove({ t: 'move', from, to, promoteTo: pt });
}

function onResign(): void {
  emit('resign');
}

// Legal moves for the piece at [r,c], via the engine.
function legalFrom(r: number, c: number): { from: Square; to: Square; promotion?: boolean }[] {
  return legalMoves(g.value, r, c);
}
function isPromotion(from: Square, to: Square): boolean {
  return legalMoves(g.value, from[0], from[1]).some(
    (m) => m.to[0] === to[0] && m.to[1] === to[1] && m.promotion === true,
  );
}
</script>

<style scoped>
/* The overlay host is a fixed dark-emerald surface; this board's chrome matches
   it (light-on-dark), while the board squares themselves use the handoff's
   fixed, theme-independent palette. */
.chess {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 620px;
  margin: 0 auto;
  color: var(--g-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
.ch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 4px;
}
.ch-seat {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--g-text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ch-icon {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid var(--g-border-accent);
  background: var(--g-surface);
  color: var(--g-text);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.ch-player {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 6px;
}
.ch-avatar {
  position: relative;
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
}
/* Live presence badge (opponent avatar corner): filled emerald when they're in
   the game right now, hollow/grey when away. Ringed to read on any avatar. */
.ch-presence {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--g-panel); /* punch-out against the game surface */
  background: var(--g-text-faint); /* away: muted */
}
.ch-presence.on {
  background: var(--g-accent-bright); /* in the game: live emerald */
  box-shadow: 0 0 8px rgba(47, 210, 127, 0.6);
}
.ch-presence-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-faint); /* away */
  white-space: nowrap;
}
.ch-presence-text.on {
  color: var(--g-accent-soft); /* in the game */
}
.ch-avatar.you {
  background: var(--g-accent);
  color: var(--g-on-accent);
}
.ch-avatar.opp {
  background: color-mix(in srgb, var(--g-accent) 26%, transparent);
  color: var(--g-text);
}
/* A real photo/emoji avatar fills the disc (the colored initial fallback shows
   only when there's no avatar). */
.ch-avatar-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}
.ch-pinfo {
  flex: 1;
  min-width: 0;
}
.ch-prow {
  display: flex;
  align-items: center;
  gap: 7px;
}
.ch-name {
  font-weight: 600;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ch-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--g-border);
  color: var(--g-text-dim);
}
.ch-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--g-accent);
  animation: ch-pulse 1.4s infinite;
}
@keyframes ch-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.ch-tray {
  display: flex;
  align-items: center;
  height: 18px;
  margin-top: 3px;
}
.ch-cap {
  font-size: 15px;
  line-height: 1;
  margin-right: -2px;
  color: var(--g-text-dim);
}
.ch-material {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-faint);
  margin-left: 6px;
}
.ch-boardwrap {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 0;
}
.ch-board {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.34), 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.ch-sq {
  position: relative;
  border: none;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  outline: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  font-size: inherit; /* the pieces inherit the board's computed em size */
}
.ch-base {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ch-ov {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ch-selring {
  box-shadow: inset 0 0 0 0.16em rgba(16, 185, 129, 0.95);
}
.ch-coord {
  position: absolute;
  font-size: 0.24em;
  font-weight: 700;
  color: rgba(28, 44, 36, 0.62);
  pointer-events: none;
}
.ch-rank {
  top: 3%;
  left: 6%;
}
.ch-file {
  bottom: 2%;
  right: 6%;
}
.ch-move-dot {
  position: absolute;
  width: 30%;
  height: 30%;
  border-radius: 50%;
  pointer-events: none;
}
.ch-move-ring {
  position: absolute;
  inset: 6%;
  border-radius: 50%;
  border: 0.22em solid transparent;
  box-sizing: border-box;
  pointer-events: none;
}
.ch-piece {
  position: relative;
  z-index: 1;
  line-height: 1;
  font-size: 1em;
  pointer-events: none;
}
.ch-piece.w {
  color: #f6f7f5;
  text-shadow: 0 1.5px 1.5px rgba(0, 0, 0, 0.5), 0 0 2px rgba(0, 0, 0, 0.4);
}
.ch-piece.b {
  color: #22302a;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.28);
}
.ch-status {
  text-align: center;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--g-text);
  min-height: 19px;
  padding: 2px 16px 0;
}
/* Final result, in place of the old covering ceremony: the board stays fully
   visible for review; the verdict reads here, a notch larger than the turn line. */
.ch-final {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding-top: 6px;
}
.ch-final-icon {
  font-size: 26px;
  line-height: 1;
}
.ch-final-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  text-align: left;
}
.ch-final-text b {
  font-size: 16px;
  font-weight: 700;
}
.ch-final-sub {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--g-text-dim);
}
.ch-controls {
  display: flex;
  gap: 9px;
  padding: 8px 6px 4px;
}
.ch-btn {
  flex: 1;
  padding: 12px;
  border-radius: var(--g-pill);
  border: 1px solid var(--g-border-accent);
  background: var(--g-surface);
  color: var(--g-text);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
}
.ch-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.ch-btn.primary {
  border: none;
  background: var(--g-accent);
  color: var(--g-on-accent);
  font-weight: 700;
}
.ch-drawbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 6px 0;
  padding: 11px 14px;
  border-radius: 14px;
  background: var(--g-panel);
  border: 1px solid var(--g-border-accent);
  box-shadow: var(--g-shadow-card);
}
.ch-drawtext {
  flex: 1;
  font-size: 13.5px;
  font-weight: 500;
}
.ch-mini {
  padding: 7px 13px;
  border-radius: 999px;
  border: 1px solid var(--g-border);
  background: transparent;
  color: var(--g-text);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}
.ch-mini.primary {
  border: none;
  background: var(--g-accent);
  color: var(--g-on-accent);
}
.ch-modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 30;
  background: rgba(0, 0, 0, 0.5);
}
.ch-card {
  background: var(--g-panel);
  border: 1px solid var(--g-border-accent);
  border-radius: var(--g-radius);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--g-shadow-card);
}
.ch-card-title {
  text-align: center;
  font-weight: 600;
  font-size: 15px;
}
.ch-promos {
  display: flex;
  gap: 8px;
}
.ch-promo {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  border: 1px solid var(--g-border-accent);
  background: var(--g-surface);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 38px;
  color: var(--g-text);
}
.ch-promo:active {
  border-color: var(--g-accent);
}
</style>
