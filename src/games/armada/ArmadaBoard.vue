<template>
  <!-- Armada (spec 1038 — design/Armada.dc.html is the pixel spec). Hosted by
       the fullscreen GameOverlay, never inline. Four faces:
       place   → author your fleet: tap to place in class order, drag to move,
                 tap a ship to rotate, auto-deploy/clear, Engage;
       waiting → committed (or staged — commits are sequential on the wire),
                 the other admiral is still deploying;
       battle  → enemy waters (radar, reticle, fire) over your fleet, rosters,
                 battle log; verify rides the same face;
       over    → the medal ceremony (dismissable to review the board).
       NO protocol bookkeeping here: answers/reveals/staged commits are the
       duty officer's job (src/games/duty.ts) — a board that is not mounted
       must never be able to stall the game (FR-009). -->
  <div ref="wrap" class="armada" :class="{ two: twoCol }">
    <!-- status block -->
    <div class="ar-status">
      <div class="ar-status-title" :style="{ color: statusColor }">{{ statusTitle }}</div>
      <div class="ar-status-sub">{{ statusSub }}</div>
    </div>

    <div class="ar-boards">
      <!-- ENEMY WATERS (battle/over) -->
      <div v-if="face !== 'place' && face !== 'waiting'" class="ar-panel">
        <div class="ar-panel-head">
          <span class="ar-panel-label enemy">ENEMY WATERS</span>
          <span class="ar-panel-count">{{ 5 - enemySunkCount }} / 5</span>
        </div>
        <div class="ar-board-frame">
          <div class="ar-nums"><span v-for="n in 10" :key="n">{{ n }}</span></div>
          <div class="ar-rowwrap">
            <div class="ar-letters"><span v-for="(ch, i) in 'ABCDEFGHIJ'" :key="i">{{ ch }}</span></div>
            <div class="ar-core">
              <!-- radar scope: rings + crosshair behind the cells -->
              <svg class="ar-rings" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(16,185,129,0.13)" stroke-width="0.4" />
                <circle cx="50" cy="50" r="33" fill="none" stroke="rgba(16,185,129,0.12)" stroke-width="0.4" />
                <circle cx="50" cy="50" r="18" fill="none" stroke="rgba(16,185,129,0.12)" stroke-width="0.4" />
                <circle cx="50" cy="50" r="2" fill="rgba(16,185,129,0.19)" />
                <line x1="50" y1="3" x2="50" y2="97" stroke="rgba(16,185,129,0.09)" stroke-width="0.4" />
                <line x1="3" y1="50" x2="97" y2="50" stroke="rgba(16,185,129,0.09)" stroke-width="0.4" />
              </svg>
              <div v-if="!gameOver" class="ar-sweep" :style="{ opacity: canFire ? 0.35 : 1 }" aria-hidden="true" />
              <div class="ar-grid">
                <button
                  v-for="cell in 100"
                  :key="cell"
                  type="button"
                  class="ar-cell"
                  :class="enemyCellClass(cell - 1)"
                  :disabled="!canFire || theirSea.has(cell - 1)"
                  :aria-label="fireLabel(cell - 1)"
                  @pointerenter="aimIdx = canFire && !theirSea.has(cell - 1) ? cell - 1 : null"
                  @pointerleave="aimIdx = null"
                  @click.stop="fire(cell - 1)"
                >
                  <!-- aim reticle -->
                  <span v-if="canFire && aimIdx === cell - 1 && !theirSea.has(cell - 1)" class="ar-reticle" />
                </button>
              </div>
              <div class="ar-overlay">
                <!-- enemy ships: sunk wrecks the moment they're confirmed; survivors only with the reveal -->
                <div v-for="({ ship, sunk }, i) in theirShips" :key="'w' + i" class="ar-ship" :style="shipBox(ship)">
                  <ship-svg :ship-key="classKeyForLen(ship.len, i, 'enemy')" :len="ship.len" :vertical="ship.dir === 'v'" :wrecked="sunk" />
                  <template v-if="sunk && smoking['e' + i]">
                    <div class="ar-smoke" aria-hidden="true"><i /><i /><i /></div>
                    <div class="ar-basefire" aria-hidden="true" />
                  </template>
                </div>
                <div v-for="[cell, r] in theirSeaMarks" :key="'s' + cell" class="ar-mark" :style="cellBox(cell)">
                  <span v-if="r === 'pending'" class="ar-pending" />
                  <span v-else-if="r === 'miss'" class="ar-miss" />
                  <span v-else-if="theirWreckCells.has(cell)" class="ar-ember" />
                  <span v-else class="ar-hit"><span class="ar-burst" /><span class="ar-flame" /></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- YOUR FLEET -->
      <div class="ar-panel">
        <div class="ar-panel-head">
          <span class="ar-panel-label mine">YOUR FLEET</span>
          <span class="ar-panel-count">{{ face === 'place' ? placed.length + ' / 5' : (5 - mySunkCount) + ' / 5' }}</span>
        </div>
        <div class="ar-board-frame">
          <div class="ar-nums"><span v-for="n in 10" :key="n">{{ n }}</span></div>
          <div class="ar-rowwrap">
            <div class="ar-letters"><span v-for="(ch, i) in 'ABCDEFGHIJ'" :key="i">{{ ch }}</span></div>
            <div ref="myGrid" class="ar-core">
              <div class="ar-grid">
                <button
                  v-for="cell in 100"
                  :key="cell"
                  type="button"
                  class="ar-cell"
                  :class="myCellClass(cell - 1)"
                  :disabled="face !== 'place' || placed.length >= 5"
                  :aria-label="face === 'place' ? placeLabel(cell - 1) : undefined"
                  @pointerenter="hoverIdx = face === 'place' && placed.length < 5 ? cell - 1 : null"
                  @pointerleave="hoverIdx = null"
                  @click.stop="placeAt(cell - 1)"
                />
              </div>
              <div class="ar-overlay">
                <!-- my ships: authored preview while placing, secret/reveal in battle -->
                <div
                  v-for="(ship, i) in myShipsView"
                  :key="'o' + i"
                  class="ar-ship"
                  :class="{ live: face === 'place', dragging: dragIdx === i, invalid: dragIdx === i && dragInvalid }"
                  :style="shipBox(dragIdx === i ? { ...ship.ship, r: dragPos.r, c: dragPos.c } : ship.ship)"
                  @pointerdown="face === 'place' ? onShipDown(i, $event) : undefined"
                  @pointermove="face === 'place' ? onShipMove($event) : undefined"
                  @pointerup="face === 'place' ? onShipUp() : undefined"
                  @pointercancel="face === 'place' ? onShipCancel() : undefined"
                >
                  <ship-svg
                    :ship-key="SHIP_CLASSES[i]?.key ?? 'destroyer'"
                    :len="ship.ship.len"
                    :vertical="ship.ship.dir === 'v'"
                    :wrecked="ship.sunk"
                    :insignia="!ship.sunk && face !== 'place'"
                  />
                  <template v-if="ship.sunk && smoking['p' + i]">
                    <div class="ar-smoke" aria-hidden="true"><i /><i /><i /></div>
                    <div class="ar-basefire" aria-hidden="true" />
                  </template>
                </div>
                <div v-for="[cell, r] in mySeaMarks" :key="'m' + cell" class="ar-mark" :style="cellBox(cell)">
                  <span v-if="r === 'miss'" class="ar-miss" />
                  <span v-else-if="myWreckCells.has(cell)" class="ar-ember" />
                  <span v-else class="ar-hit"><span class="ar-burst" /><span class="ar-flame" /></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- controls -->
    <div v-if="face === 'place'" class="ar-controls">
      <button type="button" class="ar-btn" @click.stop="autoDeploy">Auto-deploy</button>
      <button type="button" class="ar-btn" :disabled="!placed.length" @click.stop="clearFleet">Clear</button>
      <button v-if="placed.length >= 5" type="button" class="ar-btn primary" @click.stop="engage">Engage ▸</button>
      <button type="button" class="ar-btn danger" @click.stop="$emit('resign')">Surrender</button>
    </div>
    <div v-else-if="gameOver" class="ar-controls">
      <button type="button" class="ar-btn primary" @click.stop="$emit('rematch')">New battle</button>
      <button v-if="resultDismissed" type="button" class="ar-btn" @click.stop="resultDismissed = false">View result</button>
      <button type="button" class="ar-btn" @click.stop="$emit('leave')">Leave</button>
    </div>
    <div v-else class="ar-controls">
      <!-- waiting/battle: the game can always be ENDED, not just abandoned —
           an unfinished game holds the chat's one-game gate and the pill. -->
      <button type="button" class="ar-btn danger" @click.stop="$emit('resign')">Surrender</button>
    </div>

    <!-- rosters -->
    <div class="ar-rosters">
      <div v-if="face !== 'place' && face !== 'waiting'" class="ar-panel">
        <div class="ar-panel-head"><span class="ar-panel-label enemy">ENEMY FLEET</span></div>
        <div class="ar-roster">
          <div v-for="row in enemyRoster" :key="row.key" class="ar-rrow" :class="{ sunk: row.kind === 'sunk' }">
            <span class="ar-ricon"><ship-svg :ship-key="row.key" :len="2" :wrecked="row.kind === 'sunk'" /></span>
            <span class="ar-rbody">
              <span class="ar-rname">{{ row.name }}</span>
              <span class="ar-pips"><i v-for="k in row.size" :key="k" :class="{ hit: k <= row.hits }" /></span>
            </span>
            <span class="ar-chip" :class="row.kind">{{ row.status }}</span>
          </div>
        </div>
      </div>
      <div class="ar-panel">
        <div class="ar-panel-head"><span class="ar-panel-label mine">YOUR FLEET</span></div>
        <div class="ar-roster">
          <div v-for="row in myRoster" :key="row.key" class="ar-rrow" :class="{ sunk: row.kind === 'sunk', placing: row.kind === 'placing' }">
            <span class="ar-ricon"><ship-svg :ship-key="row.key" :len="2" :wrecked="row.kind === 'sunk'" /></span>
            <span class="ar-rbody">
              <span class="ar-rname">{{ row.name }}</span>
              <span class="ar-pips"><i v-for="k in row.size" :key="k" :class="{ hit: k <= row.hits }" /></span>
            </span>
            <span class="ar-chip" :class="row.kind">{{ row.status }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- battle log -->
    <div v-if="face !== 'place' && face !== 'waiting'" class="ar-panel ar-log">
      <div class="ar-panel-head"><span class="ar-panel-label dim">BATTLE LOG</span></div>
      <div v-if="!logEntries.length" class="ar-log-empty">Awaiting the first salvo…</div>
      <div v-for="(e, k) in logEntries" :key="k" class="ar-log-row" :style="{ opacity: 1 - k * 0.12 }">
        <i :class="'dot-' + e.t" />{{ e.text }}
      </div>
    </div>

    <!-- result ceremony -->
    <div v-if="gameOver && !resultDismissed" class="ar-result" @click.self="resultDismissed = true">
      <div class="ar-result-card" :class="{ won: iWon }">
        <div class="ar-eyebrow">WAR CONCLUDED</div>
        <div class="ar-medal"><medal-svg :won="iWon" /></div>
        <div class="ar-verdict" :class="{ won: iWon }">{{ verdictTitle }}</div>
        <div class="ar-rank" :class="{ won: iWon }">{{ rank.toUpperCase() }}</div>
        <div class="ar-citation">{{ citation }}</div>
        <div class="ar-stats">
          <div class="ar-stat"><b>{{ stats.shots }}</b><span>Shots</span></div>
          <div class="ar-stat"><b class="acc">{{ stats.accuracy }}%</b><span>Accuracy</span></div>
          <div class="ar-stat"><b>{{ stats.sunk }}/5</b><span>Ships sunk</span></div>
          <div class="ar-stat"><b :class="iWon ? 'good' : 'bad'">{{ stats.survivors }}/5</b><span>Survivors</span></div>
        </div>
        <div class="ar-result-btns">
          <button type="button" class="ar-btn primary" @click.stop="$emit('rematch')">New battle</button>
          <button type="button" class="ar-btn" @click.stop="resultDismissed = true">Review board</button>
          <button type="button" class="ar-btn" @click.stop="$emit('leave')">Leave</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ShipSvg from './ShipSvg.vue';
import MedalSvg from './MedalSvg.vue';
import { ready as sodiumReady } from '@/services/crypto/primitives';
import {
  SHIP_CLASSES,
  FLEET,
  randomLayout,
  randomSalt,
  commitment,
  cellsOf,
  layoutLegal,
  status as armadaStatus,
  turn as armadaTurn,
  type ArmadaMove,
  type ArmadaState,
  type Layout,
  type Ship,
} from './logic';
import { getFleetSecret, setFleetSecret, setStagedCommit } from '../fleet-secret';
import type { GameSessionStatus } from '../types';
import { playGameCue } from '@/services/game-sounds';

const props = defineProps<{
  state: ArmadaState;
  myPlayer: 0 | 1;
  canMove: boolean;
  marks?: [string, string];
  accent?: string;
  lastMove?: ArmadaMove | null;
  /** The carrying message/post id — keys the staged-commit record. Passed by
   *  the GameOverlay host (armada never renders inline). */
  sessionKey?: string;
  /** The SESSION-level verdict (resignation/out-of-sync live there, invisible
   *  to the protocol state). Passed by the overlay host. */
  sessionStatus?: GameSessionStatus | null;
}>();
const emit = defineEmits<{
  (e: 'move', move: ArmadaMove): void;
  (e: 'leave'): void;
  (e: 'rematch'): void;
  (e: 'resign'): void;
}>();

/* ---- responsive layout: two-column at ≥760px container (handoff) ---- */
const wrap = ref<HTMLElement>();
const twoCol = ref(false);
let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver((es) => {
    twoCol.value = (es[0]?.contentRect.width ?? 0) >= 760;
  });
  if (wrap.value) ro.observe(wrap.value);
});
onBeforeUnmount(() => ro?.disconnect());

/* ---- faces ---- */
const me = computed(() => props.myPlayer);
const iCommitted = computed(() => props.state.commits[me.value] !== null);
const bothCommitted = computed(() => props.state.commits[0] !== null && props.state.commits[1] !== null);
const resigned = computed(() =>
  props.sessionStatus?.state === 'resigned' ? props.sessionStatus : null,
);
const gameOver = computed(
  () =>
    resigned.value !== null ||
    (props.state.finalBy !== null && props.state.reveals[0] !== null && props.state.reveals[1] !== null),
);
const staged = ref(false); // Engage pressed while the wire slot wasn't open yet
const face = computed<'place' | 'waiting' | 'battle'>(() => {
  if (bothCommitted.value) return 'battle';
  return iCommitted.value || staged.value ? 'waiting' : 'place';
});

/* ---- board geometry: absolute boxes over a 10×10 grid with 4px gaps ---- */
const off = (n: number): string => `calc((100% - 36px) / 10 * ${n} + ${n * 4}px)`;
const sz = (n: number): string => `calc((100% - 36px) / 10 * ${n} + ${(n - 1) * 4}px)`;
const boxStyle = (r: number, c: number, cs: number, rs: number) => ({
  position: 'absolute' as const,
  left: off(c),
  top: off(r),
  width: sz(cs),
  height: sz(rs),
});
const shipBox = (s: Ship) => boxStyle(s.r, s.c, s.dir === 'h' ? s.len : 1, s.dir === 'h' ? 1 : s.len);
const cellBox = (cell: number) => boxStyle(Math.floor(cell / 10), cell % 10, 1, 1);

/* ---- deployment: tap-to-place in class order, drag to move, tap to rotate ---- */
const placed = ref<Ship[]>([]);
const orient = ref<'h' | 'v'>('h');
const hoverIdx = ref<number | null>(null);
const myGrid = ref<HTMLElement>();

const nextClass = computed(() => SHIP_CLASSES[placed.value.length] ?? null);

function cellsForAt(idx: number, dir: 'h' | 'v', size: number): number[] | null {
  const r = Math.floor(idx / 10);
  const c = idx % 10;
  const cells: number[] = [];
  for (let i = 0; i < size; i++) {
    const rr = dir === 'v' ? r + i : r;
    const cc = dir === 'h' ? c + i : c;
    if (rr > 9 || cc > 9) return null;
    cells.push(rr * 10 + cc);
  }
  return cells;
}
const occupied = (except?: number): Set<number> => {
  const s = new Set<number>();
  placed.value.forEach((sh, i) => {
    if (i === except) return;
    cellsOf(sh).forEach((c) => s.add(c));
  });
  return s;
};
const previewCells = computed<{ cells: Set<number>; valid: boolean } | null>(() => {
  if (face.value !== 'place' || hoverIdx.value === null || !nextClass.value) return null;
  const cells = cellsForAt(hoverIdx.value, orient.value, nextClass.value.size);
  if (!cells) return { cells: new Set([hoverIdx.value]), valid: false };
  const occ = occupied();
  return { cells: new Set(cells), valid: cells.every((c) => !occ.has(c)) };
});
function placeAt(idx: number): void {
  if (face.value !== 'place' || !nextClass.value) return;
  const size = nextClass.value.size;
  // Try the current orientation, then the other — a tap should just work.
  for (const dir of [orient.value, orient.value === 'h' ? 'v' : 'h'] as const) {
    const cells = cellsForAt(idx, dir, size);
    if (!cells) continue;
    const occ = occupied();
    if (!cells.every((c) => !occ.has(c))) continue;
    placed.value = [...placed.value, { r: Math.floor(idx / 10), c: idx % 10, len: size, dir }];
    hoverIdx.value = null;
    return;
  }
}
function autoDeploy(): void {
  placed.value = randomLayout();
  hoverIdx.value = null;
}
function clearFleet(): void {
  placed.value = [];
  hoverIdx.value = null;
}

// Drag with a small movement threshold (a still tap rotates instead).
const dragIdx = ref(-1);
const dragPos = ref({ r: 0, c: 0 });
const dragInvalid = ref(false);
let dragMoved = false;
let grabOffset = { r: 0, c: 0 };
let dragFrom = { r: 0, c: 0 };
function gridCell(ev: PointerEvent): { r: number; c: number } | null {
  const grid = myGrid.value;
  if (!grid) return null;
  const rect = grid.getBoundingClientRect();
  const pitch = (rect.width - 9 * 4) / 10 + 4;
  return {
    r: Math.floor((ev.clientY - rect.top) / pitch),
    c: Math.floor((ev.clientX - rect.left) / pitch),
  };
}
const clampShip = (s: Ship): Ship => ({
  ...s,
  r: Math.max(0, Math.min(s.dir === 'v' ? 10 - s.len : 9, s.r)),
  c: Math.max(0, Math.min(s.dir === 'h' ? 10 - s.len : 9, s.c)),
});
const candidateLegal = (idx: number, moved: Ship): boolean =>
  layoutLegal(placed.value.map((s, i) => (i === idx ? moved : s)));
function onShipDown(i: number, ev: PointerEvent): void {
  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  const cell = gridCell(ev);
  const ship = placed.value[i];
  dragIdx.value = i;
  dragMoved = false;
  dragInvalid.value = false;
  dragFrom = { r: ship.r, c: ship.c };
  dragPos.value = { r: ship.r, c: ship.c };
  grabOffset = cell ? { r: cell.r - ship.r, c: cell.c - ship.c } : { r: 0, c: 0 };
}
function onShipMove(ev: PointerEvent): void {
  if (dragIdx.value < 0) return;
  const cell = gridCell(ev);
  if (!cell) return;
  const ship = placed.value[dragIdx.value];
  const next = clampShip({ ...ship, r: cell.r - grabOffset.r, c: cell.c - grabOffset.c });
  if (next.r !== dragPos.value.r || next.c !== dragPos.value.c) dragMoved = true;
  dragPos.value = { r: next.r, c: next.c };
  dragInvalid.value = !candidateLegal(dragIdx.value, next);
}
function onShipUp(): void {
  if (dragIdx.value < 0) return;
  const i = dragIdx.value;
  const ship = placed.value[i];
  if (!dragMoved) {
    // Tap = rotate, nudged inward when the turn would leave the board.
    const rotated = clampShip({ ...ship, dir: ship.dir === 'h' ? 'v' : 'h' });
    if (candidateLegal(i, rotated)) placed.value = placed.value.map((s, k) => (k === i ? rotated : s));
  } else {
    const dropped = { ...ship, r: dragPos.value.r, c: dragPos.value.c };
    placed.value = placed.value.map((s, k) =>
      k === i ? (candidateLegal(i, dropped) ? dropped : { ...ship, ...dragFrom }) : s,
    );
  }
  dragIdx.value = -1;
  dragInvalid.value = false;
}
function onShipCancel(): void {
  dragIdx.value = -1;
  dragInvalid.value = false;
}

/** Engage: hash the authored layout, keep the secret device-local, and either
 *  emit the commit (my wire slot is open) or STAGE it for the duty officer —
 *  commits are sequential on the wire (contract §Moves). */
function engage(): void {
  if (placed.value.length < 5) return;
  const layout: Layout = placed.value.map((s) => ({ r: s.r, c: s.c, len: s.len, dir: s.dir }));
  if (!layoutLegal(layout)) return;
  void (async () => {
    await sodiumReady();
    const salt = randomSalt();
    const h = commitment(layout, salt);
    await setFleetSecret('armada', h, { layout, salt });
    if (props.canMove) {
      emit('move', { t: 'commit', h });
    } else if (props.sessionKey) {
      await setStagedCommit('armada', props.sessionKey, { h });
      staged.value = true;
    } else {
      // No session key to stage under (defensive) — try the emit; the engine
      // gate refuses it silently if the slot isn't open.
      emit('move', { t: 'commit', h });
    }
  })().catch(() => {});
}

/* ---- battle: public data + my own fleet ---- */
type CellMark = 'miss' | 'hit' | 'sunk' | 'pending';
const shotMap = (attacker: 0 | 1): Map<number, CellMark> => {
  const m = new Map<number, CellMark>();
  for (const rec of props.state.shots[attacker]) m.set(rec.cell, rec.r);
  const p = props.state.pending;
  if (p && p.by === attacker) m.set(p.cell, 'pending');
  return m;
};
const theirSea = computed(() => shotMap(me.value));
const mySea = computed(() => shotMap((1 - me.value) as 0 | 1));
const theirSeaMarks = computed(() => [...theirSea.value.entries()]);
const mySeaMarks = computed(() => [...mySea.value.entries()].filter(([, r]) => r !== 'pending'));
const aimIdx = ref<number | null>(null);
const canFire = computed(
  () => props.canMove && bothCommitted.value && !props.state.pending && props.state.finalBy === null,
);
const fire = (cell: number): void => {
  if (!canFire.value || theirSea.value.has(cell)) return;
  emit('move', { t: 'shot', cell });
};
const fireLabel = (cell: number): string => `Fire at ${'ABCDEFGHIJ'[Math.floor(cell / 10)]}${(cell % 10) + 1}`;
const placeLabel = (cell: number): string =>
  `Place your ${nextClass.value?.name ?? 'ship'} at ${'ABCDEFGHIJ'[Math.floor(cell / 10)]}${(cell % 10) + 1}`;
// The scope brightening is audible too: one sonar ping when the turn becomes yours.
watch(canFire, (now, was) => {
  if (now && !was) void playGameCue('bs-sonar');
});

// My fleet: authored preview while placing; the device-local secret in battle;
// my reveal once public (the secret is cleared at game end by the duty officer).
const secret = ref<{ layout: Layout; salt: string } | null>(null);
async function loadSecret(): Promise<void> {
  const h = props.state.commits[me.value];
  secret.value = h ? await getFleetSecret('armada', h) : null;
}
onMounted(() => void loadSecret());
watch(() => props.state.commits[me.value], () => void loadSecret());

const ownLayout = computed<Layout | null>(
  () => secret.value?.layout ?? props.state.reveals[me.value]?.layout ?? null,
);
const myShipsView = computed<{ ship: Ship; sunk: boolean }[]>(() => {
  if (face.value === 'place') return placed.value.map((ship) => ({ ship, sunk: false }));
  const layout = ownLayout.value;
  if (!layout) return [];
  const hits = new Set([...mySea.value.entries()].filter(([, r]) => r === 'hit' || r === 'sunk').map(([c]) => c));
  return layout.map((ship) => ({ ship, sunk: cellsOf(ship).every((c) => hits.has(c)) }));
});
const myWreckCells = computed(() => {
  const set = new Set<number>();
  for (const { ship, sunk } of myShipsView.value) if (sunk) cellsOf(ship).forEach((c) => set.add(c));
  return set;
});
const mySunkCount = computed(() => myShipsView.value.filter((s) => s.sunk).length);

// Enemy ships: each 'sunk' answer closes the straight run of hits through its
// cell (ships may touch, so a collinear pair can briefly read as one long
// wreck — the end-of-game reveal corrects any such guess and surfaces the
// survivors). Same derivation battleship shipped, on the 10-wide board.
const theirDerivedWrecks = computed<Ship[]>(() => {
  const shots = props.state.shots[me.value];
  const hitCells = new Set<number>();
  const assigned = new Set<number>();
  const wrecks: Ship[] = [];
  const avail = (cell: number): boolean => hitCells.has(cell) && !assigned.has(cell);
  for (const rec of shots) {
    if (rec.r !== 'miss') hitCells.add(rec.cell);
    if (rec.r !== 'sunk') continue;
    const r0 = Math.floor(rec.cell / 10);
    const c0 = rec.cell % 10;
    let c1 = c0, c2 = c0, r1 = r0, r2 = r0;
    while (c1 > 0 && avail(r0 * 10 + c1 - 1)) c1--;
    while (c2 < 9 && avail(r0 * 10 + c2 + 1)) c2++;
    while (r1 > 0 && avail((r1 - 1) * 10 + c0)) r1--;
    while (r2 < 9 && avail((r2 + 1) * 10 + c0)) r2++;
    const hLen = c2 - c1 + 1;
    const vLen = r2 - r1 + 1;
    const ship: Ship = hLen >= vLen ? { r: r0, c: c1, len: hLen, dir: 'h' } : { r: r1, c: c0, len: vLen, dir: 'v' };
    if (ship.len < 2) continue;
    wrecks.push(ship);
    cellsOf(ship).forEach((c) => assigned.add(c));
  }
  return wrecks;
});
const theirShips = computed<{ ship: Ship; sunk: boolean }[]>(() => {
  const reveal = props.state.reveals[(1 - me.value) as 0 | 1]?.layout;
  if (reveal) {
    const hits = new Set(props.state.shots[me.value].filter((x) => x.r !== 'miss').map((x) => x.cell));
    return reveal.map((ship) => ({ ship, sunk: cellsOf(ship).every((c) => hits.has(c)) }));
  }
  return theirDerivedWrecks.value.map((ship) => ({ ship, sunk: true }));
});
const theirWreckCells = computed(() => {
  const set = new Set<number>();
  for (const { ship, sunk } of theirShips.value) if (sunk) cellsOf(ship).forEach((c) => set.add(c));
  return set;
});
const enemySunkCount = computed(() => props.state.shots[me.value].filter((x) => x.r === 'sunk').length);

/** Class key for an enemy ship row: from the reveal it's positional; for a
 *  derived wreck, match its length to the first unconsumed class of that size. */
function classKeyForLen(len: number, index: number, side: 'enemy'): string {
  void side;
  const reveal = props.state.reveals[(1 - me.value) as 0 | 1]?.layout;
  if (reveal) return SHIP_CLASSES[index]?.key ?? 'destroyer';
  const used = new Set<number>();
  const wrecks = theirDerivedWrecks.value;
  for (let w = 0; w <= index && w < wrecks.length; w++) {
    for (let k = 0; k < SHIP_CLASSES.length; k++) {
      if (used.has(k) || SHIP_CLASSES[k].size !== Math.min(wrecks[w].len, 5)) continue;
      used.add(k);
      if (w === index) return SHIP_CLASSES[k].key;
      break;
    }
  }
  return len >= 5 ? 'carrier' : len === 4 ? 'battleship' : len === 3 ? 'cruiser' : 'destroyer';
}

/* ---- cell classes ---- */
function enemyCellClass(cell: number): string {
  const r = theirSea.value.get(cell);
  if (r === 'miss') return 'water-miss';
  if (r === 'hit' || r === 'sunk') return theirWreckCells.value.has(cell) ? 'scorched' : 'burning';
  return canFire.value ? 'aimable' : '';
}
function myCellClass(cell: number): string {
  if (face.value === 'place' && previewCells.value?.cells.has(cell)) {
    return previewCells.value.valid ? 'prev-ok' : 'prev-bad';
  }
  const r = mySea.value.get(cell);
  if (r === 'miss') return 'water-miss';
  if (r === 'hit' || r === 'sunk') return myWreckCells.value.has(cell) ? 'scorched' : 'burning';
  return '';
}

/* ---- smoke: strictly time-boxed per sunk ship (handoff perf rule) ---- */
const smoking = ref<Record<string, boolean>>({});
const smokeSeen = new Set<string>();
const smokeTimers: ReturnType<typeof setTimeout>[] = [];
function watchSunk(keys: string[]): void {
  for (const key of keys) {
    if (smokeSeen.has(key)) continue;
    smokeSeen.add(key);
    smoking.value = { ...smoking.value, [key]: true };
    smokeTimers.push(
      setTimeout(() => {
        const m = { ...smoking.value };
        delete m[key];
        smoking.value = m;
      }, 6500),
    );
  }
}
watch(
  () => [myShipsView.value, theirShips.value] as const,
  ([mine, theirs]) => {
    watchSunk(mine.flatMap((s, i) => (s.sunk && face.value !== 'place' ? [`p${i}`] : [])));
    watchSunk(theirs.flatMap((s, i) => (s.sunk ? [`e${i}`] : [])));
  },
  { immediate: true },
);
onBeforeUnmount(() => smokeTimers.forEach((t) => clearTimeout(t)));

/* ---- rosters ---- */
interface RosterRow {
  key: string;
  name: string;
  size: number;
  hits: number;
  status: string;
  kind: 'pending' | 'placing' | 'ready' | 'active' | 'sunk';
}
const myRoster = computed<RosterRow[]>(() =>
  SHIP_CLASSES.map((def, i) => {
    if (face.value === 'place') {
      if (i < placed.value.length) return { key: def.key, name: def.name, size: def.size, hits: 0, status: 'Ready', kind: 'ready' as const };
      if (i === placed.value.length) return { key: def.key, name: def.name, size: def.size, hits: 0, status: 'Placing', kind: 'placing' as const };
      return { key: def.key, name: def.name, size: def.size, hits: 0, status: 'Standby', kind: 'pending' as const };
    }
    const view = myShipsView.value[i];
    const hits = view ? cellsOf(view.ship).filter((c) => myWreckCells.value.has(c) || mySea.value.get(c) === 'hit' || mySea.value.get(c) === 'sunk').length : 0;
    if (view?.sunk) return { key: def.key, name: def.name, size: def.size, hits: def.size, status: 'Sunk', kind: 'sunk' as const };
    return { key: def.key, name: def.name, size: def.size, hits, status: hits > 0 ? `${hits}/${def.size}` : 'Afloat', kind: 'active' as const };
  }),
);
const enemyRoster = computed<RosterRow[]>(() => {
  const reveal = props.state.reveals[(1 - me.value) as 0 | 1]?.layout;
  if (reveal) {
    const hits = new Set(props.state.shots[me.value].filter((x) => x.r !== 'miss').map((x) => x.cell));
    return SHIP_CLASSES.map((def, i) => {
      const ship = reveal[i];
      const n = ship ? cellsOf(ship).filter((c) => hits.has(c)).length : 0;
      const sunk = !!ship && cellsOf(ship).every((c) => hits.has(c));
      if (sunk) return { key: def.key, name: def.name, size: def.size, hits: def.size, status: 'Sunk', kind: 'sunk' as const };
      return { key: def.key, name: def.name, size: def.size, hits: n, status: n > 0 ? `${n}/${def.size}` : 'Survived', kind: 'active' as const };
    });
  }
  // Pre-reveal: sunk classes from the derived wrecks (by size, greedily).
  const used = new Set<number>();
  for (const w of theirDerivedWrecks.value) {
    for (let k = 0; k < SHIP_CLASSES.length; k++) {
      if (!used.has(k) && SHIP_CLASSES[k].size === Math.min(w.len, 5)) {
        used.add(k);
        break;
      }
    }
  }
  return SHIP_CLASSES.map((def, i) => {
    if (used.has(i)) return { key: def.key, name: def.name, size: def.size, hits: def.size, status: 'Sunk', kind: 'sunk' as const };
    return { key: def.key, name: def.name, size: def.size, hits: 0, status: 'Hidden', kind: 'pending' as const };
  });
});

/* ---- battle log: derived from the alternating shot history ---- */
const logEntries = computed<{ t: 'hit' | 'miss' | 'sunk' | 'info'; text: string }[]>(() => {
  const out: { t: 'hit' | 'miss' | 'sunk' | 'info'; text: string }[] = [];
  const myShots = props.state.shots[me.value];
  const theirShots = props.state.shots[(1 - me.value) as 0 | 1];
  const myShipAt = (cell: number): string => {
    const layout = ownLayout.value;
    const idx = layout?.findIndex((sh) => cellsOf(sh).includes(cell)) ?? -1;
    return idx >= 0 ? SHIP_CLASSES[idx]?.name ?? 'ship' : 'ship';
  };
  // Strict alternation: P0's k-th shot precedes P1's k-th.
  const total = props.state.shots[0].length + props.state.shots[1].length;
  for (let k = 0; k < total; k++) {
    const attacker = (k % 2 === 0 ? 0 : 1) as 0 | 1;
    const rec = props.state.shots[attacker][Math.floor(k / 2)];
    if (!rec) continue;
    if (attacker === me.value) {
      if (rec.r === 'sunk') out.unshift({ t: 'sunk', text: 'You sank an enemy ship.' });
      else if (rec.r === 'hit') out.unshift({ t: 'hit', text: 'Direct hit on an enemy vessel.' });
      else out.unshift({ t: 'miss', text: 'Your salvo splashed into open water.' });
    } else {
      if (rec.r === 'sunk') out.unshift({ t: 'sunk', text: `The enemy sank your ${myShipAt(rec.cell)}.` });
      else if (rec.r === 'hit') out.unshift({ t: 'hit', text: `Enemy fire struck your ${myShipAt(rec.cell)}.` });
      else out.unshift({ t: 'miss', text: 'Enemy salvo missed.' });
    }
  }
  void myShots;
  void theirShots;
  return out.slice(0, 6);
});

/* ---- status block ---- */
const verdict = computed(() => armadaStatus(props.state));
const iWon = computed(() => {
  if (resigned.value) return resigned.value.winner === me.value;
  return verdict.value.state === 'won' && verdict.value.winner === me.value;
});
const statusTitle = computed(() => {
  if (gameOver.value) {
    if (resigned.value) return iWon.value ? 'VICTORY' : 'SURRENDERED';
    return verdict.value.state === 'draw' ? 'DISHONORED SEAS' : iWon.value ? 'VICTORY' : 'DEFEAT';
  }
  if (face.value === 'place') return 'DEPLOY YOUR FLEET';
  if (face.value === 'waiting') return 'AWAITING THEIR FLEET';
  if (props.state.finalBy !== null) return 'VERIFYING';
  return armadaTurn(props.state) === me.value ? 'YOUR MOVE' : 'ENEMY FIRING';
});
const statusSub = computed(() => {
  if (gameOver.value) {
    if (resigned.value) return iWon.value ? 'The enemy struck their colours.' : 'You struck your colours.';
    return verdict.value.state === 'draw' ? 'Both fleets broke the rules of war.' : iWon.value ? 'Enemy fleet sent to the depths.' : 'Your fleet has been destroyed.';
  }
  if (face.value === 'place') {
    return nextClass.value
      ? `Position your ${nextClass.value.name} · tap the grid to place · drag to move · tap a ship to rotate`
      : 'Fleet ready. Tap Engage.';
  }
  if (face.value === 'waiting') return 'Your armada is locked in. The other admiral is still deploying.';
  if (props.state.finalBy !== null) return 'Exchanging fleet records for verification…';
  return armadaTurn(props.state) === me.value ? 'Fire at enemy waters.' : 'Enemy salvo incoming…';
});
const statusColor = computed(() => {
  if (gameOver.value) return iWon.value ? '#10b981' : '#ff6b7a';
  if (face.value === 'battle' && armadaTurn(props.state) !== me.value) return '#ffc409';
  if (face.value === 'battle') return '#10b981';
  return '#e9f5ee';
});

/* ---- result ceremony ---- */
const resultDismissed = ref(false);
const verdictTitle = computed(() => {
  if (resigned.value) return iWon.value ? 'VICTORY' : 'SURRENDERED';
  return verdict.value.state === 'draw' ? 'DRAW' : iWon.value ? 'VICTORY' : 'DEFEAT';
});
const stats = computed(() => {
  const mine = props.state.shots[me.value];
  const shots = mine.length;
  const hits = mine.filter((x) => x.r !== 'miss').length;
  return {
    shots,
    accuracy: shots ? Math.round((hits / shots) * 100) : 0,
    sunk: enemySunkCount.value,
    survivors: 5 - mySunkCount.value,
  };
});
const rank = computed(() => {
  if (resigned.value) return iWon.value ? 'Victor by Concession' : 'Struck Colours';
  if (verdict.value.state === 'draw') return 'Court-Martialed';
  if (!iWon.value) return 'Lost at Sea';
  const s = stats.value.survivors;
  return s >= 4 ? 'Fleet Admiral' : s >= 2 ? 'Commodore' : 'Battle-Scarred Victor';
});
const citation = computed(() => {
  if (resigned.value) {
    return iWon.value
      ? 'The enemy struck their colours. The seas are yours without another shot.'
      : 'You struck your colours. The battle ends on your word.';
  }
  if (verdict.value.state === 'draw') return 'Both fleets were caught falsifying their records. The sea keeps the verdict.';
  if (iWon.value) return `Enemy armada sent to the depths with ${stats.value.survivors} of your 5 ships still afloat.`;
  return 'Your fleet has been destroyed. The waters fall silent.';
});
</script>

<style scoped>
.armada {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  color: #e9f5ee;
}

/* status */
.ar-status {
  text-align: center;
  padding: 14px 16px 12px;
}
.ar-status-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 2px;
}
.ar-status-sub {
  font-size: 12px;
  color: rgba(220, 240, 230, 0.6);
  margin-top: 3px;
}

/* panels */
.ar-panel {
  background: #181f1b;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 12px;
}
.armada.two .ar-panel {
  padding: 16px;
}
.ar-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 0 2px;
}
.ar-panel-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  letter-spacing: 2px;
  font-weight: 600;
}
.ar-panel-label.enemy { color: #ff6b7a; }
.ar-panel-label.mine { color: #6ee7b7; }
.ar-panel-label.dim { color: rgba(220, 240, 230, 0.4); font-size: 10px; }
.ar-panel-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: rgba(220, 240, 230, 0.45);
}

/* boards */
.ar-boards {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
}
.armada.two .ar-boards {
  flex-direction: row;
  gap: 20px;
  justify-content: center;
  align-items: flex-start;
}
.ar-boards > .ar-panel {
  width: 100%;
  max-width: 480px;
}
.ar-board-frame {
  user-select: none;
  -webkit-user-select: none;
}
.ar-nums {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 4px;
  padding-left: 22px;
  margin-bottom: 4px;
}
.ar-nums span,
.ar-letters span {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: rgba(190, 227, 210, 0.38);
  text-align: center;
}
.ar-rowwrap {
  display: flex;
}
.ar-letters {
  display: grid;
  grid-auto-rows: 1fr;
  gap: 4px;
  width: 18px;
  margin-right: 4px;
  align-items: center;
}
.ar-letters span {
  display: flex;
  align-items: center;
  justify-content: center;
}
.ar-core {
  position: relative;
  flex: 1;
  min-width: 0;
}
.ar-rings,
.ar-sweep {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
.ar-sweep {
  border-radius: 50%;
  overflow: hidden;
  transition: opacity 0.4s ease;
}
/* The ROTATING box is the clipped pseudo-element, not .ar-sweep itself: a
   rotated square's bounding box pokes past the board and (transforms count
   toward scroll overflow) let iPhones pan the whole game sideways. */
.ar-sweep::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(from 0deg, rgba(16, 185, 129, 0.23), rgba(16, 185, 129, 0.07) 34deg, rgba(16, 185, 129, 0) 62deg, rgba(16, 185, 129, 0) 360deg);
  animation: ar-radar 5s linear infinite;
}
.ar-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 4px;
}
.ar-cell {
  aspect-ratio: 1;
  min-width: 0;
  box-sizing: border-box;
  border-radius: 7px;
  background: rgba(28, 92, 140, 0.12);
  border: 1px solid rgba(28, 92, 140, 0.16);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.14s, border-color 0.14s;
  cursor: default;
}
.ar-cell.aimable { cursor: crosshair; }
.ar-cell.prev-ok { background: rgba(16, 185, 129, 0.22); border-color: rgba(16, 185, 129, 0.65); }
.ar-cell.prev-bad { background: rgba(235, 68, 90, 0.18); border-color: rgba(235, 68, 90, 0.65); }
.ar-cell.water-miss { background: rgba(255, 255, 255, 0.02); }
.ar-cell.burning { background: rgba(235, 68, 90, 0.08); }
.ar-cell.scorched { background: rgba(40, 25, 18, 0.35); }
.ar-cell:disabled { cursor: default; }
.ar-reticle {
  width: 55%;
  height: 55%;
  border-radius: 50%;
  border: 1.5px solid var(--ion-color-primary);
  box-shadow: 0 0 8px rgba(var(--ion-color-primary-rgb), 0.8);
  animation: ar-reticle 1.2s ease-in-out infinite;
}

/* overlay marks + ships */
.ar-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.ar-ship {
  position: absolute;
  border-radius: 9px;
  animation: ar-deploy 0.35s ease-out;
}
.ar-ship.live {
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
}
.ar-ship.live:active { cursor: grabbing; }
.ar-ship.dragging {
  z-index: 6;
  opacity: 0.9;
  filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.45));
  box-shadow: 0 0 0 1.5px rgba(16, 185, 129, 0.85), 0 0 18px rgba(16, 185, 129, 0.5);
}
.ar-ship.dragging.invalid {
  box-shadow: 0 0 0 1.5px rgba(235, 68, 90, 0.85), 0 0 18px rgba(235, 68, 90, 0.5);
}
.ar-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}
.ar-pending {
  width: 55%;
  height: 55%;
  border-radius: 50%;
  border: 1.5px dashed rgba(var(--ion-color-primary-rgb), 0.8);
  animation: ar-reticle 1.2s ease-in-out infinite;
}
.ar-miss {
  width: 32%;
  height: 32%;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.14);
  animation: ar-splash 0.45s ease-out;
}
.ar-hit {
  position: relative;
  width: 80%;
  height: 80%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.ar-burst {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 78%;
  height: 78%;
  margin: -39% 0 0 -39%;
  border-radius: 50%;
  background: radial-gradient(circle, #fff6c0 0%, #ffca22 24%, #eb445a 54%, rgba(235, 68, 90, 0) 72%);
  animation: ar-burst 0.55s ease-out forwards;
}
.ar-flame {
  position: relative;
  width: 46%;
  height: 62%;
  transform-origin: 50% 100%;
  animation: ar-flicker 0.5s ease-in-out infinite;
  background:
    radial-gradient(ellipse 50% 34% at 50% 88%, #ffe680 0%, rgba(255, 230, 128, 0) 70%),
    radial-gradient(ellipse 62% 60% at 50% 78%, #ffb226 0%, rgba(255, 178, 38, 0) 74%),
    radial-gradient(ellipse 78% 88% at 50% 72%, #eb5a2a 0%, rgba(235, 90, 42, 0) 78%);
  filter: drop-shadow(0 0 6px rgba(235, 120, 40, 0.85));
  border-radius: 50% 50% 42% 42%;
}
.ar-ember {
  width: 50%;
  height: 50%;
  border-radius: 50%;
  background: radial-gradient(circle, #3a2a20 0%, #241a14 52%, rgba(20, 14, 10, 0) 74%);
  position: relative;
}
.ar-ember::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 36%;
  height: 36%;
  margin: -18% 0 0 -18%;
  border-radius: 50%;
  background: radial-gradient(circle, #ffb04a, #eb5a2a);
  box-shadow: 0 0 5px 1px rgba(235, 120, 40, 0.7);
  animation: ar-ember 1.6s ease-in-out infinite;
}
/* smoke: three staggered puffs, unmounted ~6.5s after the sink */
.ar-smoke {
  position: absolute;
  left: 50%;
  bottom: 48%;
  transform: translateX(-50%);
  width: 26px;
  height: 1px;
  z-index: 9;
  pointer-events: none;
}
.ar-smoke i {
  position: absolute;
  left: 50%;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 58%, rgba(168, 170, 182, 0.95), rgba(120, 122, 134, 0.6) 55%, rgba(90, 92, 104, 0) 74%);
  filter: blur(1.5px);
  transform: translate(-50%, 0);
  will-change: transform, opacity;
}
.ar-smoke i:nth-child(1) { width: 25px; height: 25px; bottom: 0; animation: ar-smoke 2.6s ease-out 0s infinite; }
.ar-smoke i:nth-child(2) { width: 32px; height: 32px; bottom: 14px; animation: ar-smoke-l 2.6s ease-out 0.87s infinite; }
.ar-smoke i:nth-child(3) { width: 39px; height: 39px; bottom: 28px; animation: ar-smoke-r 2.6s ease-out 1.73s infinite; }
.ar-basefire {
  position: absolute;
  left: 50%;
  bottom: 46%;
  margin-left: -7px;
  width: 14px;
  height: 18px;
  z-index: 8;
  pointer-events: none;
  transform-origin: 50% 100%;
  animation: ar-flicker 0.5s ease-in-out infinite;
  background:
    radial-gradient(ellipse 50% 34% at 50% 88%, #ffe680 0%, rgba(255, 230, 128, 0) 70%),
    radial-gradient(ellipse 62% 60% at 50% 78%, #ffb226 0%, rgba(255, 178, 38, 0) 74%),
    radial-gradient(ellipse 78% 88% at 50% 72%, #eb5a2a 0%, rgba(235, 90, 42, 0) 78%);
  border-radius: 50% 50% 42% 42%;
  filter: drop-shadow(0 0 5px rgba(235, 120, 40, 0.8));
}

/* controls */
.ar-controls {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 20px;
}
.ar-btn {
  padding: 11px 20px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  border: 1px solid rgba(110, 231, 183, 0.25);
  background: rgba(255, 255, 255, 0.04);
  color: #c9ead9;
}
.ar-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.ar-btn.primary {
  border-color: rgba(110, 231, 183, 0.5);
  background: linear-gradient(135deg, #14b686, #0b7d5b);
  color: #fff;
  box-shadow: 0 4px 16px rgba(11, 125, 91, 0.45);
}
.ar-btn.danger {
  border-color: rgba(235, 68, 90, 0.35);
  color: #ff8a97;
}

/* rosters */
.ar-rosters {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 22px;
}
.armada.two .ar-rosters {
  flex-direction: row;
  gap: 20px;
  justify-content: center;
}
.armada.two .ar-rosters > .ar-panel {
  flex: 0 1 340px;
}
.ar-roster {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ar-rrow {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 8px 11px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.2s;
}
.ar-rrow.placing {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(255, 255, 255, 0.5);
}
.ar-rrow.sunk {
  background: rgba(235, 68, 90, 0.06);
  border-color: rgba(235, 68, 90, 0.22);
}
.ar-ricon {
  width: 52px;
  height: 14px;
  flex-shrink: 0;
}
.ar-rbody {
  min-width: 0;
}
.ar-rname {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: rgba(238, 248, 242, 0.92);
}
.ar-rrow.sunk .ar-rname {
  color: rgba(255, 180, 190, 0.9);
}
.ar-pips {
  display: flex;
  gap: 3px;
  margin-top: 5px;
}
.ar-pips i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: rgba(110, 231, 183, 0.3);
}
.ar-pips i.hit {
  background: #eb445a;
}
.ar-chip {
  margin-left: auto;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(230, 245, 238, 0.45);
}
.ar-chip.placing { background: rgba(255, 196, 9, 0.16); color: #ffc409; }
.ar-chip.ready { background: rgba(16, 185, 129, 0.14); color: #10b981; }
.ar-chip.active { background: rgba(16, 185, 129, 0.14); color: #10b981; }
.ar-chip.sunk { background: rgba(235, 68, 90, 0.2); color: #ff6b7a; }

/* battle log */
.ar-log {
  max-width: 560px;
  width: 100%;
  margin: 22px auto 0;
  border-radius: 14px;
}
.ar-log-empty,
.ar-log-row {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: rgba(230, 245, 238, 0.78);
}
.ar-log-empty {
  color: rgba(220, 240, 230, 0.4);
}
.ar-log-row {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 7px;
}
.ar-log-row i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ar-log-row .dot-hit { background: #ffc409; }
.ar-log-row .dot-miss { background: rgba(110, 231, 183, 0.5); }
.ar-log-row .dot-sunk { background: #ff6b7a; }
.ar-log-row .dot-info { background: #10b981; }

/* result ceremony */
.ar-result {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(6, 9, 14, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  animation: ar-fade 0.3s ease-out;
}
.ar-result-card {
  width: min(420px, 90%);
  background: linear-gradient(180deg, #18211c, #101713);
  border: 1px solid rgba(255, 107, 122, 0.3);
  border-radius: 22px;
  padding: 28px 26px 24px;
  text-align: center;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  animation: ar-rise 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
}
.ar-result-card.won {
  border-color: rgba(255, 201, 34, 0.3);
}
.ar-eyebrow {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  letter-spacing: 4px;
  color: rgba(110, 231, 183, 0.6);
  margin-bottom: 4px;
}
.ar-medal {
  display: flex;
  justify-content: center;
  margin: 6px 0 2px;
  animation: ar-medal 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
}
.ar-verdict {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 6px;
  color: #ff6b7a;
  margin-top: 6px;
}
.ar-verdict.won { color: #ffd76b; }
.ar-rank {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  letter-spacing: 2px;
  color: #ff8a97;
  margin-top: 6px;
}
.ar-rank.won { color: #ffd76b; }
.ar-citation {
  font-size: 13px;
  color: rgba(220, 240, 230, 0.65);
  line-height: 1.5;
  margin: 10px auto 0;
  max-width: 320px;
}
.ar-stats {
  display: flex;
  gap: 8px;
  margin: 20px 0 22px;
  padding: 14px 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
}
.ar-stat {
  flex: 1;
  text-align: center;
}
.ar-stat b {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 22px;
  font-weight: 700;
  color: #e9f5ee;
}
.ar-stat b.acc { color: #10b981; }
.ar-stat b.good { color: #10b981; }
.ar-stat b.bad { color: #ff8a97; }
.ar-stat span {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  letter-spacing: 1.5px;
  color: rgba(220, 240, 230, 0.5);
  margin-top: 3px;
  text-transform: uppercase;
}
.ar-result-btns {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

/* animations (handoff table) */
@keyframes ar-radar { to { transform: rotate(360deg); } }
@keyframes ar-reticle { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.16); opacity: 1; } }
@keyframes ar-deploy { 0% { transform: scale(0.82); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
@keyframes ar-splash { 0% { transform: scale(0); opacity: 0; } 55% { transform: scale(1.2); opacity: 1; } 100% { transform: scale(1); opacity: 0.85; } }
@keyframes ar-burst { 0% { transform: scale(0.2); opacity: 0; } 28% { transform: scale(1.25); opacity: 1; } 100% { transform: scale(1.75); opacity: 0; } }
@keyframes ar-flicker { 0%, 100% { transform: scale(1, 1); opacity: 0.92; } 25% { transform: scale(1.09, 0.94) translateY(-1px); opacity: 1; } 50% { transform: scale(0.93, 1.07); opacity: 0.82; } 75% { transform: scale(1.06, 0.97) translateY(-1px); opacity: 1; } }
@keyframes ar-ember { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.95; } }
@keyframes ar-smoke { 0% { opacity: 0; transform: translate(-50%, 0) scale(0.4); } 18% { opacity: 0.72; } 60% { opacity: 0.5; } 100% { opacity: 0; transform: translate(-50%, -420%) scale(2.1); } }
@keyframes ar-smoke-l { 0% { opacity: 0; transform: translate(-50%, 0) scale(0.4); } 18% { opacity: 0.68; } 60% { opacity: 0.46; } 100% { opacity: 0; transform: translate(-135%, -400%) scale(2); } }
@keyframes ar-smoke-r { 0% { opacity: 0; transform: translate(-50%, 0) scale(0.4); } 18% { opacity: 0.68; } 60% { opacity: 0.46; } 100% { opacity: 0; transform: translate(35%, -410%) scale(2); } }
@keyframes ar-fade { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes ar-rise { 0% { transform: translateY(28px) scale(0.96); opacity: 0; } 100% { transform: translateY(0) scale(1); opacity: 1; } }
@keyframes ar-medal { 0% { transform: scale(0.3) rotate(-14deg); opacity: 0; } 55% { transform: scale(1.12) rotate(4deg); opacity: 1; } 100% { transform: scale(1) rotate(0); } }
</style>
