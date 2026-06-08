<template>
  <ion-modal
    :is-open="open"
    class="viewer-modal"
    @did-present="goToStart"
    @did-dismiss="$emit('close')"
  >
    <ion-content :scroll-y="false" class="viewer-content">
      <!-- Top bar: back · centered sender + date/time · caption pen · overflow.
           Hidden (along with the bottom controls) when the media is tapped, for a
           distraction-free view. -->
      <div class="v-top" :class="{ hidden: chromeHidden }">
        <button class="v-icon" aria-label="Close" @click="$emit('close')">
          <ion-icon :icon="chevronBack" />
        </button>
        <div class="v-title">
          <div class="v-sender">{{ cur?.senderName }}</div>
          <div class="v-when">{{ cur?.when }}</div>
        </div>
        <button v-if="cur?.outgoing" class="v-icon" aria-label="Caption" @click="$emit('caption', cur.id)">
          <ion-icon :icon="pencil" />
        </button>
        <button class="v-icon" aria-label="More" @click="menu = !menu">
          <ion-icon :icon="ellipsisHorizontal" />
        </button>
        <div v-if="menu" class="v-menu" @click="menu = false">
          <button @click="$emit('allmedia')"><ion-icon :icon="imagesOutline" /> All media</button>
          <button @click="$emit('goto', cur.id)"><ion-icon :icon="chatbubbleOutline" /> Go to message</button>
        </div>
      </div>

      <!-- Swipeable media; pinch to zoom + pan, vertical drag dismisses, single tap
           toggles the chrome. Swiping between items is disabled while zoomed in. -->
      <div
        ref="track"
        class="viewer-track"
        :class="{ zoomed: zoom.scale > 1 }"
        :style="dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : {}"
        @scroll.passive="onScroll"
        @touchstart.passive="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @wheel="onWheel"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
      >
        <div v-for="(it, i) in items" :key="it.id" class="viewer-slide">
          <div class="zoom-layer" :style="i === index ? zoomStyle : undefined">
            <img v-if="it.kind === 'image'" :src="it.url" alt="" @click="onMediaClick" @dblclick="onMediaDblClick" />
            <video-player v-else-if="i === index || nearby(i)" :src="it.url" />
          </div>
        </div>
      </div>

      <!-- Bottom: reactions · caption · quick-react · actions · thumbnail strip -->
      <div class="v-bottom" :class="{ hidden: chromeHidden }">
        <div v-if="cur?.reactions?.length" class="v-reactions">
          <span v-for="r in cur.reactions" :key="r.emoji" class="v-react-pill">
            {{ r.emoji }}<span v-if="r.count > 1" class="v-react-n">{{ r.count }}</span>
          </span>
        </div>
        <div v-if="cur?.caption" class="v-caption">{{ cur.caption }}</div>

        <div v-if="showEmojis" class="v-emojis">
          <button v-for="e in QUICK" :key="e" @click="react(e)">{{ e }}</button>
        </div>

        <!-- Action buttons sit on a translucent dark pill so they stay legible over a
             bright or tall image showing behind them. -->
        <div class="v-actions">
          <button aria-label="React" @click="showEmojis = !showEmojis"><ion-icon :icon="happyOutline" /></button>
          <button aria-label="Reply" @click="$emit('reply', cur.id)"><ion-icon :icon="arrowUndoOutline" /></button>
          <button aria-label="Save" @click="$emit('save', cur.id)"><ion-icon :icon="downloadOutline" /></button>
          <button aria-label="Forward" @click="$emit('share', cur.id)"><ion-icon :icon="shareOutline" /></button>
          <button aria-label="Favorite" :class="{ on: cur?.favorite }" @click="$emit('favorite', cur.id)">
            <ion-icon :icon="cur?.favorite ? star : starOutline" />
          </button>
          <button aria-label="Delete" @click="$emit('del', cur.id)"><ion-icon :icon="trashOutline" /></button>
        </div>

        <!-- All chat media as a slidable thumbnail strip, below the actions; the
             current one is lit. -->
        <div v-if="items.length > 1" ref="strip" class="v-strip">
          <button
            v-for="(it, i) in items"
            :key="it.id"
            class="v-thumb"
            :class="{ on: i === index }"
            :data-i="i"
            @click="jump(i)"
          >
            <img :src="it.thumb" alt="" />
          </button>
        </div>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { IonModal, IonContent, IonIcon } from '@ionic/vue';
import {
  chevronBack, pencil, ellipsisHorizontal, imagesOutline, chatbubbleOutline,
  happyOutline, arrowUndoOutline, shareOutline, downloadOutline, star, starOutline, trashOutline,
} from 'ionicons/icons';
import VideoPlayer from './VideoPlayer.vue';

interface ViewerItem {
  id: string;
  url: string;
  thumb: string;
  kind: string;
  caption: string;
  senderName: string;
  when: string;
  outgoing: boolean;
  favorite: boolean;
  reactions: Array<{ emoji: string; count: number }>;
}
const props = defineProps<{ open: boolean; items: ViewerItem[]; start: number }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'dismiss', id: string): void;
  (e: 'react', id: string, emoji: string): void;
  (e: 'reply', id: string): void;
  (e: 'favorite', id: string): void;
  (e: 'del', id: string): void;
  (e: 'share', id: string): void;
  (e: 'save', id: string): void;
  (e: 'caption', id: string): void;
  (e: 'goto', id: string): void;
  (e: 'allmedia'): void;
}>();

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const track = ref<HTMLElement>();
const strip = ref<HTMLElement>();
const index = ref(props.start);
const menu = ref(false);
const showEmojis = ref(false);
const chromeHidden = ref(false);
const cur = computed(() => props.items[index.value] ?? props.items[0]);
// Only mount video players for the visible slide (+ neighbours) so off-screen
// videos never load or autoplay.
const nearby = (i: number) => Math.abs(i - index.value) <= 1;

function goToStart(): void {
  index.value = props.start;
  menu.value = false;
  showEmojis.value = false;
  chromeHidden.value = false;
  resetZoom();
  const el = track.value;
  if (el) el.scrollLeft = props.start * el.clientWidth;
  void scrollStrip();
}
function onScroll(): void {
  const el = track.value;
  if (!el?.clientWidth) return;
  const i = Math.round(el.scrollLeft / el.clientWidth);
  if (i !== index.value) {
    index.value = i;
    resetZoom();
    void scrollStrip();
  }
}
function jump(i: number): void {
  const el = track.value;
  resetZoom();
  if (el) el.scrollLeft = i * el.clientWidth;
  index.value = i;
}
async function scrollStrip(): Promise<void> {
  await nextTick();
  strip.value?.querySelector<HTMLElement>(`.v-thumb[data-i="${index.value}"]`)?.scrollIntoView({
    inline: 'center',
    block: 'nearest',
  });
}
function react(emoji: string): void {
  showEmojis.value = false;
  if (cur.value) emit('react', cur.value.id, emoji);
}

/* ---- zoom + pan (pinch on touch, wheel + drag on desktop) ---- */
const zoom = reactive({ scale: 1, tx: 0, ty: 0 });
const gesturing = ref(false);
const zoomStyle = computed(() => ({
  transform: `translate3d(${zoom.tx}px, ${zoom.ty}px, 0) scale(${zoom.scale})`,
  transition: gesturing.value ? 'none' : 'transform 0.22s ease',
}));
function resetZoom(): void {
  gesturing.value = false;
  zoom.scale = 1;
  zoom.tx = 0;
  zoom.ty = 0;
}
function clampPan(): void {
  const el = track.value;
  const w = el?.clientWidth ?? 0;
  const h = el?.clientHeight ?? 0;
  const mx = Math.max(0, ((zoom.scale - 1) * w) / 2);
  const my = Math.max(0, ((zoom.scale - 1) * h) / 2);
  zoom.tx = Math.min(mx, Math.max(-mx, zoom.tx));
  zoom.ty = Math.min(my, Math.max(-my, zoom.ty));
}
function toggleZoom(): void {
  if (zoom.scale > 1) resetZoom();
  else {
    zoom.scale = 2.5;
    zoom.tx = 0;
    zoom.ty = 0;
  }
}

/* vertical swipe → dismiss; pinch → zoom; drag (zoomed) → pan; tap → chrome */
const dragY = ref(0);
let mode: 'none' | 'pinch' | 'pan' | 'free' = 'none';
let startDist = 0;
let startScale = 1;
let sx = 0;
let sy = 0;
let panTx = 0;
let panTy = 0;
let moved = false;
let dir: 'v' | 'h' | null = null;
let lastTapAt = 0;
let lastTouchAt = 0;
let tapTimer: ReturnType<typeof setTimeout> | undefined;

const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

function onTouchStart(e: TouchEvent): void {
  if (e.touches.length >= 2) {
    mode = 'pinch';
    gesturing.value = true;
    startDist = touchDist(e.touches) || 1;
    startScale = zoom.scale;
    moved = true;
    return;
  }
  const t = e.touches[0];
  sx = t.clientX;
  sy = t.clientY;
  moved = false;
  dir = null;
  dragY.value = 0;
  if (zoom.scale > 1) {
    mode = 'pan';
    gesturing.value = true;
    panTx = zoom.tx;
    panTy = zoom.ty;
  } else {
    mode = 'free';
  }
}
function onTouchMove(e: TouchEvent): void {
  if (mode === 'pinch') {
    if (e.touches.length < 2) return;
    zoom.scale = Math.min(5, Math.max(1, (startScale * touchDist(e.touches)) / startDist));
    clampPan();
    if (e.cancelable) e.preventDefault();
    return;
  }
  if (mode === 'pan') {
    const t = e.touches[0];
    zoom.tx = panTx + (t.clientX - sx);
    zoom.ty = panTy + (t.clientY - sy);
    if (Math.abs(t.clientX - sx) > 4 || Math.abs(t.clientY - sy) > 4) moved = true;
    clampPan();
    if (e.cancelable) e.preventDefault();
    return;
  }
  // free (scale 1): vertical drag dismisses, horizontal scrolls the track natively.
  const t = e.touches[0];
  const dy = t.clientY - sy;
  const dx = t.clientX - sx;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
  if (dir === null && (Math.abs(dy) > 8 || Math.abs(dx) > 8)) {
    dir = Math.abs(dy) > Math.abs(dx) * 1.3 ? 'v' : 'h';
  }
  if (dir === 'v') {
    dragY.value = dy;
    if (e.cancelable) e.preventDefault();
  }
}
function onTouchEnd(): void {
  lastTouchAt = Date.now();
  if (mode === 'pinch') {
    gesturing.value = false;
    if (zoom.scale <= 1.02) resetZoom();
    mode = 'none';
    return;
  }
  if (mode === 'pan') {
    gesturing.value = false;
    mode = 'none';
    return;
  }
  if (dir === 'v' && Math.abs(dragY.value) > 90 && cur.value) {
    emit('dismiss', cur.value.id);
  } else if (!moved && dir !== 'v') {
    // Tap: double-tap zooms an image, a lone tap toggles the chrome (deferred a
    // beat so a second tap can cancel it and zoom instead).
    const nowT = Date.now();
    if (nowT - lastTapAt < 300) {
      if (tapTimer) clearTimeout(tapTimer);
      lastTapAt = 0;
      if (cur.value?.kind === 'image') toggleZoom();
    } else {
      lastTapAt = nowT;
      if (cur.value?.kind === 'image') {
        tapTimer = setTimeout(() => {
          chromeHidden.value = !chromeHidden.value;
        }, 280);
      }
    }
  }
  dragY.value = 0;
  dir = null;
  mode = 'none';
}

/* desktop: wheel zoom, drag-to-pan, click/double-click */
function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return;
  e.preventDefault();
  zoom.scale = Math.min(5, Math.max(1, zoom.scale * (e.deltaY < 0 ? 1.12 : 0.89)));
  if (zoom.scale <= 1.02) resetZoom();
  else clampPan();
}
let mDown = false;
let mx0 = 0;
let my0 = 0;
let mtx = 0;
let mty = 0;
function onMouseDown(e: MouseEvent): void {
  if (zoom.scale <= 1) return;
  mDown = true;
  mx0 = e.clientX;
  my0 = e.clientY;
  mtx = zoom.tx;
  mty = zoom.ty;
  gesturing.value = true;
}
function onMouseMove(e: MouseEvent): void {
  if (!mDown) return;
  zoom.tx = mtx + (e.clientX - mx0);
  zoom.ty = mty + (e.clientY - my0);
  clampPan();
}
function onMouseUp(): void {
  mDown = false;
  gesturing.value = false;
}
function onMediaClick(): void {
  // Ignore the synthetic click that follows a touch (handled in onTouchEnd).
  if (Date.now() - lastTouchAt < 500) return;
  if (cur.value?.kind === 'image') chromeHidden.value = !chromeHidden.value;
}
function onMediaDblClick(): void {
  if (Date.now() - lastTouchAt < 500) return;
  if (cur.value?.kind === 'image') toggleZoom();
}

watch(() => props.start, (s) => {
  if (props.open) index.value = s;
});
</script>

<style scoped>
.viewer-content {
  --background: #000;
}
.v-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  padding: max(env(safe-area-inset-top), 10px) 8px 10px;
  background: linear-gradient(rgba(0, 0, 0, 0.55), transparent);
  color: #fff;
  transition: opacity 0.2s ease;
}
/* Distraction-free: fade the chrome out (kept in the layout so taps still land). */
.v-top.hidden,
.v-bottom.hidden {
  opacity: 0;
  pointer-events: none;
}
/* Truly centred title regardless of how many icons flank it. */
.v-title {
  position: absolute;
  left: 0;
  right: 0;
  top: max(env(safe-area-inset-top), 10px);
  text-align: center;
  padding: 0 96px;
  pointer-events: none;
}
.v-sender {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.v-when {
  font-size: 12px;
  opacity: 0.75;
}
.v-icon {
  background: none;
  border: none;
  color: #fff;
  font-size: 24px;
  width: 40px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.v-icon:first-of-type {
  margin-right: auto;
}
.v-menu {
  position: absolute;
  top: 52px;
  right: 10px;
  background: #2a2a2a;
  border-radius: 12px;
  overflow: hidden;
  min-width: 180px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.v-menu button {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  background: none;
  border: none;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}
.v-menu button ion-icon {
  font-size: 20px;
}
.viewer-track {
  display: flex;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
}
/* While an item is zoomed in, lock paging so a pan can't flick to the next item. */
.viewer-track.zoomed {
  overflow: hidden;
  scroll-snap-type: none;
}
.viewer-slide {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  scroll-snap-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.zoom-layer {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center center;
  will-change: transform;
}
.viewer-slide img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.v-bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  padding: 10px 10px max(env(safe-area-inset-bottom), 10px);
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.65));
  color: #fff;
  transition: opacity 0.2s ease;
}
.v-reactions {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.v-react-pill {
  background: rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 14px;
}
.v-react-n {
  margin-left: 3px;
  opacity: 0.8;
}
.v-caption {
  font-size: 14px;
  margin-bottom: 10px;
}
.v-emojis {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}
.v-emojis button {
  flex: 1;
  height: 40px;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  font-size: 22px;
  cursor: pointer;
}
.v-actions {
  display: flex;
  justify-content: space-around;
  align-items: center;
  /* Dark translucent pill so the buttons read over a bright/tall image behind. */
  background: rgba(0, 0, 0, 0.42);
  border-radius: 18px;
  padding: 2px 4px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.v-actions button {
  background: none;
  border: none;
  color: #fff;
  font-size: 25px;
  width: 46px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.v-actions button.on {
  color: var(--ion-color-warning, #ffc409);
}
.v-strip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 10px 0 4px;
  scrollbar-width: none;
}
.v-strip::-webkit-scrollbar {
  display: none;
}
.v-thumb {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 0;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
  cursor: pointer;
  opacity: 0.6;
}
.v-thumb.on {
  border-color: #fff;
  opacity: 1;
}
.v-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
