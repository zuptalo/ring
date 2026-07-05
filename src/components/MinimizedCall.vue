<template>
  <!-- Floating, draggable call widget shown when a call is running but the user has
       left the full-screen call screen. Audio: a status pill; video: a small movable
       rectangle (like the in-call self-view). Tap to re-expand; the red button ends it. -->
  <div
    v-if="show"
    class="mini"
    :class="{ video: hasVideo }"
    :style="style"
    role="button"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <video v-if="hasVideo" ref="vid" class="mini-video" muted autoplay playsinline />
    <template v-else>
      <ion-avatar class="mini-avatar">
        <user-avatar v-if="callMeta" :src="callMeta.avatar" :alt="callMeta.name" />
      </ion-avatar>
      <div class="mini-info">
        <div class="mini-name">{{ callMeta?.name }}</div>
        <div class="mini-status">{{ statusText }}</div>
      </div>
    </template>
    <span v-if="hasVideo" class="mini-chip">{{ statusText }}</span>
    <button class="mini-end" aria-label="End call" @pointerdown.stop @click.stop="end">
      <ion-icon :icon="callOutline" />
    </button>
  </div>
</template>

<script setup lang="ts">
import UserAvatar from '@/components/UserAvatar.vue';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { IonAvatar, IonIcon } from '@ionic/vue';
import { callOutline } from 'ionicons/icons';
import {
  callState, callMeta, callStats, remoteStream, remoteStreams, localStream, hangupCall, expandCall,
} from '@/composables/useCall';

const route = useRoute();
const ACTIVE = ['dialing', 'remote-ringing', 'connecting', 'connected'];
// Shown whenever a call is in progress and we're NOT on the full-screen call screen.
const show = computed(() => ACTIVE.includes(callState.value) && route.path !== '/call-active');

// The most useful stream to preview: the peer (1:1), the first remote tile (group),
// or our own camera as a fallback before anyone's video arrives.
const previewStream = computed(() =>
  callMeta.value?.isGroup
    ? remoteStreams.value[0] ?? localStream.value
    : remoteStream.value ?? localStream.value,
);
const hasVideo = computed(
  () => callMeta.value?.kind === 'video' && !!previewStream.value?.getVideoTracks().length,
);

const vid = ref<HTMLVideoElement | null>(null);
watch([vid, previewStream, show], () => {
  const el = vid.value;
  if (!el || !hasVideo.value || !previewStream.value) return;
  if (el.srcObject !== previewStream.value) el.srcObject = previewStream.value;
  void el.play?.().catch(() => {});
});

const statusText = computed(() => {
  switch (callState.value) {
    case 'dialing':
      return 'Calling…';
    case 'remote-ringing':
      return 'Ringing…';
    case 'connecting':
      return 'Connecting…';
    case 'connected': {
      const s = callStats.value.durationSec;
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    default:
      return '';
  }
});

/* ---- free drag (tap = re-expand) ---- */
const pos = ref<{ x: number; y: number } | null>(null);
const style = computed(() =>
  pos.value ? { left: `${pos.value.x}px`, top: `${pos.value.y}px`, right: 'auto', bottom: 'auto' } : {},
);
let down = false;
let moved = false;
let sx = 0;
let sy = 0;
let ox = 0;
let oy = 0;
function onDown(e: PointerEvent): void {
  down = true;
  moved = false;
  sx = e.clientX;
  sy = e.clientY;
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  ox = r.left;
  oy = r.top;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}
function onMove(e: PointerEvent): void {
  if (!down) return;
  const dx = e.clientX - sx;
  const dy = e.clientY - sy;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
  if (moved) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pos.value = {
      x: Math.min(Math.max(6, ox + dx), window.innerWidth - r.width - 6),
      y: Math.min(Math.max(6, oy + dy), window.innerHeight - r.height - 6),
    };
  }
}
function onUp(): void {
  if (down && !moved) expandCall(); // a tap (not a drag) re-opens the full call screen
  down = false;
  moved = false;
}
function end(): void {
  void hangupCall();
}
</script>

<style scoped>
.mini {
  position: fixed;
  right: 12px;
  /* Default above the bottom tab bar; dragging overrides via inline left/top. */
  bottom: calc(max(12px, env(safe-area-inset-bottom)) + 66px);
  z-index: 15000;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px 7px 8px;
  border-radius: 28px;
  background: #0a7d5c;
  color: #fff;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
  cursor: grab;
  touch-action: none;
  max-width: 230px;
}
.mini.video {
  padding: 0;
  gap: 0;
  width: 116px;
  height: 158px;
  border-radius: 14px;
  overflow: hidden;
  background: #111;
}
.mini-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mini-avatar {
  flex: none;
  width: 40px;
  height: 40px;
}
.mini-info {
  flex: 1;
  min-width: 0;
}
.mini-name {
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mini-status {
  font-size: 12px;
  opacity: 0.9;
  font-variant-numeric: tabular-nums;
}
/* Video: a small status chip + the end button overlaid on the rectangle. */
.mini-chip {
  position: absolute;
  left: 6px;
  top: 6px;
  padding: 2px 7px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.5);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.mini-end {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: var(--ion-color-danger, #eb445a);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transform: rotate(135deg);
}
.mini.video .mini-end {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 32px;
  height: 32px;
}
.mini-end ion-icon {
  font-size: 18px;
}
</style>
