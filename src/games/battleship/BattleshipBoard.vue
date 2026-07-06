<template>
  <!-- Battleship, submarine edition (spec 1033 — the vendored handoff is the
       pixel spec). Three faces, unchanged protocol:
       placing → your sea with draggable/rotatable submarines, Shuffle, Deploy;
       battle  → Their sea (fire here; radar sweep; ripples/fire/charred cells;
                 wrecks only after the end-of-game reveal) over Your sea (your
                 boats; incoming shots; your sunk subs become wrecks at once);
       observer → both public seas, no fleets until the reveal.
       Answers and the winner's reveal remain the device's automatic duties. -->
  <div class="bs">
    <!-- PLACING: author your fleet. -->
    <template v-if="phase === 'placing' && !iCommitted">
      <div class="bs-hint">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" />
          <line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" />
        </svg>
        <span>Drag ships to move · tap to rotate</span>
      </div>
      <div ref="placeWrap" class="bs-sea-wrap">
        <div class="bs-grid">
          <div v-for="cell in 64" :key="cell" class="bs-cell" />
        </div>
        <div class="bs-overlay">
          <div
            v-for="(ship, i) in preview"
            :key="i"
            class="bs-ship bs-ship-live"
            :style="boxStyle(dragIdx === i ? dragPos.r : ship.r, dragIdx === i ? dragPos.c : ship.c, ship.dir === 'h' ? ship.len : 1, ship.dir === 'h' ? 1 : ship.len)"
            :class="{ dragging: dragIdx === i }"
            @pointerdown="onShipDown(i, $event)"
            @pointermove="onShipMove($event)"
            @pointerup="onShipUp($event)"
            @pointercancel="onShipCancel()"
          >
            <submarine-svg :len="ship.len" :vertical="ship.dir === 'v'" :invalid="dragIdx === i && dragInvalid" />
          </div>
        </div>
      </div>
      <div class="bs-actions">
        <button type="button" class="bs-btn-ghost" @click.stop="shuffle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" />
          </svg>
          Shuffle
        </button>
        <button type="button" class="bs-btn-deploy" @click.stop="ready">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#04150f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          Deploy fleet
        </button>
      </div>
    </template>
    <template v-else-if="phase === 'placing'">
      <p class="bs-note">
        <span class="bs-spinner" aria-hidden="true" />
        Waiting for their fleet…
      </p>
    </template>

    <!-- BATTLE / VERIFY / DONE -->
    <template v-else>
      <div v-if="!gameOver" class="bs-turn" :class="{ mine: canFire }">
        <template v-if="canFire">
          <svg width="16" height="16" viewBox="0 0 24 24" class="bs-strip-ret">
            <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 4.5" stroke-linecap="round" class="bs-ret-spin" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
          </svg>
          <span>Your shot — tap their sea</span>
        </template>
        <template v-else>
          <span class="bs-spinner" aria-hidden="true" />
          <span>{{ observing ? 'Battle under way' : 'Waiting for their move…' }}</span>
        </template>
      </div>

      <!-- Their sea -->
      <div class="bs-sea">
        <div class="bs-sea-label">{{ observing ? "Second player's sea" : 'Their sea' }}</div>
        <div class="bs-sea-wrap" :class="{ 'bs-live': canFire, 'bs-dim': !canFire && !observing && !gameOver }">
          <div class="bs-grid">
            <button
              v-for="cell in 64"
              :key="cell"
              type="button"
              class="bs-cell"
              :class="cellTint(theirSea.get(cell - 1))"
              :disabled="!canFire || theirSea.has(cell - 1)"
              :aria-label="fireLabel(cell - 1)"
              @click.stop="fire(cell - 1)"
            />
          </div>
          <!-- sonar radar: above the water, below the shots; never blocks taps -->
          <div class="bs-radar" :style="{ opacity: canFire ? 0.95 : 0.5 }" aria-hidden="true">
            <div class="bs-radar-v" /><div class="bs-radar-h" />
            <div class="bs-radar-ring r1" /><div class="bs-radar-ring r2" /><div class="bs-radar-ring r3" />
            <div class="bs-radar-sweep" /><div class="bs-radar-ping" />
          </div>
          <div class="bs-overlay">
            <!-- their wrecks: only once the END-OF-GAME reveal made them public -->
            <div v-for="(ship, i) in theirWrecks" :key="'w' + i" class="bs-ship" :style="shipBox(ship)">
              <submarine-svg :len="ship.len" :vertical="ship.dir === 'v'" wreck />
            </div>
            <div v-for="[cell, r] in theirSea" :key="'s' + cell" class="bs-mark" :style="boxStyle(Math.floor(cell / 8), cell % 8, 1, 1)">
              <span v-if="r === 'pending'" class="bs-reticle" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.4" class="bs-ret-pulse" />
                  <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="4 3.6" class="bs-ret-spin" />
                  <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                  <path d="M12 1v3.2M12 19.8V23M1 12h3.2M19.8 12H23" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </span>
              <span v-else-if="r === 'miss'" class="bs-ripple" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.45" />
                  <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2" class="rip rip-a" />
                  <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2" class="rip rip-b" />
                </svg>
              </span>
              <span v-else-if="!theirWrecks.length || r === 'hit'" class="bs-flame" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 2 C15 7 18 9.5 16.5 14 A5.4 5.4 0 1 1 7.5 14 C6.6 10.6 9.6 9.6 10 6.4 C10.7 8.4 11 8.2 12 2 Z" fill="#fb923c" class="fl fl-a" />
                  <path d="M12 8 C13.7 10.6 15 11.6 14 14.6 A3 3 0 1 1 9.6 14.7 C9.3 12.7 11.1 12.1 12 8 Z" fill="#fde047" class="fl fl-b" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Your sea -->
      <div class="bs-sea">
        <div class="bs-sea-label">{{ observing ? "First player's sea" : 'Your sea' }}</div>
        <div class="bs-sea-wrap">
          <div class="bs-grid">
            <div v-for="cell in 64" :key="cell" class="bs-cell" :class="cellTint(mySea.get(cell - 1))" />
          </div>
          <div class="bs-overlay">
            <div v-for="(ship, i) in ownShips" :key="'o' + i" class="bs-ship" :style="shipBox(ship.ship)">
              <submarine-svg :len="ship.ship.len" :vertical="ship.ship.dir === 'v'" :wreck="ship.sunk" />
            </div>
            <div v-for="[cell, r] in mySeaMarks" :key="'m' + cell" class="bs-mark" :style="boxStyle(Math.floor(cell / 8), cell % 8, 1, 1)">
              <span v-if="r === 'miss'" class="bs-ripple" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.45" />
                  <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2" class="rip rip-a" />
                </svg>
              </span>
              <span v-else class="bs-flame" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 2 C15 7 18 9.5 16.5 14 A5.4 5.4 0 1 1 7.5 14 C6.6 10.6 9.6 9.6 10 6.4 C10.7 8.4 11 8.2 12 2 Z" fill="#fb923c" class="fl fl-a" />
                  <path d="M12 8 C13.7 10.6 15 11.6 14 14.6 A3 3 0 1 1 9.6 14.7 C9.3 12.7 11.1 12.1 12 8 Z" fill="#fde047" class="fl fl-b" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import SubmarineSvg from './SubmarineSvg.vue';
import { ready as sodiumReady } from '@/services/crypto/primitives';
import {
  randomLayout,
  randomSalt,
  commitment,
  judgeShot,
  cellsOf,
  layoutLegal,
  FLEET_CELLS,
  type BsMove,
  type BsState,
  type Layout,
  type Ship,
} from './logic';
import { getFleetSecret, setFleetSecret, clearFleetSecret } from './secret';

const props = defineProps<{
  state: BsState;
  myPlayer: 0 | 1;
  canMove: boolean;
  marks?: [string, string];
  accent?: string;
  lastMove?: BsMove | null;
}>();
const emit = defineEmits<{ (e: 'move', move: BsMove): void }>();

const iCommitted = computed(() => props.state.commits[props.myPlayer] !== null);
const bothCommitted = computed(() => props.state.commits[0] !== null && props.state.commits[1] !== null);
const phase = computed(() => (bothCommitted.value ? 'battle' : 'placing'));
const myIdx = computed(() => props.myPlayer);
// A real player in battle always holds their secret (stored at Deploy);
// observers never do — the observer signal for labels (spec 0011).
const observing = computed(() => phase.value === 'battle' && !secret.value && !myReveal.value);
const gameOver = computed(
  () => props.state.finalBy !== null && props.state.reveals[0] !== null && props.state.reveals[1] !== null,
);

/* ---- overlay positioning math (handoff §Positioning math) ---- */
const off = (n: number): string => `calc((100% - 14px) / 8 * ${n} + ${n * 2}px)`;
const sz = (n: number): string => `calc((100% - 14px) / 8 * ${n} + ${(n - 1) * 2}px)`;
const boxStyle = (r: number, c: number, cs: number, rs: number) => ({
  position: 'absolute' as const,
  left: off(c),
  top: off(r),
  width: sz(cs),
  height: sz(rs),
});
const shipBox = (s: Ship) => boxStyle(s.r, s.c, s.dir === 'h' ? s.len : 1, s.dir === 'h' ? 1 : s.len);

/* ---- placing: authorable fleet (drag to move, tap to rotate) ---- */
const preview = ref<Layout>(randomLayout());
const shuffle = (): void => {
  preview.value = randomLayout();
};
const placeWrap = ref<HTMLElement>();
const dragIdx = ref(-1);
const dragPos = ref({ r: 0, c: 0 });
const dragInvalid = ref(false);
let dragMoved = false;
let grabOffset = { r: 0, c: 0 };
let dragStart = { r: 0, c: 0 };

function cellFromPointer(ev: PointerEvent): { r: number; c: number } | null {
  const grid = placeWrap.value?.querySelector('.bs-grid') as HTMLElement | null;
  if (!grid) return null;
  const rect = grid.getBoundingClientRect();
  const pitch = (rect.width - 8 - 14) / 8 + 2;
  const c = Math.floor((ev.clientX - rect.left - 4) / pitch);
  const r = Math.floor((ev.clientY - rect.top - 4) / pitch);
  return { r, c };
}
const clampShip = (s: Ship): Ship => ({
  ...s,
  r: Math.max(0, Math.min(s.dir === 'v' ? 8 - s.len : 7, s.r)),
  c: Math.max(0, Math.min(s.dir === 'h' ? 8 - s.len : 7, s.c)),
});
const candidateLegal = (idx: number, moved: Ship): boolean =>
  layoutLegal(preview.value.map((s, i) => (i === idx ? moved : s)));

function onShipDown(i: number, ev: PointerEvent): void {
  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  const cell = cellFromPointer(ev);
  const ship = preview.value[i];
  dragIdx.value = i;
  dragMoved = false;
  dragInvalid.value = false;
  dragStart = { r: ship.r, c: ship.c };
  dragPos.value = { r: ship.r, c: ship.c };
  grabOffset = cell ? { r: cell.r - ship.r, c: cell.c - ship.c } : { r: 0, c: 0 };
}
function onShipMove(ev: PointerEvent): void {
  if (dragIdx.value < 0) return;
  const cell = cellFromPointer(ev);
  if (!cell) return;
  const ship = preview.value[dragIdx.value];
  const next = clampShip({ ...ship, r: cell.r - grabOffset.r, c: cell.c - grabOffset.c });
  if (next.r !== dragPos.value.r || next.c !== dragPos.value.c) dragMoved = true;
  dragPos.value = { r: next.r, c: next.c };
  dragInvalid.value = !candidateLegal(dragIdx.value, next);
}
function onShipUp(ev: PointerEvent): void {
  if (dragIdx.value < 0) return;
  const i = dragIdx.value;
  const ship = preview.value[i];
  if (!dragMoved) {
    // Tap = rotate 90°, clamped into bounds; declined when it can't fit.
    const rotated = clampShip({ ...ship, dir: ship.dir === 'h' ? 'v' : 'h' });
    if (candidateLegal(i, rotated)) {
      preview.value = preview.value.map((s, k) => (k === i ? rotated : s));
    }
  } else {
    const dropped = { ...ship, r: dragPos.value.r, c: dragPos.value.c };
    // Invalid drop snaps back to where the drag began.
    preview.value = preview.value.map((s, k) =>
      k === i ? (candidateLegal(i, dropped) ? dropped : { ...ship, ...dragStart }) : s,
    );
  }
  dragIdx.value = -1;
  dragInvalid.value = false;
  void ev;
}
function onShipCancel(): void {
  dragIdx.value = -1;
  dragInvalid.value = false;
}

/** Deploy = exactly the old Ready: commit the AUTHORED layout. */
const ready = (): void => {
  const layout = preview.value.map((s) => ({ r: s.r, c: s.c, len: s.len, dir: s.dir }));
  void (async () => {
    await sodiumReady();
    const salt = randomSalt();
    const h = commitment(layout, salt);
    await setFleetSecret(h, { layout, salt });
    emit('move', { t: 'commit', h });
  })().catch(() => {});
};

/* ---- battle rendering (public data + my own fleet) ---- */
const shotMap = (attacker: 0 | 1) => {
  const m = new Map<number, 'miss' | 'hit' | 'sunk' | 'pending'>();
  for (const rec of props.state.shots[attacker]) m.set(rec.cell, rec.r);
  const p = props.state.pending;
  if (p && p.by === attacker) m.set(p.cell, 'pending');
  return m;
};
const theirSea = computed(() => shotMap(myIdx.value));
const mySea = computed(() => shotMap((1 - myIdx.value) as 0 | 1));
const mySeaMarks = computed(() => [...mySea.value.entries()].filter(([, r]) => r !== 'pending'));
const cellTint = (r?: 'miss' | 'hit' | 'sunk' | 'pending'): string =>
  r === 'hit' ? 'charred' : r === 'sunk' ? 'sunken' : '';
const canFire = computed(
  () => props.canMove && bothCommitted.value && !props.state.pending && props.state.finalBy === null,
);
const fire = (cell: number): void => emit('move', { t: 'shot', cell });
const fireLabel = (cell: number): string =>
  `Fire at row ${Math.floor(cell / 8) + 1}, column ${(cell % 8) + 1}`;

// My fleet: the device-local secret while playing, or my reveal once public
// (the secret is cleared at game end). A sub whose every cell is hit is a wreck.
const secret = ref<{ layout: Layout; salt: string } | null>(null);
const myReveal = computed(() => props.state.reveals[myIdx.value]);
const ownLayout = computed<Layout | null>(() => secret.value?.layout ?? myReveal.value?.layout ?? null);
const ownShips = computed(() => {
  const layout = ownLayout.value;
  if (!layout) return [] as { ship: Ship; sunk: boolean }[];
  const hits = new Set([...mySea.value.entries()].filter(([, r]) => r === 'hit' || r === 'sunk').map(([c]) => c));
  return layout.map((ship) => ({ ship, sunk: cellsOf(ship).every((c) => hits.has(c)) }));
});
// Their fleet exists for us ONLY as the end-of-game reveal (protocol timing).
const theirWrecks = computed<Layout>(() => props.state.reveals[(1 - myIdx.value) as 0 | 1]?.layout ?? []);

async function loadSecret(): Promise<void> {
  const h = props.state.commits[props.myPlayer];
  secret.value = h ? await getFleetSecret(h) : null;
}
onMounted(() => void loadSecret().then(autoActions));
watch(() => props.state.commits[props.myPlayer], () => void loadSecret().then(autoActions));

/* ---- the protocol's automatic moves (unchanged from spec 0011) ---- */
// The secret ref deep-reactifies its layout; a Proxy-wrapped array inside an
// emitted move throws DataCloneError when the applied move is stored — the
// reveal must leave as PLAIN data.
const plainLayout = (l: Layout): Layout => l.map((sp) => ({ r: sp.r, c: sp.c, len: sp.len, dir: sp.dir }));
const lastAuto = ref('');
function autoActions(): void {
  const s = props.state;
  const sec = secret.value;
  if (!sec) return;
  const me = props.myPlayer;
  const p = s.pending;
  if (p && p.by !== me) {
    const key = `answer:${p.by}:${p.cell}:${s.shots[p.by].length}`;
    if (lastAuto.value === key) return;
    lastAuto.value = key;
    const incoming = s.shots[p.by].filter((x) => x.r !== 'miss').map((x) => x.cell);
    const r = judgeShot(sec.layout, p.cell, incoming);
    const declared = s.shots[p.by].filter((x) => x.r !== 'miss').length + (r === 'miss' ? 0 : 1);
    if (declared >= FLEET_CELLS) {
      emit('move', { t: 'answer', r: 'sunk', reveal: { layout: plainLayout(sec.layout), salt: sec.salt } });
    } else {
      emit('move', { t: 'answer', r });
    }
    return;
  }
  if (s.finalBy === me && s.reveals[me] === null) {
    const key = `reveal:${me}`;
    if (lastAuto.value === key) return;
    lastAuto.value = key;
    emit('move', { t: 'reveal', layout: plainLayout(sec.layout), salt: sec.salt });
    return;
  }
  if (s.finalBy !== null && s.reveals[0] && s.reveals[1]) {
    const h = s.commits[me];
    if (h) void clearFleetSecret(h);
  }
}
watch(() => props.state, autoActions, { deep: true });
</script>

<style scoped>
.bs {
  display: flex;
  flex-direction: column;
  gap: 9px;
  width: 100%;
}
/* Water (handoff sea tokens): depth gradient behind cells, sea-blue fills. */
.bs-sea-wrap {
  position: relative;
  transition: opacity 0.25s ease, box-shadow 0.25s ease;
  border-radius: 10px;
}
.bs-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  padding: 4px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(28, 92, 140, 0.07), rgba(28, 92, 140, 0.16));
}
.bs-cell {
  aspect-ratio: 1;
  border: none;
  border-radius: 4px;
  background: rgba(28, 92, 140, 0.13);
  padding: 0;
  cursor: pointer;
}
.bs-cell:disabled {
  cursor: default;
}
.bs-cell.charred {
  background: rgba(120, 60, 30, 0.2);
}
.bs-cell.sunken {
  background: rgba(70, 84, 110, 0.22);
}
.bs-live {
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.55);
}
.bs-dim {
  opacity: 0.6;
}
/* Ships / shots overlay: each box positions from its OWN coords (handoff:
   independent absolute boxes so moving one ship never reflows another). */
.bs-overlay {
  position: absolute;
  inset: 4px;
  pointer-events: none;
}
.bs-ship {
  pointer-events: none;
}
.bs-ship-live {
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
}
.bs-ship-live.dragging {
  cursor: grabbing;
  filter: drop-shadow(0 4px 5px rgba(0, 0, 0, 0.35));
}
.bs-mark {
  display: flex;
  align-items: center;
  justify-content: center;
}
.bs-mark > span {
  width: 74%;
  height: 74%;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: mark-pop 0.3s ease-out both;
}
.bs-mark svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}
.bs-reticle {
  color: var(--ion-color-primary);
}
.bs-ret-spin {
  transform-box: fill-box;
  transform-origin: center;
  animation: ret-spin 3.5s linear infinite;
}
.bs-ret-pulse {
  transform-box: fill-box;
  transform-origin: center;
  animation: ret-pulse 1.4s ease-in-out infinite;
}
.bs-ripple {
  color: rgba(2, 6, 23, 0.42);
}
:root.ion-palette-dark .bs-ripple {
  color: rgba(255, 255, 255, 0.55);
}
.rip {
  transform-box: fill-box;
  transform-origin: center;
  animation: rip 0.7s ease-out both;
}
.rip-b {
  animation-delay: 0.18s;
}
.fl {
  transform-box: fill-box;
  transform-origin: 50% 92%;
  animation: flicker 0.5s ease-in-out infinite alternate;
}
.fl-b {
  animation-duration: 0.38s;
  animation-delay: 0.12s;
}
/* Radar (handoff §Radar): above the water, below ships/shots, taps unblocked. */
.bs-radar {
  position: absolute;
  inset: 4px;
  border-radius: 10px;
  overflow: hidden;
  pointer-events: none;
  transition: opacity 0.35s ease;
}
.bs-radar-v { position: absolute; left: 50%; top: 7%; bottom: 7%; width: 1px; margin-left: -0.5px; background: rgba(16, 185, 129, 0.13); }
.bs-radar-h { position: absolute; top: 50%; left: 7%; right: 7%; height: 1px; margin-top: -0.5px; background: rgba(16, 185, 129, 0.13); }
.bs-radar-ring { position: absolute; border-radius: 50%; }
.bs-radar-ring.r1 { inset: 15%; border: 1px solid rgba(16, 185, 129, 0.16); }
.bs-radar-ring.r2 { inset: 32%; border: 1px solid rgba(16, 185, 129, 0.13); }
.bs-radar-ring.r3 { inset: 47%; border: 1px solid rgba(16, 185, 129, 0.11); }
/* The NEGATIVE rotation keeps the bright edge leading and the fade trailing. */
.bs-radar-sweep {
  position: absolute;
  left: -25%;
  top: -25%;
  width: 150%;
  height: 150%;
  border-radius: 50%;
  transform-origin: center;
  animation: radar-sweep 3.8s linear infinite;
  background: conic-gradient(from 0deg, rgba(16, 185, 129, 0.32), rgba(16, 185, 129, 0.06) 26deg, rgba(16, 185, 129, 0) 56deg, rgba(16, 185, 129, 0) 360deg);
}
.bs-radar-ping {
  position: absolute;
  inset: 15%;
  border-radius: 50%;
  border: 1.5px solid rgba(16, 185, 129, 0.45);
  transform-origin: center;
  animation: sonar-ping 3.8s ease-out infinite;
}
/* Turn strip + placing chrome */
.bs-turn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-muted);
  margin: 0 2px;
}
.bs-turn.mine {
  color: var(--ion-color-primary);
}
.bs-strip-ret {
  overflow: visible;
  flex: none;
}
.bs-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ion-color-primary);
  margin: 0 2px;
}
.bs-sea-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--app-text-muted);
  margin: 2px 2px 3px;
}
.bs-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
  font-size: 13px;
  color: var(--app-text-muted);
}
.bs-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
.bs-btn-ghost {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--ion-color-primary);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 10px;
  cursor: pointer;
}
.bs-btn-deploy {
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--ion-color-primary);
  border: none;
  color: #04150f;
  font-size: 13px;
  font-weight: 700;
  padding: 7px 15px;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: 0 4px 10px -3px rgba(16, 185, 129, 0.6);
}
.bs-spinner {
  width: 14px;
  height: 14px;
  flex: none;
  border-radius: 50%;
  border: 2px dashed var(--app-text-muted);
  animation: bs-spin 0.9s linear infinite;
}
@keyframes ret-spin { to { transform: rotate(360deg); } }
@keyframes ret-pulse { 0%, 100% { opacity: 0.28; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.28); } }
@keyframes rip { 0% { transform: scale(0.32); opacity: 0.85; } 100% { transform: scale(1.7); opacity: 0; } }
@keyframes mark-pop { 0% { transform: scale(0.15); opacity: 0; } 60% { transform: scale(1.2); } 100% { transform: scale(1); opacity: 1; } }
@keyframes flicker { 0% { transform: scaleY(0.86) scaleX(1.04); } 100% { transform: scaleY(1.14) scaleX(0.94); } }
@keyframes radar-sweep { to { transform: rotate(-360deg); } }
@keyframes sonar-ping { 0% { transform: scale(0.12); opacity: 0.55; } 80% { opacity: 0; } 100% { transform: scale(1); opacity: 0; } }
@keyframes bs-spin { to { transform: rotate(360deg); } }
</style>
