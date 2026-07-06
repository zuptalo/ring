<template>
  <!-- Battleship (spec 0011). Three faces:
       placing → YOUR sea, randomly fleeted, with Shuffle / Ready;
       battle  → the opponent's sea on top (tap to fire), your own mini sea
                 below with their shots marked;
       observer → both PUBLIC seas, no ships (this device holds no secret).
       The board also runs the protocol's automatic moves: answering incoming
       shots from the local secret and the winner's closing reveal — both are
       ordinary @move emissions, validated by the same engine as taps. -->
  <div class="bs" :style="accent ? { '--game-accent': accent } : undefined">
    <!-- PLACING: my fleet preview until Ready; then a waiting note. -->
    <template v-if="phase === 'placing' && myPlayer !== null && !iCommitted">
      <div class="bs-grid bs-own-lg">
        <button
          v-for="cell in 64"
          :key="cell"
          type="button"
          class="bs-cell"
          :class="{ ship: previewCells.has(cell - 1) }"
          disabled
        >
          <span v-if="previewCells.has(cell - 1)" class="bs-ship-glyph">{{ shipGlyph }}</span>
        </button>
      </div>
      <div class="bs-actions">
        <ion-button size="small" fill="clear" @click.stop="shuffle">
          <animated-emoji emoji="🎲" />&nbsp;Shuffle
        </ion-button>
        <ion-button size="small" shape="round" @click.stop="ready">
          <animated-emoji emoji="⚓" />&nbsp;Ready
        </ion-button>
      </div>
    </template>
    <template v-else-if="phase === 'placing'">
      <p class="bs-note">
        <animated-emoji emoji="⏳" />
        {{ iCommitted ? 'Waiting for their fleet…' : 'Fleets are being placed…' }}
      </p>
    </template>

    <!-- BATTLE / VERIFY / DONE: the public seas. -->
    <template v-else>
      <div class="bs-sea">
        <div class="bs-sea-label">{{ observing ? "Second player's sea" : 'Their sea' }}</div>
        <div class="bs-grid">
          <button
            v-for="cell in 64"
            :key="cell"
            type="button"
            class="bs-cell"
            :class="{ hit: theirSea.get(cell - 1) === 'hit' || theirSea.get(cell - 1) === 'sunk' }"
            :disabled="!canFire || theirSea.has(cell - 1)"
            :aria-label="fireLabel(cell - 1)"
            @click.stop="fire(cell - 1)"
          >
            <animated-emoji
              v-if="theirSea.has(cell - 1)"
              :emoji="resultEmoji(theirSea.get(cell - 1)!)"
              :animate="lastShot?.by === myIdx && lastShot?.cell === cell - 1"
              class="bs-mark"
            />
          </button>
        </div>
      </div>
      <div class="bs-sea">
        <div class="bs-sea-label">{{ observing ? "First player's sea" : 'Your sea' }}</div>
        <div class="bs-grid bs-own">
          <button
            v-for="cell in 64"
            :key="cell"
            type="button"
            class="bs-cell"
            :class="{ ship: ownCells.has(cell - 1) }"
            disabled
          >
            <animated-emoji
              v-if="mySea.has(cell - 1)"
              :emoji="resultEmoji(mySea.get(cell - 1)!)"
              :animate="lastShot?.by !== myIdx && lastShot?.cell === cell - 1"
              class="bs-mark"
            />
            <span v-else-if="ownCells.has(cell - 1)" class="bs-ship-glyph">{{ shipGlyph }}</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { IonButton } from '@ionic/vue';
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';
import {
  randomLayout,
  randomSalt,
  commitment,
  judgeShot,
  cellsOf,
  FLEET_CELLS,
  type BsMove,
  type BsState,
  type Layout,
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

// GameBubble passes observers as myPlayer 0 with canMove false — a REAL seat
// is telling: my commitment slot is what makes me a player (observers never
// commit, and their device holds no secret, so ship rendering is naturally
// empty for them even before this check).
const iCommitted = computed(() => props.state.commits[props.myPlayer] !== null);
const bothCommitted = computed(() => props.state.commits[0] !== null && props.state.commits[1] !== null);
const phase = computed(() => (bothCommitted.value ? 'battle' : 'placing'));
const myIdx = computed(() => props.myPlayer);
// Observers reach boards as seat 0 with canMove false and, crucially, NO local
// secret — a real player in battle always holds theirs (it was stored at
// Ready). Secretless-in-battle is therefore the observer signal for labels;
// ship rendering is safe either way because there is nothing to render.
const observing = computed(() => phase.value === 'battle' && !secret.value);
const shipGlyph = computed(() => props.marks?.[props.myPlayer] ?? '🚢');

/* ---- placing ---- */
const preview = ref<Layout>(randomLayout());
const previewCells = computed(() => new Set(preview.value.flatMap(cellsOf)));
const shuffle = (): void => {
  preview.value = randomLayout();
};
const ready = (): void => {
  const layout = preview.value;
  const salt = randomSalt();
  const h = commitment(layout, salt);
  void setFleetSecret(h, { layout, salt }).then(() => emit('move', { t: 'commit', h }));
};

/* ---- battle rendering (all PUBLIC data) ---- */
const shotMap = (attacker: 0 | 1) => {
  const m = new Map<number, 'miss' | 'hit' | 'sunk'>();
  for (const rec of props.state.shots[attacker]) m.set(rec.cell, rec.r);
  const p = props.state.pending;
  if (p && p.by === attacker) m.set(p.cell, 'miss' as never); // pending renders as a splashless marker
  return m;
};
const theirSea = computed(() => shotMap(myIdx.value)); // MY shots land on THEIR sea
const mySea = computed(() => shotMap((1 - myIdx.value) as 0 | 1));
const resultEmoji = (r: 'miss' | 'hit' | 'sunk'): string => (r === 'miss' ? '💦' : r === 'sunk' ? '🔥' : '💥');
const lastShot = computed(() => {
  const p = props.state.pending;
  if (p) return { by: p.by, cell: p.cell };
  const a = props.state.shots[0].length + props.state.shots[1].length;
  if (!a) return null;
  const more0 = props.state.shots[0].length > props.state.shots[1].length;
  const even = props.state.shots[0].length === props.state.shots[1].length;
  const by = more0 ? 0 : even ? 1 : 1;
  const rec = props.state.shots[by][props.state.shots[by].length - 1];
  return rec ? { by, cell: rec.cell } : null;
});
const canFire = computed(
  () => props.canMove && bothCommitted.value && !props.state.pending && props.state.finalBy === null,
);
const fire = (cell: number): void => emit('move', { t: 'shot', cell });
const fireLabel = (cell: number): string =>
  `Fire at row ${Math.floor(cell / 8) + 1}, column ${(cell % 8) + 1}`;

/* ---- my ships (from the DEVICE-LOCAL secret; observers have none) ---- */
const secret = ref<{ layout: Layout; salt: string } | null>(null);
const iCommittedSecret = computed(() => !!secret.value);
const ownCells = computed(() => new Set(secret.value?.layout.flatMap(cellsOf) ?? []));
async function loadSecret(): Promise<void> {
  const h = props.state.commits[props.myPlayer];
  secret.value = h ? await getFleetSecret(h) : null;
}
onMounted(() => void loadSecret().then(autoActions));
watch(() => props.state.commits[props.myPlayer], () => void loadSecret().then(autoActions));

/* ---- the protocol's automatic moves ---- */
// Answering an incoming shot, and the winner's closing reveal, are the
// device's duties, not the user's. Each emission is deduped by a state
// signature so watcher re-fires can't double-send (the engine would drop a
// duplicate anyway — this just avoids the noise).
const lastAuto = ref('');
function autoActions(): void {
  const s = props.state;
  const sec = secret.value;
  if (!sec) return;
  const me = props.myPlayer;
  // Answer a pending shot aimed at me.
  const p = s.pending;
  if (p && p.by !== me) {
    const key = `answer:${p.by}:${p.cell}:${s.shots[p.by].length}`;
    if (lastAuto.value === key) return;
    lastAuto.value = key;
    const incoming = s.shots[p.by].filter((x) => x.r !== 'miss').map((x) => x.cell);
    const r = judgeShot(sec.layout, p.cell, incoming);
    const declared = s.shots[p.by].filter((x) => x.r !== 'miss').length + (r === 'miss' ? 0 : 1);
    if (declared >= FLEET_CELLS) {
      emit('move', { t: 'answer', r: 'sunk', reveal: { layout: sec.layout, salt: sec.salt } });
    } else {
      emit('move', { t: 'answer', r });
    }
    return;
  }
  // The winner's closing reveal.
  if (s.finalBy === me && s.reveals[me] === null) {
    const key = `reveal:${me}`;
    if (lastAuto.value === key) return;
    lastAuto.value = key;
    emit('move', { t: 'reveal', layout: sec.layout, salt: sec.salt });
    return;
  }
  // Terminal with both reveals → the secret is public now; drop it.
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
  gap: 8px;
  width: 100%;
}
.bs-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(var(--game-accent, 30, 64, 175), 0.1);
}
.bs-cell {
  aspect-ratio: 1;
  border: none;
  border-radius: 4px;
  background: rgba(var(--game-accent, 30, 64, 175), 0.14);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
}
.bs-cell:disabled {
  cursor: default;
}
.bs-cell.ship {
  background: rgba(var(--game-accent, 30, 64, 175), 0.42);
}
.bs-cell.hit {
  background: rgba(239, 68, 68, 0.28);
}
.bs-own .bs-cell,
.bs-own-lg .bs-cell {
  border-radius: 3px;
}
.bs-own {
  transform-origin: top left;
}
.bs-sea-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--app-text-muted);
  margin: 2px 2px 3px;
}
.bs-ship-glyph {
  font-size: 12px;
  line-height: 1;
}
.bs-mark {
  font-size: 13px;
  line-height: 1;
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
  gap: 4px;
}
.bs-actions ion-button {
  font-size: 13px;
  text-transform: none;
}
</style>
