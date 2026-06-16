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
            <video-player
              v-else-if="i === index || nearby(i)"
              :ref="(c) => bindVideo(c, i)"
              :src="it.url"
              :embedded="true"
              :chrome-hidden="chromeHidden"
              :start-at="positions[it.id]"
              @tap="onVideoTap"
              @time="(t) => (positions[it.id] = t)"
            />
          </div>
        </div>
      </div>

      <!-- Bottom: video scrubber (if a video) · reactions · caption · quick-react ·
           actions · thumbnail strip. The video's scrubber/speed/PiP row is hosted HERE,
           above the action buttons, so it's never covered by them or the thumbnails. -->
      <div class="v-bottom" :class="{ hidden: chromeHidden }">
        <div v-if="cur?.kind === 'video' && activeVideo" class="v-vidbar">
          <button
            class="v-vidbtn"
            :aria-label="activeVideo.playing ? 'Pause' : 'Play'"
            @click="activeVideo.toggle()"
          >
            <ion-icon :icon="activeVideo.playing ? pause : play" />
          </button>
          <span class="v-vidtime">{{ vfmt(activeVideo.elapsed) }}</span>
          <!-- Tap to jump, drag to scrub (useScrub). The track is a tall hitbox
               around the thin visible rail so a finger can actually grab it. -->
          <div
            class="v-vidtrack"
            @pointerdown="vidScrub.onPointerDown"
            @pointermove="vidScrub.onPointerMove"
            @pointerup="vidScrub.onPointerUp"
            @pointercancel="vidScrub.onPointerUp"
          >
            <div class="v-vidrail">
              <div class="v-vidprog" :style="{ width: activeVideo.progress * 100 + '%' }"></div>
            </div>
          </div>
          <span class="v-vidtime">{{ vfmt(activeVideo.total) }}</span>
          <speed-pill :rate="activeVideo.rate" @cycle="activeVideo.cycleRate()" />
          <button
            v-if="activeVideo.pipSupported"
            class="v-vidbtn"
            :class="{ on: activeVideo.pipActive }"
            aria-label="Picture in picture"
            @click="activeVideo.togglePip()"
          >
            <ion-icon :icon="browsersOutline" />
          </button>
        </div>
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
import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue';
import { IonModal, IonContent, IonIcon } from '@ionic/vue';
import {
  chevronBack, pencil, ellipsisHorizontal, imagesOutline, chatbubbleOutline,
  happyOutline, arrowUndoOutline, shareOutline, downloadOutline, star, starOutline, trashOutline,
  play, pause, browsersOutline,
} from 'ionicons/icons';
import SpeedPill from './SpeedPill.vue';
import VideoPlayer from './VideoPlayer.vue';
import { useScrub } from '@/composables/useScrub';

// The slice of VideoPlayer's exposed API the viewer drives for the hosted control row.
interface VideoApi {
  playing: boolean;
  elapsed: number;
  total: number;
  progress: number;
  rate: number;
  pipActive: boolean;
  pipSupported: boolean;
  toggle: () => void;
  pauseSilent: () => void;
  seekTo: (r: number) => void;
  cycleRate: () => void;
  togglePip: () => void;
}

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

/* ---- video: host the scrubber/PiP in the chrome, tap toggles the immersive view ---- */
// shallowRef (not ref): hold the raw component instance, never deep-proxy it.
const activeVideo = shallowRef<VideoApi | null>(null);
// Function ref on the mounted players; keep a handle to the CURRENT one so the hosted
// control row drives it (and re-points as you swipe between items). Vue re-invokes an
// inline ref callback every render (old→null, new→instance), so we MUST ignore the null
// detach and skip same-value writes — otherwise the template reading `activeVideo` would
// rewrite it every render → infinite re-render loop (the web process crashes).
// All currently-mounted players, by slide index (plain Map — never read in the
// template, so it triggers no re-render; activeVideo drives the chrome). Lets us
// pause every player except the on-screen one when the user slides (FR-004).
const videoApis = new Map<number, VideoApi>();
function bindVideo(c: unknown, i: number): void {
  const inst = (c as VideoApi | null) ?? null;
  if (inst) videoApis.set(i, inst);
  else videoApis.delete(i);
  if (i === index.value && inst && activeVideo.value !== inst) activeVideo.value = inst;
}
// Sliding away from a video must stop it fully (no off-screen audio/decoding),
// while its position is remembered via @time so sliding back resumes there.
function pauseOffscreenVideos(): void {
  for (const [i, api] of videoApis) if (i !== index.value) api.pauseSilent();
}
// Item ids → last playback position (seconds), so a remounted player resumes there.
const positions = reactive<Record<string, number>>({});
watch(index, () => pauseOffscreenVideos());
const vfmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// Tap on the video → hide all chrome for a video-only view; tap again → bring it back.
function onVideoTap(): void {
  chromeHidden.value = !chromeHidden.value;
}
// Tap-to-jump AND drag-to-scrub on the hosted track (pointer capture keeps the
// drag from being claimed by the slide-swipe gesture underneath).
const vidScrub = useScrub((ratio) => activeVideo.value?.seekTo(ratio));
function onMediaDblClick(): void {
  if (Date.now() - lastTouchAt < 500) return;
  if (cur.value?.kind === 'image') toggleZoom();
}

watch(() => props.start, (s) => {
  if (props.open) index.value = s;
});
// Closing the viewer stops any playing video (FR-006).
watch(() => props.open, (o) => {
  if (!o) for (const api of videoApis.values()) api.pauseSilent();
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
/* Video scrubber row, hosted in the chrome above the action buttons. */
.v-vidbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px 8px;
  color: #fff;
}
.v-vidbtn {
  flex: none;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.v-vidbtn.on {
  background: var(--ion-color-primary);
}
.v-vidtime {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: center;
}
.v-vidtrack {
  flex: 1;
  /* Tall transparent hitbox so the thin rail is grabbable; touch-action:none
     keeps the browser from claiming the drag for scrolling (see useScrub). */
  height: 24px;
  display: flex;
  align-items: center;
  touch-action: none;
  cursor: pointer;
}
.v-vidrail {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.3);
}
.v-vidprog {
  height: 100%;
  border-radius: 2px;
  background: var(--ion-color-primary);
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
  /* Captions are capped at CAPTION_MAX on write, but a longer one (older data,
     other clients) must never bury the picture: clamp the overlay and scroll. */
  max-height: 25vh;
  overflow-y: auto;
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
