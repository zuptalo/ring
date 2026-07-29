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
          <!-- Position indicator (current / total) as a third title line, so you always know
               where you are in a multi-item album. Auto-hides with the chrome. FR-011. -->
          <div v-if="items.length > 1" class="v-count" aria-live="polite">{{ index + 1 }} / {{ items.length }}</div>
        </div>
        <button v-if="cur?.outgoing && !minimal" class="v-icon" aria-label="Caption" @click="$emit('caption', cur.id)">
          <ion-icon :icon="pencil" />
        </button>
        <button v-if="!minimal" class="v-icon" aria-label="More" @click="menu = !menu">
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
        <div v-for="(it, i) in items" :key="it.id" class="viewer-slide" :data-i="i">
          <div class="zoom-layer" :style="i === index ? zoomStyle : undefined">
            <!-- Only the current slide and its neighbours render real media, so a
                 media-heavy chat never decodes everything at once (OOM). -->
            <template v-if="it.kind === 'image'">
              <img
                v-if="(i === index || nearby(i)) && (it.url || it.thumb)"
                :src="it.url || it.thumb"
                :alt="it.caption || 'Photo'"
                @click="onMediaClick"
                @dblclick="onMediaDblClick"
              />
              <!-- The full image / thumbnail is gone (cleared to free space, or not yet
                   downloaded): a clear placeholder, never a broken <img>. FR-008. -->
              <div v-else-if="i === index || nearby(i)" class="v-missing" data-state="missing">
                <ion-icon :icon="imageOutline" aria-hidden="true" />
                <span>Photo unavailable</span>
              </div>
            </template>
            <video-player
              v-else-if="i === index || nearby(i)"
              :ref="(c) => bindVideo(c, i)"
              :src="it.url"
              :id="it.id"
              :poster="it.thumb"
              :embedded="true"
              :chrome-hidden="chromeHidden"
              :start-at="positions[it.id]"
              @tap="onVideoTap"
              @time="(t) => (positions[it.id] = t)"
            />
          </div>
        </div>
      </div>

      <!-- Visible escape hatch while zoomed: pinch/double-tap also exit, but a tappable
           affordance means a user can never get mode-locked (zoom blocks swiping). FR-014. -->
      <button v-if="zoom.scale > 1" class="v-zoom-exit" aria-label="Exit zoom" @click="resetZoom">
        <ion-icon :icon="contractOutline" />
      </button>

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
             bright or tall image showing behind them. Hidden entirely in the minimal Wall
             viewer — a post is reacted to from the feed/detail, not in the viewer. -->
        <div v-if="!minimal" class="v-actions">
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
            :aria-label="`Photo ${i + 1} of ${items.length}`"
            :aria-current="i === index ? 'true' : undefined"
            @click="jump(i)"
          >
            <!-- An unresolved/cleared item has no thumbnail — show a neutral tile, never a
                 broken <img>. FR-008. Alt is on the button (aria-label); the img is decorative. -->
            <img v-if="it.thumb" :src="it.thumb" :alt="`Thumbnail ${i + 1}`" />
            <ion-icon v-else :icon="imageOutline" class="v-thumb-missing" aria-hidden="true" />
          </button>
        </div>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import { IonModal, IonContent, IonIcon } from '@ionic/vue';
import {
  chevronBack, pencil, ellipsisHorizontal, imagesOutline, chatbubbleOutline,
  happyOutline, arrowUndoOutline, shareOutline, downloadOutline, star, starOutline, trashOutline,
  play, pause, browsersOutline, imageOutline, contractOutline,
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

export interface ViewerItem {
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
// `minimal` = a read-only viewer (Wall posts): keep the zoom/pan/swipe/fullscreen, drop the
// chat-only chrome (caption pen, overflow menu, reply/save/forward/favorite/delete actions).
const props = defineProps<{ open: boolean; items: ViewerItem[]; start: number; minimal?: boolean }>();
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
  (e: 'index', i: number): void; // current slide changed → parent resolves its window
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

// onScroll derives the index from the scroll position for genuine user swipes (including
// inertial/momentum scroll). But we also move the track PROGRAMMATICALLY (open, keyboard,
// jump), and `scroll-snap: x mandatory` + the window-resolve re-layout then fire their own
// scroll events that can round to the wrong slide and hijack the index. So we suppress
// onScroll for a brief window after a programmatic move ONLY — swipes never call this, so
// their (possibly long, momentum) scroll is always honored. FR-011/013.
let positioning = false;
let posTimer: ReturnType<typeof setTimeout> | undefined;
function suppressScrollSync(): void {
  positioning = true;
  clearTimeout(posTimer);
  posTimer = setTimeout(() => (positioning = false), 250);
}
// Position the track at slide i. Uses scrollIntoView on the slide element (direction-agnostic) so
// it's correct in both LTR and RTL — physical scrollLeft math would be reversed under dir=rtl
// (FR-022). The track may not be laid out yet on modal did-present (clientWidth 0) — retry on the
// next frame so we never land on the wrong item.
function scrollToIndex(i: number, tries = 8): void {
  const el = track.value;
  if (!el) return;
  if (el.clientWidth) {
    el.querySelector<HTMLElement>(`.viewer-slide[data-i="${i}"]`)?.scrollIntoView({
      behavior: 'auto',
      inline: 'center',
      block: 'nearest',
    });
    return;
  }
  if (tries > 0) requestAnimationFrame(() => scrollToIndex(i, tries - 1));
}
function goToStart(): void {
  suppressScrollSync(); // protect the opening position from layout-induced scroll events
  // Clamp like jump(): props.start can be stale if items shrank between the parent computing it
  // and did-present firing, so never open on an out-of-range index. FR-007/011.
  index.value = Math.max(0, Math.min(props.items.length - 1, props.start));
  menu.value = false;
  showEmojis.value = false;
  chromeHidden.value = false;
  resetZoom();
  scrollToIndex(index.value);
  void scrollStrip();
  emit('index', index.value); // resolve the opening item's window (index may not change)
  void playCurrentIfVideo();
}
// Autoplay the video we've landed on (the off-screen ones are paused by the index
// watch / pauseOffscreenVideos), so sliding onto a video plays it and sliding away
// stops it — only the on-screen video is ever active.
async function playCurrentIfVideo(): Promise<void> {
  await nextTick();
  // Minimal (Wall) viewer: never autoplay — show the poster + play button and let the user
  // start it. (The chat viewer keeps the slide-onto-it-plays behaviour.)
  if (props.minimal) return;
  if (cur.value?.kind !== 'video') return;
  const api = videoApis.get(index.value);
  if (api && !api.playing) api.toggle();
}
function onScroll(): void {
  // Ignore the snap/layout/window-resolve scrolls that a programmatic move (open/keyboard/jump)
  // triggers — they can round to the wrong slide and revert the index. User swipes don't suppress,
  // so their scroll (incl. momentum) is always honored. FR-011/013.
  if (positioning) return;
  const el = track.value;
  if (!el?.clientWidth) return;
  // The active slide is the one nearest the track's horizontal centre — measured from element rects,
  // not scrollLeft/clientWidth, so it's correct under RTL (where scrollLeft is reversed). FR-022.
  const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
  let best = index.value;
  let bestDist = Infinity;
  el.querySelectorAll<HTMLElement>('.viewer-slide').forEach((slide) => {
    const r = slide.getBoundingClientRect();
    const d = Math.abs(r.left + r.width / 2 - mid);
    if (d < bestDist) {
      bestDist = d;
      best = Number(slide.dataset.i);
    }
  });
  if (best !== index.value) {
    index.value = best;
    resetZoom();
    void scrollStrip();
  }
}
function jump(i: number): void {
  // Clamp so keyboard nav at the ends (and any caller) can never land out of range. FR-012.
  i = Math.max(0, Math.min(props.items.length - 1, i));
  resetZoom();
  index.value = i;
  suppressScrollSync(); // the snap re-scroll this triggers must not revert the index
  scrollToIndex(i);
}
async function scrollStrip(): Promise<void> {
  await nextTick();
  if (!strip.value || index.value >= props.items.length) return; // guard the shrink race (FR-007)
  strip.value.querySelector<HTMLElement>(`.v-thumb[data-i="${index.value}"]`)?.scrollIntoView({
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
  cancelMomentum();
  gesturing.value = false;
  zoom.scale = 1;
  zoom.tx = 0;
  zoom.ty = 0;
}
/** Max pan offset in each axis at the current scale (content edge flush with the viewport edge). */
function panBounds(): { mx: number; my: number } {
  const el = track.value;
  const w = el?.clientWidth ?? 0;
  const h = el?.clientHeight ?? 0;
  return { mx: Math.max(0, ((zoom.scale - 1) * w) / 2), my: Math.max(0, ((zoom.scale - 1) * h) / 2) };
}
/** Hard clamp — used by the final settle and the desktop wheel/mouse paths. */
function clampPan(): void {
  const { mx, my } = panBounds();
  zoom.tx = Math.min(mx, Math.max(-mx, zoom.tx));
  zoom.ty = Math.min(my, Math.max(-my, zoom.ty));
}
/** Rubber-band a value past a symmetric bound: motion past the edge is allowed but resisted
 *  (spec 1018 FR-010), so a drag/pinch can briefly overscroll and then settle back. */
function rubber(v: number, max: number): number {
  if (max <= 0) return v * 0.3; // unzoomed axis: heavy resistance toward 0
  if (v > max) return max + (v - max) * 0.3;
  if (v < -max) return -max + (v + max) * 0.3;
  return v;
}
/** Soft (rubber-band) clamp applied live during a pinch/pan gesture. */
function softClampPan(): void {
  const { mx, my } = panBounds();
  zoom.tx = rubber(zoom.tx, mx);
  zoom.ty = rubber(zoom.ty, my);
}
/** Animate the pan back to its hard bounds (re-enables the CSS transition for a smooth snap). */
function settlePan(): void {
  cancelMomentum();
  gesturing.value = false;
  clampPan();
}
// Momentum/inertia (spec 1018 FR-009): on a flick release while zoomed, keep translating with
// friction until it slows or reaches a bound, then settle. rAF-driven (transform only) for 60fps.
let momentumRaf = 0;
function cancelMomentum(): void {
  if (momentumRaf) cancelAnimationFrame(momentumRaf);
  momentumRaf = 0;
}
function startMomentum(): void {
  cancelMomentum();
  const FRICTION = 0.94;
  const step = (): void => {
    vx *= FRICTION;
    vy *= FRICTION;
    zoom.tx += vx;
    zoom.ty += vy;
    const { mx, my } = panBounds();
    const past = zoom.tx > mx || zoom.tx < -mx || zoom.ty > my || zoom.ty < -my;
    // Stop and snap back once it crosses a bound or the fling has nearly stopped.
    if (past || (Math.abs(vx) < 0.4 && Math.abs(vy) < 0.4)) {
      settlePan();
      return;
    }
    momentumRaf = requestAnimationFrame(step);
  };
  momentumRaf = requestAnimationFrame(step);
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
// Pinch focal point (relative to the viewport centre) + the translation when the pinch began, so
// the zoom stays centred on where the fingers are rather than snapping to the middle (FR-009).
let focalX = 0;
let focalY = 0;
let startTx = 0;
let startTy = 0;
// Pan velocity sampling for momentum (px per ~frame) and the last sampled point/time.
let vx = 0;
let vy = 0;
let lastMoveX = 0;
let lastMoveY = 0;
let lastMoveT = 0;
let moved = false;
let dir: 'v' | 'h' | null = null;
let lastTapAt = 0;
let lastTouchAt = 0;
let tapTimer: ReturnType<typeof setTimeout> | undefined;

const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

function onTouchStart(e: TouchEvent): void {
  cancelMomentum(); // a new touch interrupts any in-flight fling
  if (e.touches.length >= 2) {
    mode = 'pinch';
    gesturing.value = true;
    startDist = touchDist(e.touches) || 1;
    startScale = zoom.scale;
    startTx = zoom.tx;
    startTy = zoom.ty;
    // Focal point = pinch midpoint relative to the viewport centre, so the zoom grows toward it.
    const r = track.value?.getBoundingClientRect();
    if (r) {
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      focalX = midX - (r.left + r.width / 2);
      focalY = midY - (r.top + r.height / 2);
    } else {
      focalX = focalY = 0;
    }
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
    vx = vy = 0;
    lastMoveX = t.clientX;
    lastMoveY = t.clientY;
    lastMoveT = e.timeStamp || performance.now();
  } else {
    mode = 'free';
  }
}
function onTouchMove(e: TouchEvent): void {
  if (mode === 'pinch') {
    if (e.touches.length < 2) return;
    const s1 = Math.min(5, Math.max(1, (startScale * touchDist(e.touches)) / startDist));
    // Keep the focal point fixed under the fingers while scaling (FR-009): solve for the
    // translation that holds focal = t + s*o constant as s goes startScale → s1.
    const ratio = s1 / startScale;
    zoom.scale = s1;
    zoom.tx = focalX - ratio * (focalX - startTx);
    zoom.ty = focalY - ratio * (focalY - startTy);
    softClampPan();
    if (e.cancelable) e.preventDefault();
    return;
  }
  if (mode === 'pan') {
    const t = e.touches[0];
    zoom.tx = panTx + (t.clientX - sx);
    zoom.ty = panTy + (t.clientY - sy);
    if (Math.abs(t.clientX - sx) > 4 || Math.abs(t.clientY - sy) > 4) moved = true;
    // Sample velocity (px/frame) for the release fling.
    const now = e.timeStamp || performance.now();
    const dt = now - lastMoveT;
    if (dt > 0) {
      vx = ((t.clientX - lastMoveX) / dt) * 16;
      vy = ((t.clientY - lastMoveY) / dt) * 16;
      lastMoveX = t.clientX;
      lastMoveY = t.clientY;
      lastMoveT = now;
    }
    softClampPan();
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
    // A horizontal swipe owns the index from here — lift any programmatic-move suppression so the
    // swipe's scroll (incl. one that lands within ~250ms of opening) updates the index. FR-013.
    if (dir === 'h') {
      clearTimeout(posTimer);
      positioning = false;
    }
  }
  if (dir === 'v') {
    dragY.value = dy;
    if (e.cancelable) e.preventDefault();
  }
}
function onTouchEnd(): void {
  lastTouchAt = Date.now();
  if (mode === 'pinch') {
    if (zoom.scale <= 1.02) resetZoom();
    else settlePan(); // snap any pinch overscroll back to bounds
    mode = 'none';
    return;
  }
  if (mode === 'pan') {
    mode = 'none';
    // Fling with momentum if released with speed while zoomed; otherwise just settle to bounds.
    if (zoom.scale > 1 && (Math.abs(vx) > 0.6 || Math.abs(vy) > 0.6)) startMomentum();
    else settlePan();
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
watch(index, () => {
  resetZoom(); // FR-010: zoom never bleeds onto an adjacent item, whatever changed the index
  void scrollStrip(); // FR-013: keep the active strip thumb centered on every nav path (swipe/keyboard/jump)
  pauseOffscreenVideos();
  emit('index', index.value); // let the parent resolve this window's media
  void playCurrentIfVideo();
});
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
// Closing the viewer stops any playing video (FR-006) and cancels any in-flight zoom momentum.
watch(() => props.open, (o) => {
  if (!o) {
    cancelMomentum();
    for (const api of videoApis.values()) api.pauseSilent();
  }
});
// The item set can shrink while the viewer is open (a message deleted, or its media
// cleared to free space). Clamp the index back into range — don't rely on the scroll
// container's incidental re-clamp + onScroll, which is timing/engine-dependent — drop
// stale per-slide video handles (videoApis is keyed by slide index, so a shrink would
// leave dangling entries pauseOffscreenVideos still pokes), and stop anything now
// off-screen. The empty case is handled by the host's close-watch. FR-007.
watch(() => props.items.length, (len) => {
  if (len === 0) return;
  if (index.value > len - 1) {
    index.value = len - 1;
    suppressScrollSync();
    scrollToIndex(index.value); // direction-agnostic (RTL-safe), replaces raw scrollLeft. FR-022.
  }
  for (const i of [...videoApis.keys()]) if (i > len - 1 || !nearby(i)) videoApis.delete(i);
  pauseOffscreenVideos();
});

// Keyboard navigation: ←/→ move between items (jump() clamps at the ends). Escape, Tab
// focus-trap, and focus-restore-to-opener are handled by ion-modal itself, so we only add
// arrow keys. A document listener gated on props.open catches the keys wherever focus sits
// inside the modal; it's removed on unmount (FR-012). (Pattern mirrors PinPad.vue.)
function onKeydown(e: KeyboardEvent): void {
  if (!props.open) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  // Physical arrow keys: ← always moves to the visually-left item, → to the visually-right one. In
  // RTL the items are laid out right-to-left, so the visually-left item is the NEXT one (index+1) —
  // flip the mapping by direction so the keys match the layout (and the swipe). FR-022.
  const rtl = !!track.value && getComputedStyle(track.value).direction === 'rtl';
  const back = rtl ? e.key === 'ArrowRight' : e.key === 'ArrowLeft';
  jump(index.value + (back ? -1 : 1));
}
onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  // Clear pending timers (module-level, shared across instances) so a stale timer can't fire on a
  // freshly-reopened viewer — e.g. a posTimer clearing `positioning` mid-suppression on the new one.
  clearTimeout(posTimer);
  clearTimeout(tapTimer);
});
</script>

<style scoped>
.viewer-content {
  --background: var(--viewer-surface);
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
  background: linear-gradient(var(--viewer-overlay-top), transparent);
  color: var(--viewer-text);
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
/* Position indicator — a third line under the sender/date in the centered title. FR-011. */
.v-count {
  margin-top: 2px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
/* Floating "exit zoom" affordance, just under the top bar. FR-014. */
.v-zoom-exit {
  position: absolute;
  top: calc(max(env(safe-area-inset-top), 10px) + 56px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: var(--viewer-chrome-bg);
  color: var(--viewer-text);
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.v-icon {
  background: none;
  border: none;
  color: var(--viewer-text);
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
  background: var(--viewer-menu-bg);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  overflow: hidden;
  min-width: 180px;
  box-shadow: var(--viewer-shadow);
}
.v-menu button {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  background: none;
  border: none;
  color: var(--viewer-text);
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
/* Placeholder for a cleared / not-downloaded item — a calm icon + label, never a
   broken image. FR-008. */
.v-missing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--viewer-text);
  opacity: 0.7;
  font-size: 14px;
}
.v-missing ion-icon {
  font-size: 48px;
}
.v-bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  padding: 10px 10px max(env(safe-area-inset-bottom), 10px);
  background: linear-gradient(transparent, var(--viewer-overlay-bottom));
  color: var(--viewer-text);
  transition: opacity 0.2s ease;
}
/* Video scrubber row, hosted in the chrome above the action buttons. */
.v-vidbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px 8px;
  color: var(--viewer-text);
}
.v-vidbtn {
  flex: none;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: var(--viewer-pill-bg);
  color: var(--viewer-text);
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
  background: var(--viewer-pill-bg);
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
  background: var(--viewer-pill-bg);
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
  background: var(--viewer-pill-bg);
  border-radius: 20px;
  font-size: 22px;
  cursor: pointer;
}
.v-actions {
  display: flex;
  justify-content: space-around;
  align-items: center;
  /* Theme-tinted translucent pill so the buttons read over a bright/tall image behind. */
  background: var(--viewer-chrome-bg);
  border-radius: 18px;
  padding: 2px 4px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.v-actions button {
  background: none;
  border: none;
  color: var(--viewer-text);
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
  background: var(--viewer-pill-bg);
  cursor: pointer;
  opacity: 0.6;
}
.v-thumb.on {
  border-color: var(--viewer-text);
  opacity: 1;
}
.v-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/* Neutral icon for a strip thumbnail whose image hasn't resolved (large/legacy
   album) — never a broken <img>. FR-008. */
.v-thumb-missing {
  width: 100%;
  height: 100%;
  padding: 10px;
  color: var(--viewer-text);
  opacity: 0.75; /* keeps the "unavailable" icon ≥ AA contrast over the light pill */
}
</style>
