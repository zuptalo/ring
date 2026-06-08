<template>
  <ion-page>
    <ion-content :fullscreen="true" class="call">
      <div ref="stageEl" class="stage">
        <!-- Group call: tap a tile to spotlight it on the main stage (the rest
             become a side filmstrip); no spotlight = an even grid (default). -->
        <div v-if="callMeta?.isGroup" class="group">
          <video
            v-if="spotlightId && spotlightStream"
            :key="spotlightId"
            :ref="(el) => attach(el as HTMLVideoElement | null, spotlightStream)"
            class="main-video"
            :class="{ mirror: spotlightId === SELF }"
            :muted="spotlightId === SELF"
            autoplay
            playsinline
            @click="promote(null)"
          />
          <div class="group-grid" :class="{ filmstrip: spotlightId }" :style="spotlightId ? undefined : gridStyle">
            <video
              v-for="s in gridStreams"
              :key="s.id"
              :ref="(el) => attach(el as HTMLVideoElement | null, s)"
              class="tile"
              autoplay
              playsinline
              @click="promote(s.id)"
            />
            <video
              v-if="showSelfTile"
              :ref="(el) => attach(el as HTMLVideoElement | null, localStream)"
              class="tile self mirror"
              autoplay
              playsinline
              muted
              @click="promote(SELF)"
            />
            <!-- A participant who just left: a waving hand that fades out (keeping the
                 layout steady for a beat, then freeing room for the rest to grow). -->
            <div v-for="l in leaving" :key="l.id" class="tile leaving">
              <span class="leave-wave"><emoji emoji="👋" /></span>
            </div>
          </div>
          <div v-if="remoteStreams.length === 0" class="group-waiting">
            <ion-spinner name="crescent" />
            <p>Waiting for others to join…</p>
          </div>
        </div>

        <!-- 1:1 call: one stream fills the screen, the other is a draggable PiP.
             Tap the PiP to swap which is fullscreen; drag it to any of 9 anchors. -->
        <template v-else>
          <!-- Both 1:1 videos are muted; remote audio plays through the dedicated
               sinks below so we can steer earpiece vs loudspeaker. -->
          <video
            v-show="mainHasVideo"
            ref="mainVideo"
            class="main-video"
            :class="{ mirror: mainIsLocal && cameraFacing === 'user' }"
            muted
            autoplay
            playsinline
          />
          <div v-if="!mainHasVideo" class="audio-stage">
            <ion-avatar class="big-avatar">
              <img v-if="callMeta" :src="callMeta.avatar" :alt="callMeta.name" />
            </ion-avatar>
          </div>

          <!-- Picture-in-picture (video only): tap = swap, drag = reposition. -->
          <video
            v-show="pipHasVideo"
            ref="pipVideo"
            class="pip-video"
            :style="pipStyle"
            muted
            autoplay
            playsinline
            @pointerdown="onPipDown"
            @pointermove="onPipMove"
            @pointerup="onPipUp"
            @pointercancel="onPipCancel"
          />

          <!-- Remote audio sink (1:1): a single hidden <audio> element. On Chromium
               setSinkId on it selects the output device; on iOS the OS owns the route
               (we never attach the stream to a <video>, which would force the
               loudspeaker and double-play the audio). One element = no AGC fighting. -->
          <audio ref="earAudio" class="route-sink" autoplay playsinline />
        </template>

        <!-- Header: name + status/duration/bitrate, plus a connection warning.
             Long-press toggles a small diagnostics readout (for spot-checking the
             audio route + track state on a real device). -->
        <div
          class="overlay-top"
          @pointerdown="diagDown"
          @pointerup="diagUp"
          @pointerleave="diagUp"
          @pointercancel="diagUp"
        >
          <h2 class="name">{{ callMeta?.name }}</h2>
          <p class="status">{{ statusText }}</p>
          <p v-if="connectionWarning" class="warn">
            <ion-icon :icon="warningOutline" /> {{ connectionWarning }}
          </p>
          <p v-if="callState === 'connected'" class="stats">
            ↑ {{ callStats.kbpsUp }} ↓ {{ callStats.kbpsDown }} kbps
          </p>
          <pre v-if="showDiag" class="diag">{{ diag }}</pre>
        </div>

        <!-- We asked to switch to video; waiting for the peer to accept/decline. -->
        <p v-if="upgradePending" class="upgrade-pending">
          <ion-spinner name="dots" /> Asking to switch to video…
        </p>

        <!-- The peer asked to switch to video: accept or decline (consent-gated). -->
        <div v-if="upgradeRequest" class="upgrade-prompt">
          <p>{{ callMeta?.name }} wants to switch to video</p>
          <div class="upgrade-actions">
            <button class="up-btn decline" @click="rejectUpgrade">Decline</button>
            <button class="up-btn accept" @click="acceptUpgrade">
              <ion-icon :icon="videocamOutline" /> Accept
            </button>
          </div>
        </div>

        <!-- Controls. -->
        <div class="controls">
          <button class="ctl" :class="{ active: muted }" aria-label="Mute" @click="toggleMute">
            <ion-icon :icon="muted ? micOffOutline : micOutline" />
          </button>
          <button
            v-if="callMeta?.kind === 'video'"
            class="ctl"
            :class="{ active: cameraOff }"
            aria-label="Camera"
            @click="toggleCamera"
          >
            <ion-icon :icon="cameraOff ? videocamOffOutline : videocamOutline" />
          </button>
          <button v-if="canRoute" class="ctl" aria-label="Audio output" @click="chooseOutput">
            <ion-icon :icon="routeIcon" />
          </button>
          <button class="ctl" :class="{ active: screenSharing }" aria-label="More" @click="openMore">
            <ion-icon :icon="ellipsisHorizontalOutline" />
          </button>
          <button class="ctl hangup" aria-label="Hang up" @click="hangup">
            <ion-icon :icon="callOutline" />
          </button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { IonPage, IonContent, IonAvatar, IonIcon, IonSpinner, actionSheetController } from '@ionic/vue';
import Emoji from '@/components/Emoji.vue';
import {
  micOutline, micOffOutline, videocamOutline, videocamOffOutline, callOutline,
  volumeHighOutline, bluetoothOutline, warningOutline,
  phonePortraitOutline, cameraReverseOutline, desktopOutline, ellipsisHorizontalOutline,
} from 'ionicons/icons';
import {
  callState, callMeta, localStream, remoteStream, remoteStreams, muted, cameraOff, callStats,
  connectionWarning, hangupCall, toggleMute, toggleCamera, cameraFacing, screenSharing,
  switchCamera, toggleScreenShare, toggleVideoMode, canScreenShare,
  upgradePending, upgradeRequest, acceptUpgrade, rejectUpgrade,
  audioOutputId, supportsAudioOutput, isIOS, refreshAudioOutputs, audioRoute, availableRoutes, setRoute,
  type AudioRoute,
} from '@/composables/useCall';

const mainVideo = ref<HTMLVideoElement | null>(null);
const pipVideo = ref<HTMLVideoElement | null>(null);
const earAudio = ref<HTMLAudioElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);

/* ---- 1:1 stage: which stream is fullscreen, and where the PiP sits ---- */
// mainIsLocal=false → remote is fullscreen, local is the PiP (the usual layout);
// tapping the PiP flips it. Component-local, so it resets to default each new call.
const mainIsLocal = ref(false);
const pipIsLocal = computed(() => !mainIsLocal.value);
const mainStream = computed(() => (mainIsLocal.value ? localStream.value : remoteStream.value));
const pipStream = computed(() => (mainIsLocal.value ? remoteStream.value : localStream.value));
const isVideoCall = computed(() => callMeta.value?.kind === 'video' && !callMeta.value?.isGroup);
// A slot shows live video only for a video call, when its stream exists and isn't a
// camera-off local preview (otherwise we fall back to the avatar / hide the PiP).
const mainHasVideo = computed(
  () => isVideoCall.value && !!mainStream.value && !(mainIsLocal.value && cameraOff.value),
);
const pipHasVideo = computed(
  () => isVideoCall.value && !!pipStream.value && !(pipIsLocal.value && cameraOff.value),
);

function swapMain(): void {
  if (!isVideoCall.value) return;
  mainIsLocal.value = !mainIsLocal.value;
}

// PiP anchor in a 3×3 grid: row 0=top,1=middle,2=bottom; col 0=left,1=center,2=right.
// Default top-right (matches the old fixed position). The middle column is centered;
// side columns hug their edge; top/bottom rows hug the outer edge, all with the SAME
// margin, so the two corners nearest each outer edge are always equally inset.
const pipPos = ref({ row: 0, col: 2 });
const pipStyle = computed(() => {
  const { row, col } = pipPos.value;
  let left: string;
  let tx = '0';
  if (col === 0) left = 'var(--pip-mx)';
  else if (col === 2) left = 'calc(100% - var(--pip-w) - var(--pip-mx))';
  else {
    left = '50%';
    tx = '-50%';
  }
  let top: string;
  let ty = '0';
  // Top-center dodges the name/status overlay; the whole bottom row sits just above
  // the control bar (which spans the bottom) so no anchor lands under the buttons;
  // the two corners nearest the bottom edge keep an equal margin either way.
  const topInset = col === 1 ? 'var(--pip-top-c)' : 'var(--pip-top)';
  if (row === 0) top = topInset;
  else if (row === 2) top = 'calc(100% - var(--pip-h) - var(--pip-bot-c))';
  else {
    top = '50%';
    ty = '-50%';
  }
  // Mirror the local preview; bake it into the transform so it composes with the
  // translate (an inline transform would otherwise override a .mirror class).
  const mirror = pipIsLocal.value ? ' scaleX(-1)' : '';
  return { left, top, transform: `translate(${tx}, ${ty})${mirror}` };
});

// Drag-to-reposition with a movement threshold so a stationary tap = swap.
let dragOrigin: { x: number; y: number } | null = null;
let dragMoved = false;
function onPipDown(e: PointerEvent): void {
  dragOrigin = { x: e.clientX, y: e.clientY };
  dragMoved = false;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  e.stopPropagation();
}
function onPipMove(e: PointerEvent): void {
  if (!dragOrigin) return;
  if (Math.hypot(e.clientX - dragOrigin.x, e.clientY - dragOrigin.y) > 10) dragMoved = true;
}
function onPipUp(e: PointerEvent): void {
  if (!dragOrigin) return;
  const stage = stageEl.value;
  if (dragMoved && stage) {
    const rect = stage.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    pipPos.value = {
      col: fx < 1 / 3 ? 0 : fx < 2 / 3 ? 1 : 2,
      row: fy < 1 / 3 ? 0 : fy < 2 / 3 ? 1 : 2,
    };
  } else {
    swapMain(); // a stationary tap promotes the PiP to fullscreen
  }
  dragOrigin = null;
  dragMoved = false;
}
function onPipCancel(): void {
  dragOrigin = null;
  dragMoved = false;
}

/* ---- group stage: optional spotlight (tap a tile to promote it) ---- */
const SELF = '__self__';
const spotlightId = ref<string | null>(null);
const spotlightStream = computed(() =>
  spotlightId.value === SELF
    ? localStream.value
    : spotlightId.value
      ? remoteStreams.value.find((s) => s.id === spotlightId.value) ?? null
      : null,
);
const gridStreams = computed(() => remoteStreams.value.filter((s) => s.id !== spotlightId.value));
const showSelfTile = computed(() => !!localStream.value && spotlightId.value !== SELF);
function promote(id: string | null): void {
  spotlightId.value = id;
}

// Even-grid layout: pick a column count that keeps tiles roughly rectangular rather
// than tall-and-narrow. On a portrait phone two tiles stack (full-width, landscape);
// otherwise we cap at 2-3 columns. `leaving` tiles count so the grid stays steady
// while a departed participant's waving placeholder fades, then the rest grow.
const portrait = ref(true);
function updateOrientation(): void {
  portrait.value = window.innerHeight >= window.innerWidth;
}
const leaving = ref<{ id: string }[]>([]);
let prevStreamIds: string[] = [];
const tileCount = computed(
  () => gridStreams.value.length + (showSelfTile.value ? 1 : 0) + leaving.value.length,
);
const gridCols = computed(() => {
  const n = Math.max(1, tileCount.value);
  if (n === 1) return 1;
  if (n === 2) return portrait.value ? 1 : 2;
  if (n <= 6) return 2;
  return 3;
});
const gridStyle = computed(() => ({ gridTemplateColumns: `repeat(${gridCols.value}, 1fr)` }));

// The route button reflects the LIVE route so the user can tell where audio is going.
// Earpiece uses a phone-handset icon (clearly distinct from the loudspeaker).
const routeIcon = computed(() =>
  audioRoute.value === 'bluetooth'
    ? bluetoothOutline
    : audioRoute.value === 'speaker'
      ? volumeHighOutline
      : phonePortraitOutline,
);
// Only offer the earpiece/speaker/BT toggle where it actually works: Chromium via
// setSinkId (`supportsAudioOutput`). iOS has no such API, so we show no toggle there
// and let the OS own the route (proximity + Control Center + auto-Bluetooth).
const canRoute = computed(() => supportsAudioOutput() && availableRoutes.value.length > 1);

/** Point a media element's audio at the chosen output device (best-effort). */
function applySinkTo(el: HTMLMediaElement | null): void {
  const sink = (el as unknown as { setSinkId?: (id: string) => Promise<void> } | null)?.setSinkId;
  if (el && sink) void sink.call(el, audioOutputId.value).catch(() => {});
}

/** Route the 1:1 remote audio through the single hidden <audio> element. On Chromium
 *  setSinkId selects the output device; on iOS the OS owns the route (we never attach
 *  the stream to a <video>, which forced the loudspeaker and made two players' AGC
 *  fight, oscillating the volume). The visible call videos stay muted. */
function routeRemoteAudio(): void {
  if (callMeta.value?.isGroup) return; // group audio plays via the tiles
  const el = earAudio.value;
  const stream = remoteStream.value;
  if (!el) return;
  if (el.srcObject !== (stream ?? null)) el.srcObject = stream;
  el.muted = false;
  if (stream) void el.play?.().catch(() => {});
  applySinkTo(el); // Chromium device selection (no-op on iOS)
}

function attach(el: HTMLVideoElement | null, stream: MediaStream | null): void {
  if (!el) return;
  if (el.srcObject !== stream) el.srcObject = stream;
  if (stream) {
    // Always (re)play, not only on a srcObject swap: a preview that became visible
    // or had its stream attached while hidden needs a fresh play() or it stays black
    // on older iOS (e.g. iPhone 8). Nudge again shortly after, once it's laid out.
    void el.play?.().catch(() => {});
    setTimeout(() => void el.play?.().catch(() => {}), 150);
  }
  applySinkTo(el);
}

/** Re-route every media element on screen (after a device change). */
function applySinkAll(): void {
  stageEl.value?.querySelectorAll('video').forEach((v) => applySinkTo(v));
}

// 1:1: bind each physical element to its slot's stream ONLY when that slot actually
// shows video. For an audio call the remote stream must never reach a <video> (a
// playing <video>, even muted, forces iOS to the loudspeaker and defeats the <audio>
// earpiece sink); audio then flows solely through routeRemoteAudio's sink elements.
watch([mainVideo, mainStream, mainHasVideo], () =>
  attach(mainVideo.value, mainHasVideo.value ? mainStream.value : null),
);
watch([pipVideo, pipStream, pipHasVideo], () =>
  attach(pipVideo.value, pipHasVideo.value ? pipStream.value : null),
);
watch(audioOutputId, applySinkAll);
// Re-route the 1:1 remote audio whenever the stream, the chosen route, the sink
// elements, or the call kind (audio<->video changes the default route) changes.
watch([remoteStream, audioOutputId, earAudio], routeRemoteAudio);
watch(remoteStreams, (streams) => {
  const ids = streams.map((s) => s.id);
  // A participant whose stream just disappeared left → show a brief waving-hand
  // placeholder that fades out before the grid reflows (the rest then grow).
  for (const gone of prevStreamIds) {
    if (!ids.includes(gone) && !leaving.value.some((l) => l.id === gone)) {
      leaving.value = [...leaving.value, { id: gone }];
      setTimeout(() => {
        leaving.value = leaving.value.filter((l) => l.id !== gone);
      }, 1800);
    }
  }
  prevStreamIds = ids;
  // If the spotlighted participant left, drop back to the even grid (no black stage).
  if (
    spotlightId.value &&
    spotlightId.value !== SELF &&
    !streams.some((s) => s.id === spotlightId.value)
  ) {
    spotlightId.value = null;
  }
  // New tiles mount asynchronously as participants join, re-assert the sink once
  // they're in the DOM (their :ref attach also applies it; this is the safety net
  // for a srcObject/setSinkId ordering race).
  void nextTick(applySinkAll);
});
onMounted(() => {
  updateOrientation();
  window.addEventListener('resize', updateOrientation);
  attach(mainVideo.value, mainHasVideo.value ? mainStream.value : null);
  attach(pipVideo.value, pipHasVideo.value ? pipStream.value : null);
  routeRemoteAudio();
});
onUnmounted(() => window.removeEventListener('resize', updateOrientation));

/* ---- secondary controls (camera flip, screen share, video<->audio) in a sheet ---- */
async function openMore(): Promise<void> {
  const isGroup = !!callMeta.value?.isGroup;
  const isVideo = callMeta.value?.kind === 'video';
  const buttons: Parameters<typeof actionSheetController.create>[0]['buttons'] = [];
  if (isVideo && !screenSharing.value) {
    buttons.push({ text: 'Flip camera', icon: cameraReverseOutline, handler: () => void switchCamera() });
  }
  // Screen share needs a video sender to swap; on a group audio call there isn't one
  // (turn on video first), so only offer it for 1:1 or a group video call. Also hide
  // it where the platform can't capture the screen (iOS Safari has no getDisplayMedia).
  if ((!isGroup || isVideo) && canScreenShare()) {
    buttons.push({
      text: screenSharing.value ? 'Stop screen share' : 'Share screen',
      icon: desktopOutline,
      handler: () => void toggleScreenShare(),
    });
  }
  // Video<->audio now works for group calls too (the SFU re-offers the added/removed
  // track), so it's always offered.
  buttons.push({
    text: isVideo ? 'Switch to audio only' : 'Turn on video',
    icon: isVideo ? videocamOffOutline : videocamOutline,
    handler: () => void toggleVideoMode(),
  });
  buttons.push({ text: 'Cancel', role: 'cancel' });
  const sheet = await actionSheetController.create({ header: 'Call options', buttons });
  await sheet.present();
}

const ROUTE_LABEL: Record<AudioRoute, string> = {
  earpiece: 'Earpiece',
  speaker: 'Speaker',
  bluetooth: 'Bluetooth',
};

/** Switch the audio route. With just earpiece+speaker a single tap flips between
 *  them (fast, one-handed); when Bluetooth is also present, open a picker. */
async function chooseOutput(): Promise<void> {
  await refreshAudioOutputs();
  const routes = availableRoutes.value;
  if (routes.length === 2 && !routes.includes('bluetooth')) {
    await setRoute(audioRoute.value === 'speaker' ? 'earpiece' : 'speaker', { manual: true });
    return;
  }
  const buttons = [
    ...routes.map((r) => ({
      text: ROUTE_LABEL[r],
      role: r === audioRoute.value ? 'selected' : undefined,
      handler: () => void setRoute(r, { manual: true }),
    })),
    { text: 'Cancel', role: 'cancel' as const },
  ];
  const sheet = await actionSheetController.create({ header: 'Audio output', buttons });
  await sheet.present();
}

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
      const m = Math.floor(s / 60);
      return `${m}:${String(s % 60).padStart(2, '0')}`;
    }
    case 'ended':
      return 'Call ended';
    default:
      return '';
  }
});

function hangup(): void {
  void hangupCall();
}

/* ---- diagnostics (long-press the header) for on-device spot-checks ---- */
const showDiag = ref(false);
let diagTimer: ReturnType<typeof setTimeout> | undefined;
function diagDown(): void {
  diagTimer = setTimeout(() => (showDiag.value = !showDiag.value), 600);
}
function diagUp(): void {
  if (diagTimer) clearTimeout(diagTimer);
  diagTimer = undefined;
}
const diag = computed(() => {
  const ls = localStream.value;
  const local = ls ? ls.getTracks().map((t) => `${t.kind}${t.enabled ? '' : ':off'}`).join(' ') || '-' : '-';
  const remote = callMeta.value?.isGroup
    ? `${remoteStreams.value.length} peers, ${remoteStreams.value.reduce((n, s) => n + s.getVideoTracks().length, 0)} video`
    : remoteStream.value
      ? remoteStream.value.getTracks().map((t) => t.kind).join(' ') || '-'
      : '-';
  const sink = callMeta.value?.isGroup ? 'tiles' : '<audio>';
  const routeStr = isIOS() ? 'OS-controlled (no web toggle)' : audioRoute.value;
  return [
    `platform: ${isIOS() ? 'iOS' : 'other'}`,
    `call: ${callMeta.value?.kind}${callMeta.value?.isGroup ? ' group' : ' 1:1'}`,
    `route: ${routeStr} via ${sink}`,
    `camera: ${cameraFacing.value}${screenSharing.value ? ' +screenshare' : ''}`,
    `local: ${local}`,
    `remote: ${remote}`,
  ].join('\n');
});
</script>

<style scoped>
.call {
  --background: #000;
}
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  color: #fff;
  /* PiP geometry. The two center anchors add room to clear the top overlay and
     the bottom control bar so the PiP never sits under them. */
  --pip-w: 110px;
  --pip-h: 150px;
  --pip-mx: 16px;
  --pip-top: max(16px, env(safe-area-inset-top));
  --pip-bot: max(16px, env(safe-area-inset-bottom));
  --pip-top-c: calc(max(16px, env(safe-area-inset-top)) + 96px);
  --pip-bot-c: calc(max(16px, env(safe-area-inset-bottom)) + 104px);
}
.group {
  position: absolute;
  inset: 0;
}
.main-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #111;
}
.group .main-video {
  cursor: pointer;
}
.mirror {
  transform: scaleX(-1);
}
.audio-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* Hidden audio/video elements used only to steer the 1:1 remote audio route; they
   must stay in the DOM and playing, but take no space. */
.route-sink {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.group-grid {
  position: absolute;
  inset: 0;
  display: grid;
  /* Column count comes from gridStyle (count + orientation aware); rows fill evenly so
     tiles stay roughly rectangular instead of tall-and-narrow. */
  grid-auto-rows: 1fr;
  gap: 4px;
  padding: 4px;
}
.group-grid .tile {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  object-fit: cover;
  background: #111;
  border-radius: 8px;
  cursor: pointer;
}
.group-grid .tile.self {
  outline: 2px solid var(--ion-color-primary, #10b981);
}
/* A departed participant's placeholder: a waving hand that fades out. */
.group-grid .tile.leaving {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  animation: tile-leave 1.8s ease forwards;
}
.leave-wave {
  font-size: 44px;
  display: inline-flex;
  transform-origin: 70% 70%;
  animation: wave-bob 0.8s ease-in-out infinite;
}
@keyframes tile-leave {
  0%,
  55% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@keyframes wave-bob {
  0%,
  100% {
    transform: rotate(-9deg);
  }
  50% {
    transform: rotate(13deg);
  }
}
/* When a participant is spotlighted, the others become a horizontal strip along the
   bottom, just above the controls (clear of the safe area). */
.group-grid.filmstrip {
  inset: auto 8px calc(max(16px, env(safe-area-inset-bottom)) + 92px) 8px;
  top: auto;
  height: 92px;
  display: grid;
  grid-template-columns: none;
  grid-auto-flow: column;
  grid-auto-columns: 116px;
  grid-auto-rows: 92px;
  gap: 8px;
  padding: 0;
  overflow-x: auto;
  overflow-y: hidden;
  z-index: 2;
}
.group-waiting {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #fff;
  opacity: 0.8;
}
.big-avatar {
  width: 140px;
  height: 140px;
}
.pip-video {
  position: absolute;
  width: var(--pip-w);
  height: var(--pip-h);
  object-fit: cover;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: #111;
  z-index: 3;
  cursor: grab;
  touch-action: none; /* claim the drag gesture (no page pan) */
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  transition:
    top 0.18s ease,
    left 0.18s ease,
    transform 0.18s ease;
}
.overlay-top {
  position: absolute;
  top: max(24px, env(safe-area-inset-top));
  left: 0;
  right: 0;
  text-align: center;
  z-index: 1;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}
.name {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.status {
  margin: 4px 0 0;
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
}
.stats {
  margin: 2px 0 0;
  font-size: 12px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.diag {
  margin: 10px auto 0;
  display: inline-block;
  text-align: left;
  font-size: 11px;
  line-height: 1.45;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  white-space: pre;
}
.warn {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--ion-color-warning, #ffc409);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: max(36px, env(safe-area-inset-bottom));
  display: flex;
  /* Five buttons must fit a ~360pt phone without the flexbox squishing them into
     ovals: a tighter gap + side padding + non-shrinking circular buttons, and wrap
     as a last resort on very narrow screens. */
  gap: 14px;
  row-gap: 14px;
  flex-wrap: wrap;
  padding: 0 12px;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.ctl {
  flex: 0 0 auto; /* never shrink → stays a circle */
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ctl ion-icon {
  font-size: 25px;
}
.ctl.active {
  background: #fff;
  color: #000;
}
.ctl.hangup {
  background: var(--ion-color-danger, #eb445a);
  transform: rotate(135deg);
}
/* Video-upgrade consent UI (1:1). */
.upgrade-pending {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(max(36px, env(safe-area-inset-bottom)) + 76px);
  text-align: center;
  color: #fff;
  opacity: 0.85;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  z-index: 3;
}
.upgrade-prompt {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(max(36px, env(safe-area-inset-bottom)) + 84px);
  margin: 0 auto;
  max-width: 420px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(20, 20, 22, 0.92);
  backdrop-filter: blur(14px);
  color: #fff;
  text-align: center;
  z-index: 4;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.4);
}
.upgrade-prompt p {
  margin: 0 0 12px;
  font-size: 15px;
}
.upgrade-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.up-btn {
  flex: 1;
  max-width: 160px;
  padding: 11px 14px;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.up-btn.decline {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}
.up-btn.accept {
  background: var(--ion-color-primary, #10b981);
  color: #fff;
}
</style>
