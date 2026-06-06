<template>
  <ion-modal :is-open="open" @did-present="goToStart" @did-dismiss="$emit('close')">
    <ion-content :scroll-y="false" class="viewer-content">
      <!-- Top bar: back · centered sender + date/time · caption pen · overflow -->
      <div class="v-top">
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

      <!-- Swipeable media; vertical drag dismisses back to the chat. -->
      <div
        ref="track"
        class="viewer-track"
        :style="dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : {}"
        @scroll.passive="onScroll"
        @touchstart.passive="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
      >
        <div v-for="(it, i) in items" :key="it.id" class="viewer-slide">
          <img v-if="it.kind === 'image'" :src="it.url" alt="" />
          <video-player v-else-if="i === index || nearby(i)" :src="it.url" />
        </div>
      </div>

      <!-- Bottom: reactions · caption · thumbnail strip · quick-react · actions -->
      <div class="v-bottom">
        <div v-if="cur?.reactions?.length" class="v-reactions">
          <span v-for="r in cur.reactions" :key="r.emoji" class="v-react-pill">
            {{ r.emoji }}<span v-if="r.count > 1" class="v-react-n">{{ r.count }}</span>
          </span>
        </div>
        <div v-if="cur?.caption" class="v-caption">{{ cur.caption }}</div>

        <div v-if="showEmojis" class="v-emojis">
          <button v-for="e in QUICK" :key="e" @click="react(e)">{{ e }}</button>
        </div>

        <!-- All chat media as a slidable thumbnail strip; the current one is lit. -->
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

        <div class="v-actions">
          <button aria-label="React" @click="showEmojis = !showEmojis"><ion-icon :icon="happyOutline" /></button>
          <button aria-label="Reply" @click="$emit('reply', cur.id)"><ion-icon :icon="arrowUndoOutline" /></button>
          <button aria-label="Share" @click="$emit('share', cur.id)"><ion-icon :icon="shareOutline" /></button>
          <button aria-label="Favorite" :class="{ on: cur?.favorite }" @click="$emit('favorite', cur.id)">
            <ion-icon :icon="cur?.favorite ? star : starOutline" />
          </button>
          <button aria-label="Delete" @click="$emit('del', cur.id)"><ion-icon :icon="trashOutline" /></button>
        </div>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { IonModal, IonContent, IonIcon } from '@ionic/vue';
import {
  chevronBack, pencil, ellipsisHorizontal, imagesOutline, chatbubbleOutline,
  happyOutline, arrowUndoOutline, shareOutline, star, starOutline, trashOutline,
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
const cur = computed(() => props.items[index.value] ?? props.items[0]);
// Only mount video players for the visible slide (+ neighbours) so off-screen
// videos never load or autoplay.
const nearby = (i: number) => Math.abs(i - index.value) <= 1;

function goToStart(): void {
  index.value = props.start;
  menu.value = false;
  showEmojis.value = false;
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
    void scrollStrip();
  }
}
function jump(i: number): void {
  const el = track.value;
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

/* vertical swipe → dismiss */
const dragY = ref(0);
let sx = 0;
let sy = 0;
let dir: 'v' | 'h' | null = null;
function onTouchStart(e: TouchEvent): void {
  sx = e.touches[0].clientX;
  sy = e.touches[0].clientY;
  dir = null;
  dragY.value = 0;
}
function onTouchMove(e: TouchEvent): void {
  const dy = e.touches[0].clientY - sy;
  const dx = e.touches[0].clientX - sx;
  if (dir === null && (Math.abs(dy) > 8 || Math.abs(dx) > 8)) {
    dir = Math.abs(dy) > Math.abs(dx) * 1.3 ? 'v' : 'h';
  }
  if (dir === 'v') {
    dragY.value = dy;
    if (e.cancelable) e.preventDefault();
  }
}
function onTouchEnd(): void {
  if (dir === 'v' && Math.abs(dragY.value) > 90 && cur.value) emit('dismiss', cur.value.id);
  dragY.value = 0;
  dir = null;
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
.viewer-slide {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  scroll-snap-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
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
.v-strip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 4px 0 8px;
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
.v-actions {
  display: flex;
  justify-content: space-around;
  align-items: center;
}
.v-actions button {
  background: none;
  border: none;
  color: #fff;
  font-size: 26px;
  width: 48px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.v-actions button.on {
  color: var(--ion-color-warning, #ffc409);
}
</style>
