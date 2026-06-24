<template>
  <ion-page>
    <ion-content :fullscreen="true" class="call">
      <!-- Full-screen incoming-call answer view: shown when the call is why you're opening the
           app (backgrounded → foreground, or a cold start / notification tap). When you're
           already using the app, the non-intrusive banner handles it instead and this route
           is never pushed. -->
      <div v-if="callState === 'incoming' && callMeta" class="incoming-fs">
        <div class="incoming-info">
          <ion-avatar class="incoming-avatar"><img :src="callMeta.avatar" :alt="callMeta.name" /></ion-avatar>
          <h2 class="incoming-name">{{ callMeta.name }}</h2>
          <p class="incoming-kind">
            {{ callMeta.isGroup ? 'Group · ' : '' }}Incoming {{ callMeta.kind === 'video' ? 'video' : 'voice' }} call…
          </p>
          <p v-if="participantsLine" class="incoming-with">{{ participantsLine }}</p>
        </div>
        <div class="incoming-actions">
          <button class="ans-btn decline" aria-label="Decline" @click="rejectCall">
            <ion-icon :icon="callOutline" />
          </button>
          <button
            v-if="!callMeta.isGroup"
            class="ans-btn message"
            aria-label="Decline with message"
            @click="incomingDeclineMenu"
          >
            <ion-icon :icon="chatbubbleEllipsesOutline" />
          </button>
          <button class="ans-btn accept" aria-label="Accept" @click="acceptCall">
            <ion-icon :icon="callMeta.kind === 'video' ? videocamOutline : callOutline" />
          </button>
        </div>
      </div>
      <div ref="stageEl" class="stage" :class="{ 'chrome-hidden': chromeHidden }" @click="onStageClick">
        <!-- Coming off hold (spec 0005): the other side resumed, so we get a 5s heads-up + cue
             before our camera/mic go live again, so we're not caught by surprise. -->
        <div v-if="resumeCountdown !== null" class="resume-countdown" role="status" @click.stop>
          <div class="rc-num">{{ resumeCountdown }}</div>
          <div class="rc-text">You're back on camera…</div>
        </div>
        <!-- Call waiting (spec 0005): a second call arriving over the active one offers
             Accept & hold / Decline; the call you already have on hold shows a bar; and when
             the other side has put US on hold a badge shows. -->
        <div
          v-if="incomingSecond"
          class="cw-prompt"
          role="alertdialog"
          :aria-label="`Incoming ${incomingSecond.callKind === 'video' ? 'video ' : ''}call from ${incomingSecond.name}`"
          @click.stop
        >
          <div class="cw-prompt-head">
            <ion-avatar class="cw-avatar">
              <img v-if="incomingSecond.avatar" :src="incomingSecond.avatar" :alt="incomingSecond.name" />
              <ion-icon v-else :icon="personOutline" />
            </ion-avatar>
            <div class="cw-text">
              <strong>{{ incomingSecond.name }}</strong>
              <span>Incoming {{ incomingSecond.callKind === 'video' ? 'video ' : '' }}call</span>
            </div>
          </div>
          <div class="cw-actions">
            <button class="cw-btn cw-decline" aria-label="Decline second call" @click.stop="rejectSecond">Decline</button>
            <button class="cw-btn cw-accept" aria-label="Hold current call and answer" @click.stop="acceptAndHold">Accept &amp; hold</button>
          </div>
        </div>
        <!-- The call you have parked: tap to swap back to it (the active call goes on hold). -->
        <button
          v-else-if="heldCall"
          class="cw-held"
          :aria-label="`On hold: ${heldCall.name}. Tap to resume this call.`"
          @click.stop="swapCalls"
        >
          <ion-icon :icon="pauseOutline" aria-hidden="true" /><span>On hold · {{ heldCall.name }}</span>
        </button>
        <div v-if="remoteHeld" class="cw-onhold" role="status">
          <ion-icon :icon="pauseOutline" aria-hidden="true" /><span>On hold</span>
        </div>

        <!-- Group call: every participant - each incoming feed AND our own outgoing
             feed - is an equally-sized floating tile. Tiles are centred and wrap;
             they grow when few are on the call and shrink as people join, never
             overlap, and each video uses object-fit:contain so the WHOLE frame shows
             (no cropping / partial feed). Tile pixel size comes from tileDims. -->
        <div v-if="callMeta?.isGroup" class="group">
          <div v-if="tiles.length === 0" class="group-waiting">
            <ion-spinner name="crescent" />
            <p>Waiting for others to join…</p>
          </div>
          <div v-else class="tiles">
            <div
              v-for="t in tiles"
              :key="t.key"
              class="float-tile"
              :class="{ self: t.isSelf, leaving: t.leaving, speaking: isSpeaking(t) }"
              :style="{ width: tileDims.w + 'px', height: tileDims.h + 'px' }"
            >
              <!-- A participant who just left: their avatar with a waving hand over it, held
                   for a beat then faded out (the layout stays steady, then the rest reflow
                   and grow). No toast — the tile itself is the goodbye. -->
              <template v-if="t.leaving">
                <div class="tile-camoff">
                  <img v-if="t.avatar" class="tile-avatar" :src="t.avatar" :alt="t.name" />
                  <ion-icon v-else :icon="personOutline" />
                </div>
                <span class="leave-wave"><emoji emoji="👋" /></span>
                <span v-if="t.name" class="tile-label">{{ t.name }}</span>
              </template>
              <template v-else>
                <!-- All tiles are MUTED here: remote audio plays through the persistent
                     global CallMediaSink so it survives minimising. The <video> stays
                     mounted (for video display) even with the camera off; the camera-off
                     icon just overlays it. -->
                <video
                  :ref="(el) => attach(el as HTMLVideoElement | null, t.stream)"
                  class="tile-video"
                  :class="{ mirror: t.isSelf && localMirror, 'held-frozen': groupHeldPeers.includes(t.key) }"
                  muted
                  autoplay
                  playsinline
                />
                <!-- No live video (camera off, audio-only, still ringing, or a feed that
                     hasn't landed yet): show the participant's avatar — their initials
                     avatar when we have no contact card — instead of a black tile. A
                     pending tile (ringing/connecting) adds a spinner so they read as
                     on-the-way, not camera-off. The <video> stays mounted so audio plays. -->
                <div v-if="!tileHasVideo(t)" class="tile-camoff" :class="{ pending: t.state !== 'live' }">
                  <img v-if="t.avatar" class="tile-avatar" :src="t.avatar" :alt="t.name" />
                  <ion-icon v-else :icon="t.state === 'live' ? videocamOffOutline : personOutline" />
                  <ion-spinner
                    v-if="t.state === 'ringing' || t.state === 'connecting'"
                    name="crescent"
                    class="tile-spinner"
                  />
                </div>
                <!-- Non-joiner / busy (caller only): tap to ring again or remove from the call. -->
                <button
                  v-if="t.state === 'not-joining' || t.state === 'busy'"
                  class="recall-btn"
                  aria-label="Ring again or remove"
                  @click.stop="openRecall(t)"
                >
                  <ion-icon :icon="refreshOutline" />
                </button>
                <span v-if="tileLabel(t)" class="tile-label">{{ tileLabel(t) }}</span>
                <!-- This member has put us on hold (their leg to us is paused) — spec 0005. -->
                <span v-if="groupHeldPeers.includes(t.key)" class="tile-onhold"><ion-icon :icon="pauseOutline" /> On hold</span>
                <button
                  v-if="t.isSelf && canFlip && tileHasVideo(t)"
                  class="flip-btn tile-flip"
                  aria-label="Flip camera"
                  @click.stop="switchCamera"
                >
                  <ion-icon :icon="cameraReverseOutline" />
                </button>
              </template>
            </div>
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
            :class="{ mirror: mainIsLocal && localMirror, 'held-frozen': remoteHeld && !mainIsLocal }"
            muted
            autoplay
            playsinline
          />
          <!-- The other side put us on hold (spec 0005): their last frame is frozen, so blur it
               (class above) and overlay a clear pause badge so it's obvious the call is paused. -->
          <div v-if="remoteHeld && mainHasVideo && !mainIsLocal" class="held-overlay">
            <ion-icon :icon="pauseOutline" />
            <span>On hold</span>
          </div>
          <!-- Flip button when our own camera fills the screen (local is the stage). -->
          <button
            v-if="mainIsLocal && mainHasVideo && canFlip"
            class="flip-btn main-flip"
            aria-label="Flip camera"
            @click="switchCamera"
          >
            <ion-icon :icon="cameraReverseOutline" />
          </button>
          <div v-if="!mainHasVideo" class="audio-stage">
            <ion-avatar class="big-avatar">
              <img v-if="callMeta" :src="callMeta.avatar" :alt="callMeta.name" />
            </ion-avatar>
          </div>

          <!-- Picture-in-picture (video only): tap = swap, drag = reposition. The flip
               button sits in the PiP corner (outside the mirror, so it isn't reversed)
               and stops the gesture so a tap flips instead of swapping/dragging. -->
          <div
            v-show="pipHasVideo"
            class="pip-wrap"
            :style="pipStyle"
            @pointerdown="onPipDown"
            @pointermove="onPipMove"
            @pointerup="onPipUp"
            @pointercancel="onPipCancel"
          >
            <video
              ref="pipVideo"
              class="pip-video"
              :class="{ mirror: pipIsLocal && localMirror }"
              muted
              autoplay
              playsinline
            />
            <button
              v-if="pipIsLocal && canFlip"
              class="flip-btn pip-flip"
              aria-label="Flip camera"
              @click.stop="switchCamera"
              @pointerdown.stop
            >
              <ion-icon :icon="cameraReverseOutline" />
            </button>
          </div>

          <!-- Remote audio plays through the global CallMediaSink (App.vue), so it keeps
               playing when this screen is minimised; the videos above stay muted. -->
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
          <!-- Minimize: leave the full-screen call (it keeps running as a floating
               widget) so you can use the app while on the call. -->
          <button class="minimize-btn" aria-label="Minimize call" @click.stop="minimizeCall">
            <ion-icon :icon="chevronDownOutline" />
          </button>
          <h2 class="name">{{ callMeta?.name }}</h2>
          <p class="status">{{ statusText }}</p>
          <!-- Calling someone already in a call who can take a second one: reassure the caller
               they're queued, not ignored (spec 0005). -->
          <p v-if="remoteQueued && callState === 'remote-ringing'" class="queue-note">
            They've been notified and will pick up if they can.
          </p>
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

        <!-- Controls. Flat - no overflow menu: camera-flip rides the self video, and
             switching audio<->video is a single direct button. -->
        <div class="controls">
          <button class="ctl" :class="{ active: muted }" aria-label="Mute" @click.stop="toggleMute">
            <ion-icon :icon="muted ? micOffOutline : micOutline" />
          </button>
          <!-- Camera on/off (video calls only). -->
          <button
            v-if="isVideoMode"
            class="ctl"
            :class="{ active: cameraOff }"
            aria-label="Camera"
            @click.stop="toggleCamera"
          >
            <ion-icon :icon="cameraOff ? videocamOffOutline : videocamOutline" />
          </button>
          <button v-if="canRoute" class="ctl" aria-label="Audio output" @click.stop="chooseOutput">
            <ion-icon :icon="routeIcon" />
          </button>
          <!-- iOS audio calls: honest earpiece<->speakerphone toggle (audio-session
               category flip). active = on loudspeaker. -->
          <button
            v-if="canIosSpeaker"
            class="ctl"
            :class="{ active: iosSpeaker }"
            aria-label="Speaker"
            @click.stop="setIosSpeakerphone(!iosSpeaker)"
          >
            <ion-icon :icon="iosSpeaker ? volumeHighOutline : phonePortraitOutline" />
          </button>
          <!-- Outgoing-video quality tier (video calls only). -->
          <button v-if="isVideoMode" class="ctl" aria-label="Video quality" @click.stop="chooseQuality">
            <ion-icon :icon="cellularOutline" />
          </button>
          <!-- Share screen, only where the platform can capture it (desktop / Android). -->
          <button
            v-if="canShareScreen"
            class="ctl"
            :class="{ active: screenSharing }"
            aria-label="Share screen"
            @click.stop="toggleScreenShare"
          >
            <ion-icon :icon="desktopOutline" />
          </button>
          <!-- Turn on video: only shown in an audio call (an audio call can become a video
               call). A video call no longer offers a "drop to audio" switch — to stop sending
               video, use the camera toggle. -->
          <button
            v-if="!isVideoMode"
            class="ctl"
            aria-label="Turn on video"
            @click.stop="toggleVideoMode"
          >
            <ion-icon :icon="videocamOutline" />
          </button>
          <button class="ctl hangup" aria-label="Hang up" @click.stop="hangup">
            <ion-icon :icon="callOutline" />
          </button>
        </div>

        <!-- DIAG(call-video): temporary on-screen diagnostics. A production deploy
             hides server logs and an iPhone's Safari console isn't readable, so the
             call stats are printed here. The key line is "video … in[recv=… dec=…]":
             recv>0 with dec=0 means a peer's frames ARRIVE but never decode (E2EE /
             codec), as opposed to in[none] (not forwarded). Remove with the rest of
             the call-diag instrumentation once the cause is confirmed. -->
        <div v-if="callDiagOpen" class="call-diag">
          <div class="call-diag-head">
            <span class="call-diag-title">call-diag</span>
            <button class="call-diag-btn" @click.stop="clearDiag">clear</button>
            <button class="call-diag-btn" @click.stop="callDiagOpen = false">hide</button>
          </div>
          <div class="call-diag-body">
            <!-- Live snapshot: codec, in/out video RTP, and the decisive decrypt tally. -->
            <div v-if="callDiagSnapshot.length === 0" class="call-diag-line">collecting…</div>
            <div v-for="(l, i) in callDiagSnapshot" :key="'s' + i" class="call-diag-line snap">{{ l }}</div>
            <!-- Recent events (ontrack / missing key). -->
            <div v-for="(l, i) in callDiagLines" :key="'e' + i" class="call-diag-line ev">{{ l }}</div>
          </div>
        </div>
        <!-- Tucked behind an ⓘ at the top-left of the video; tap to reveal the panel. -->
        <button
          v-else
          class="call-diag-info"
          aria-label="Call diagnostics"
          @click.stop="callDiagOpen = true"
        >
          <ion-icon :icon="informationCircleOutline" />
        </button>
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
  phonePortraitOutline, cameraReverseOutline, desktopOutline, chevronDownOutline,
  cellularOutline, informationCircleOutline, personOutline, refreshOutline,
  chatbubbleEllipsesOutline, pauseOutline,
} from 'ionicons/icons';
import { getSelfUserId } from '@/services/auth';
import {
  callState, callMeta, localStream, remoteStream, remoteStreams, groupStreamOwners, activeSpeakers, muted, cameraOff, callStats,
  connectionWarning, hangupCall, toggleMute, toggleCamera, cameraFacing, screenSharing,
  switchCamera, toggleScreenShare, toggleVideoMode, canScreenShare, minimizeCall, hasMultipleCameras,
  videoQuality, setVideoQuality, type VideoQuality,
  upgradePending, upgradeRequest, acceptUpgrade, rejectUpgrade,
  audioOutputId, isIOS, refreshAudioOutputs, audioRoute, availableRoutes, setRoute,
  iosSpeaker, setIosSpeakerphone,
  notJoining, busyMembers, recallMember, cancelInvite,
  acceptCall, rejectCall, declineWithMessage,
  heldCall, remoteHeld, groupHeldPeers, resumeCountdown, remoteQueued, incomingSecond, acceptAndHold, rejectSecond, swapCalls,
  type AudioRoute,
} from '@/composables/useCall';
import { useCallParticipants } from '@/composables/useCallParticipants';
import { getQuickDeclines } from '@/services/quick-declines';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { callDiagLines, callDiagSnapshot, callDiagOpen, clearDiag, pushDiag } from '@/services/call/diag';
import { listContacts } from '@/db/queries';
import { useSelfProfile } from '@/composables/useSelfProfile';
import { initialsAvatar } from '@/db/avatars';
import type { Contact } from '@/db/types';

const mainVideo = ref<HTMLVideoElement | null>(null);
const pipVideo = ref<HTMLVideoElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);

// Full-screen incoming-call answer view (the consent line is shared with the banner).
const { participantsLine } = useCallParticipants();
async function incomingDeclineMenu(): Promise<void> {
  const replies = await getQuickDeclines();
  const sheet = await actionSheetController.create({
    header: 'Decline with a message',
    buttons: [
      ...replies.map((text) => ({ text, handler: () => void declineWithMessage(text) })),
      { text: 'Decline without message', role: 'destructive', handler: () => void rejectCall() },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}

/* ---- 1:1 stage: which stream is fullscreen, and where the PiP sits ---- */
// mainIsLocal=false → remote is fullscreen, local is the PiP (the usual layout);
// tapping the PiP flips it. Component-local, so it resets to default each new call.
const mainIsLocal = ref(false);
const pipIsLocal = computed(() => !mainIsLocal.value);
// Mirror our OWN camera preview only for the front ('user') camera - a selfie view is
// expected mirrored, but the back camera (and a shared screen) must read the right way
// round. Applies to whichever slot shows our local video (tile / main / PiP).
const localMirror = computed(() => cameraFacing.value === 'user' && !screenSharing.value);
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

// kind === 'video' for ANY video call (1:1 or group); distinct from isVideoCall, which
// is 1:1-only. Drives the camera/quality controls and the immersive-tap behaviour.
const isVideoMode = computed(() => callMeta.value?.kind === 'video');
// Screen share is offered for 1:1 or a group VIDEO call, where the platform can capture
// the screen (no getDisplayMedia on iOS). Mirrors the old overflow-menu gating.
const canShareScreen = computed(
  () => (!callMeta.value?.isGroup || isVideoMode.value) && canScreenShare(),
);

/* ---- immersive tap: hide the chrome (name + controls) on a video call ---- */
const chromeHidden = ref(false);
function onStageClick(e: MouseEvent): void {
  if (!isVideoMode.value) return; // audio calls always show their controls
  // Only a tap on the bare video/background toggles; ignore taps on any interactive
  // chrome (controls, header, PiP, consent prompts, or any button).
  if (
    (e.target as HTMLElement).closest(
      '.controls, .overlay-top, .pip-wrap, .upgrade-prompt, .upgrade-pending, button',
    )
  )
    return;
  chromeHidden.value = !chromeHidden.value;
}
// Never strand the user with hidden controls: restore the chrome when a consent prompt
// appears, when the call leaves the connected state, or when it drops back to audio.
watch([upgradeRequest, upgradePending], ([r, p]) => {
  if (r || p) chromeHidden.value = false;
});
watch(callState, (s) => {
  if (s !== 'connected') chromeHidden.value = false;
});
watch(isVideoMode, (v) => {
  if (!v) chromeHidden.value = false;
});

function swapMain(): void {
  if (!isVideoCall.value) return;
  mainIsLocal.value = !mainIsLocal.value;
}

// PiP anchor in a 3×3 grid: row 0=top,1=middle,2=bottom; col 0=left,1=center,2=right.
// Default BOTTOM-right: our self-view sits clear of the call name/status overlay at the top of
// the screen (which it used to cover) while still resting just above the control bar. The middle
// column is centered; side columns hug their edge; top/bottom rows hug the outer edge, all with
// the SAME margin, so the two corners nearest each outer edge are always equally inset.
const pipPos = ref({ row: 2, col: 2 });
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
  // Position only - the local-preview mirror lives on the inner <video> (.mirror) so it
  // doesn't also flip the flip-camera button that rides in the PiP's corner.
  return { left, top, transform: `translate(${tx}, ${ty})` };
});

// Whether to offer the flip-camera button on a local-video box: a video call, with a
// live camera (not screen share, not camera-off) and a second camera to flip to.
const canFlip = computed(
  () => callMeta.value?.kind === 'video' && hasMultipleCameras.value && !screenSharing.value && !cameraOff.value,
);

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

/* ---- group stage: every participant is a floating, auto-sized tile ---- */
const SELF = '__self__';

// A participant who just left lingers as their avatar + a waving hand, so the layout stays
// steady — and the goodbye reads — for ~5s before the remaining tiles reflow and grow. Kept
// in sync with the `tile-leave` CSS animation duration below. We snapshot each stream's
// owner identity every cycle so that when a stream disappears we can still show WHO left
// (the streamId→userId mapping is already gone by the time the disappearance fires).
const LEAVE_MS = 5000;
const leaving = ref<{ id: string; name: string; avatar: string }[]>([]);
let prevStreamIds: string[] = [];
let prevIdentity = new Map<string, { name: string; avatar: string }>();
function snapshotIdentities(streams: MediaStream[]): Map<string, { name: string; avatar: string }> {
  const owners = groupStreamOwners.value;
  const m = new Map<string, { name: string; avatar: string }>();
  for (const s of streams) m.set(s.id, identity(owners[s.id]));
  return m;
}

interface Tile {
  key: string;
  stream: MediaStream | null;
  isSelf: boolean;
  leaving: boolean;
  // 'live' = a present participant (their video, or their avatar when camera-off); 'ringing'
  // = invited, not yet in the room; 'connecting' = joined but their media hasn't landed yet;
  // 'not-joining' = rang out the reminder window without joining (caller sees recall/remove);
  // 'busy' = replied unavailable (in another call). ringing/connecting render an avatar card
  // with a spinner; not-joining/busy a recall button.
  state: 'live' | 'ringing' | 'connecting' | 'not-joining' | 'busy';
  name: string; // '' → no name label (an as-yet-unidentified participant)
  avatar: string; // '' → fall back to a person icon
}

// Reactive contacts, keyed by userId, so a tile can resolve its owner's name + avatar
// synchronously (mirrors ChatDetailPage). Updates live if a contact card changes.
const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);
const contactsMap = computed(() => new Map(contacts.value.map((c) => [c.id, c])));

// Our own chosen name + avatar (shown on our own tile). Reactive so a rename mid-call
// propagates, and shared with the rest of the app via useSelfProfile.
const { name: selfName, avatar: selfAvatar } = useSelfProfile();

// Resolve a known contact (or our own profile) to a tile's name + avatar.
function identity(userId: string | undefined): { name: string; avatar: string } {
  const contact = userId ? contactsMap.value.get(userId) : undefined;
  if (!contact) return { name: '', avatar: '' };
  return { name: contact.name, avatar: contact.avatar || initialsAvatar(contact.name) };
}

// Tiles = every landed remote feed + a placeholder for each joined participant whose feed
// hasn't arrived yet + our own outgoing feed + any leaving placeholders. Incoming and
// outgoing are equally-sized floating units. A remote stream's owner is resolved via the
// streamId→userId map (groupStreamOwners, derived locally in the mesh as each leg's track
// arrives); tiles are keyed by user id so a "connecting" placeholder becomes the live feed
// in place — no remount, no black flash — the instant their media lands.
const tiles = computed<Tile[]>(() => {
  const owners = groupStreamOwners.value;
  const self = getSelfUserId() ?? '';
  const streamed = new Set<string>(); // user ids whose feed has landed
  const list: Tile[] = remoteStreams.value.map((s) => {
    const userId = owners[s.id];
    if (userId) streamed.add(userId);
    const { name, avatar } = identity(userId);
    return { key: userId || s.id, stream: s, isSelf: false, leaving: false, state: 'live' as const, name, avatar };
  });
  // Joined-but-not-yet-streaming members: show their name + avatar (a "connecting" card)
  // instead of an empty slot, so nobody ever stares at a black tile waiting for a feed.
  const roster = new Set(callMeta.value?.roster ?? []);
  for (const id of roster) {
    if (!id || id === self || streamed.has(id)) continue;
    const { name, avatar } = identity(id);
    list.push({ key: id, stream: null, isSelf: false, leaving: false, state: 'connecting', name, avatar });
  }
  // Invited people who haven't joined the room yet → a "ringing" card, so the initiator
  // sees everyone they're calling from the moment the call starts, not only once they pick
  // up. Once the reminder window elapses without them joining, the caller's tile becomes a
  // "not-joining" card with a recall/remove button.
  for (const id of callMeta.value?.invited ?? []) {
    if (!id || id === self || streamed.has(id) || roster.has(id)) continue;
    const { name, avatar } = identity(id);
    // Any participant (not just the initiator) can ring a no-show again or remove them, so the
    // not-joining tile shows for everyone (spec 0004).
    const state: Tile['state'] = busyMembers.value.has(id)
      ? 'busy'
      : notJoining.value.has(id)
        ? 'not-joining'
        : 'ringing';
    list.push({ key: id, stream: null, isSelf: false, leaving: false, state, name, avatar });
  }
  if (localStream.value) {
    list.push({
      key: SELF,
      stream: localStream.value,
      isSelf: true,
      leaving: false,
      state: 'live',
      name: selfName.value,
      avatar: selfAvatar.value,
    });
  }
  for (const l of leaving.value) {
    list.push({ key: `leave-${l.id}`, stream: null, isSelf: false, leaving: true, state: 'live', name: l.name, avatar: l.avatar });
  }
  return list;
});

// The label under a tile: a present participant shows their name; a pending one shows its
// status (the avatar already conveys WHO, the spinner that they're on the way).
function tileLabel(t: Tile): string {
  if (t.leaving) return '';
  if (t.state === 'ringing') return 'Ringing…';
  if (t.state === 'connecting') return 'Connecting…';
  if (t.state === 'busy') return t.name ? `${t.name} · Unavailable` : 'Unavailable';
  if (t.state === 'not-joining') return t.name || 'Not joined';
  return t.name;
}

// Recall/remove menu for a non-joining invitee's tile (any participant).
async function openRecall(t: Tile): Promise<void> {
  const sheet = await actionSheetController.create({
    header: t.name || 'Not joined yet',
    buttons: [
      { text: 'Ring again', handler: () => void recallMember(t.key) },
      { text: 'Remove from call', role: 'destructive', handler: () => void cancelInvite(t.key) },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}

/** Whether a tile is showing live video. When not, we overlay a camera-off icon but
 *  keep the <video> mounted so the participant's AUDIO keeps playing. (A peer's video
 *  track is removed from its stream when they turn the camera off, so the track count
 *  is a reliable signal and recomputes when remoteStreams is rebuilt.) */
function tileHasVideo(t: Tile): boolean {
  if (t.leaving) return false;
  if (t.isSelf) return !cameraOff.value && !!t.stream?.getVideoTracks().length;
  return !!t.stream && t.stream.getVideoTracks().length > 0;
}

// A tile is highlighted while its owner is talking. The active-speaker keys (from the
// audio metering in GroupSession) use the same key space as the tiles - a remote
// stream id, or SELF for our own feed.
function isSpeaking(t: Tile): boolean {
  return !t.leaving && activeSpeakers.value.includes(t.key);
}

// Live stage size, tracked with a ResizeObserver so tile sizing follows the actual
// element (orientation flips, split-screen, the keyboard) and not just window size.
const stageSize = ref({ w: 0, h: 0 });
let stageRO: ResizeObserver | null = null;
let frameProbe: number | null = null; // debug: periodic self-preview frame probe
function measureStage(): void {
  const el = stageEl.value;
  if (el) stageSize.value = { w: el.clientWidth, h: el.clientHeight };
}

// Floating-tile geometry. Tiles are uniform, centred and wrapped; we choose the tile
// size that packs ALL participants into the stage at the largest size (two people get
// big tiles, a crowd gets small ones - "grow/shrink by audience"). object-fit:contain
// then shows each whole frame, letterboxed in the tile's own bg, never cropped.
const TILE_ASPECT = 4 / 3; // tile box shape (the contained video keeps its own aspect)
const TILE_GAP = 10; // px between tiles - must match the CSS `gap`
const TILE_PAD = 12; // px stage padding - must match the CSS `padding`

const tileDims = computed(() => {
  const n = tiles.value.length;
  const { w: W, h: H } = stageSize.value;
  if (n === 0 || W === 0 || H === 0) return { w: 0, h: 0 };
  let best = { w: 0, h: 0, area: 0 };
  // Try every column count; for each, the rows it implies, then the largest
  // TILE_ASPECT box that fits one cell. Keep whichever yields the biggest tile.
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (W - 2 * TILE_PAD - (cols - 1) * TILE_GAP) / cols;
    const cellH = (H - 2 * TILE_PAD - (rows - 1) * TILE_GAP) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    let w = cellW;
    let h = w / TILE_ASPECT;
    if (h > cellH) {
      h = cellH;
      w = h * TILE_ASPECT;
    }
    const area = w * h;
    if (area > best.area) best = { w, h, area };
  }
  return { w: Math.floor(best.w), h: Math.floor(best.h) };
});

// The route button reflects the LIVE route so the user can tell where audio is going.
// Earpiece uses a phone-handset icon (clearly distinct from the loudspeaker).
const routeIcon = computed(() =>
  audioRoute.value === 'bluetooth'
    ? bluetoothOutline
    : audioRoute.value === 'speaker'
      ? volumeHighOutline
      : phonePortraitOutline,
);
// Only offer the earpiece/speaker/BT picker where it actually works (a real output
// sink enumerated — Chromium desktop / macOS Safari 18.4+). availableRoutes already
// excludes iOS and the iOS-18.4 phantom-setSinkId case, so this stays empty there.
const canRoute = computed(() => availableRoutes.value.length > 1);

// iOS gets an honest speakerphone toggle instead of the (impossible) device picker:
// it flips the audio-session category (earpiece <-> loudspeaker). Audio calls only —
// video already routes to the loudspeaker naturally. See setIosSpeakerphone.
const canIosSpeaker = computed(() => isIOS() && !isVideoMode.value);

/** Point a media element's audio at the chosen output device (best-effort). */
function applySinkTo(el: HTMLMediaElement | null): void {
  const sink = (el as unknown as { setSinkId?: (id: string) => Promise<void> } | null)?.setSinkId;
  if (el && sink) void sink.call(el, audioOutputId.value).catch(() => {});
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
    // Older iOS (iPhone 8) frequently hands us a camera/remote track that starts `muted`
    // (delivers NO frames) and unmutes a beat later — and re-mutes when the app briefly
    // backgrounds. Without this, the <video> stays black until the next attach. Re-play the
    // moment the track produces frames again. Assigning onunmute (not addEventListener) keeps
    // it idempotent and always pointed at the element the track is currently shown in.
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.onunmute = () => {
        void el.play?.().catch(() => {});
        setTimeout(() => void el.play?.().catch(() => {}), 150);
      };
    }
  }
  applySinkTo(el);
}

/** Re-route every media element on screen (after a device change). */
function applySinkAll(): void {
  stageEl.value?.querySelectorAll('video').forEach((v) => applySinkTo(v));
}

// 1:1: bind each physical element to its slot's stream ONLY when that slot actually
// shows video. For an audio call the remote stream must never reach a <video> (a
// playing <video>, even muted, forces iOS to the loudspeaker and defeats the earpiece
// route); audio always flows through the global CallMediaSink's <audio> elements.
watch([mainVideo, mainStream, mainHasVideo], () =>
  attach(mainVideo.value, mainHasVideo.value ? mainStream.value : null),
);
watch([pipVideo, pipStream, pipHasVideo], () =>
  attach(pipVideo.value, pipHasVideo.value ? pipStream.value : null),
);
watch(audioOutputId, applySinkAll);
watch(remoteStreams, (streams) => {
  const ids = streams.map((s) => s.id);
  // The waving "bye" is for when SOMEONE ELSE leaves while we stay. When WE'RE the one leaving
  // (teardown closes every peer connection at once, emptying remoteStreams), don't wave goodbye
  // to everybody — we're exiting. `tornDown` is set synchronously at the start of teardown,
  // before the streams clear, so it's the reliable "we initiated the leave" signal.
  if (callMeta.value?.tornDown) {
    prevStreamIds = ids;
    prevIdentity = snapshotIdentities(streams);
    return;
  }
  // A participant whose stream just disappeared left → show a brief avatar + waving-hand
  // placeholder that fades out before the grid reflows (the rest then grow). Their identity
  // comes from the PREVIOUS snapshot, since their streamId→owner mapping is already gone.
  for (const gone of prevStreamIds) {
    if (!ids.includes(gone) && !leaving.value.some((l) => l.id === gone)) {
      const who = prevIdentity.get(gone) ?? { name: '', avatar: '' };
      leaving.value = [...leaving.value, { id: gone, name: who.name, avatar: who.avatar }];
      setTimeout(() => {
        leaving.value = leaving.value.filter((l) => l.id !== gone);
      }, LEAVE_MS);
    }
  }
  prevStreamIds = ids;
  prevIdentity = snapshotIdentities(streams);
  // New tiles mount asynchronously as participants join, re-assert the sink once
  // they're in the DOM (their :ref attach also applies it; this is the safety net
  // for a srcObject/setSinkId ordering race).
  void nextTick(applySinkAll);
});
onMounted(() => {
  measureStage();
  // Prefer a ResizeObserver on the stage element; fall back to window resize where
  // it's unavailable. Either way, tile sizes recompute when the stage changes size.
  if (typeof ResizeObserver !== 'undefined' && stageEl.value) {
    stageRO = new ResizeObserver(measureStage);
    stageRO.observe(stageEl.value);
  } else {
    window.addEventListener('resize', measureStage);
  }
  attach(mainVideo.value, mainHasVideo.value ? mainStream.value : null);
  attach(pipVideo.value, pipHasVideo.value ? pipStream.value : null);
  // Debug frame probe: every 3s, report the LOCAL self-preview <video>'s decoded size + clock.
  // videoWidth>0 and currentTime advancing ⇒ the camera IS delivering frames (so a black tile is a
  // render/encode issue); 0×0 ⇒ no frames reach the element (a capture issue). Removed before merge.
  frameProbe = window.setInterval(() => {
    const el = mainIsLocal.value ? mainVideo.value : pipVideo.value;
    if (!el) return;
    // iOS throttles the CAMERA capture to ~1fps unless a visible <video> is actively PLAYING the
    // local stream. Nudge play() every tick; if the preview has decoded NO frames, re-attach its
    // srcObject to un-stick it. Keeps the camera at full framerate → real outgoing video on iPhone.
    void el.play?.().catch(() => {});
    if (el.videoWidth === 0 && el.srcObject) {
      const so = el.srcObject;
      el.srcObject = null;
      el.srcObject = so;
      void el.play?.().catch(() => {});
    }
    pushDiag(`selfvid: ${el.videoWidth}x${el.videoHeight} t=${el.currentTime.toFixed(1)} paused=${el.paused}`);
  }, 2000);
});
onUnmounted(() => {
  stageRO?.disconnect();
  stageRO = null;
  if (frameProbe) window.clearInterval(frameProbe);
  frameProbe = null;
  window.removeEventListener('resize', measureStage);
});

/* ---- outgoing-video quality picker ---- */
const QUALITY_LABEL: Record<VideoQuality, string> = {
  auto: 'Auto · best for your connection',
  medium: 'Medium · less data',
  low: 'Low · least data',
};
async function chooseQuality(): Promise<void> {
  const buttons = [
    ...(['auto', 'medium', 'low'] as VideoQuality[]).map((q) => ({
      text: QUALITY_LABEL[q],
      role: q === videoQuality.value ? ('selected' as const) : undefined,
      handler: () => void setVideoQuality(q),
    })),
    { text: 'Cancel', role: 'cancel' as const },
  ];
  const sheet = await actionSheetController.create({ header: 'Video quality', buttons });
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
      return remoteQueued.value ? 'Waiting in their call…' : 'Ringing…';
    case 'connecting':
      return 'Connecting…';
    case 'connected': {
      const s = callStats.value.durationSec;
      const m = Math.floor(s / 60);
      return `${m}:${String(s % 60).padStart(2, '0')}`;
    }
    case 'ended':
      switch (callMeta.value?.endedReason) {
        case 'busy':
          return 'Busy on another call';
        case 'unavailable':
          return 'Unavailable';
        case 'declined':
          return 'Call declined';
        default:
          return 'Call ended';
      }
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
  const routeStr = isIOS()
    ? `OS-controlled · ios-speaker:${iosSpeaker.value ? 'on' : 'off'}`
    : audioRoute.value;
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
/* DIAG(call-video): temporary on-screen diagnostics overlay. */
.call-diag {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 90px);
  left: 8px;
  right: 8px;
  z-index: 50;
  max-height: 46vh;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #9fe8a0;
  pointer-events: auto;
}
.call-diag-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}
.call-diag-title {
  flex: 1;
  color: #fff;
  font-weight: 600;
}
.call-diag-btn {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 10px;
}
.call-diag-body {
  overflow-y: auto;
  padding: 4px 8px;
  -webkit-overflow-scrolling: touch;
}
.call-diag-line {
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.4;
}
.call-diag-line.snap {
  color: #fff;
}
.call-diag-line.ev {
  color: #8fb7ff;
  opacity: 0.75;
}
.call-diag-info {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 90px);
  left: 10px;
  z-index: 50;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.75);
  border: none;
  border-radius: 50%;
  font-size: 20px;
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
  overflow: hidden;
}
.main-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* contain, not cover: show the producer's WHOLE frame at its real aspect ratio with
     zero zoom/crop. A landscape (desktop) feed letterboxes top/bottom on a portrait
     phone, a portrait feed pillarboxes - each side keeps its own shape, best-fit. */
  object-fit: contain;
  background: #111;
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
/* Group layout: equally-sized floating tiles, centred and wrapped. Each tile's pixel
   size is computed in script (tileDims) to pack every participant into the stage as
   large as possible, so tiles grow when few are on the call and shrink as more join -
   and they never overlap. justify-content:center makes a partial last row float in
   the middle rather than hug an edge. */
.tiles {
  position: absolute;
  inset: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  align-items: center;
  justify-content: center;
  gap: 10px; /* == TILE_GAP */
  padding: 12px; /* == TILE_PAD */
  overflow: hidden;
}
.float-tile {
  position: relative;
  flex: 0 0 auto; /* exact computed size - never stretched or squished */
  background: #111;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  /* Smoothly grow/shrink as the computed tile size changes on join/leave; new tiles
     fade + scale in as people arrive. */
  transition:
    width 0.25s ease,
    height 0.25s ease;
  animation: tile-in 0.25s ease;
}
.float-tile.self {
  outline: 2px solid var(--ion-color-primary, #10b981);
  outline-offset: -2px;
}
/* Active speaker: a bright ring + glow. Placed after .self so it wins when our own
   tile is the one talking. */
.float-tile.speaking {
  outline: 3px solid #34d399;
  outline-offset: -3px;
  box-shadow:
    0 0 16px rgba(52, 211, 153, 0.7),
    0 6px 20px rgba(0, 0, 0, 0.35);
}
.tile-video {
  width: 100%;
  height: 100%;
  /* contain (not cover): show each participant's WHOLE frame, never cropped. The
     letterbox area is the tile's own dark bg, so it reads as a card. */
  object-fit: contain;
  background: #111;
  display: block;
}
.tile-video.mirror {
  transform: scaleX(-1);
}
/* Camera-off (or audio-only) participant: an icon over the still-mounted (audible)
   video element. */
.tile-camoff {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
}
.tile-camoff ion-icon {
  font-size: 30px;
}
/* Avatar shown for a camera-off / audio-only participant. Sized relative to the tile
   so it scales with the floating-tile layout (small in a crowd, large in a 2-up). */
.tile-avatar {
  width: 34%;
  max-width: 96px;
  min-width: 36px;
  aspect-ratio: 1;
  border-radius: 50%;
  object-fit: cover;
}
/* A pending participant (ringing / connecting): dim the avatar a touch and float a spinner
   in the corner so the tile reads as "on the way" rather than camera-off. */
.tile-camoff.pending .tile-avatar {
  opacity: 0.85;
}
.tile-spinner {
  position: absolute;
  right: 8px;
  top: 8px;
  width: 18px;
  height: 18px;
  color: rgba(255, 255, 255, 0.85);
}
.tile-label {
  position: absolute;
  left: 8px;
  bottom: 6px;
  padding: 1px 7px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.5);
  font-size: 11px;
}
/* Per-tile "on hold" badge: this member has us on hold (spec 0005). */
.tile-onhold {
  position: absolute;
  right: 8px;
  bottom: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  font-size: 11px;
  color: #fff;
}
/* Call waiting (spec 0005): the second-incoming prompt + held-call / on-hold bars, anchored
   below the header so they don't cover the call controls. Built from the call view's palette. */
.cw-prompt,
.cw-held,
.cw-onhold {
  /* Anchored ABOVE the call controls (not the top) so they never overlap the call name +
     status header or the self-tile (spec 0005). */
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 104px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  max-width: min(92%, 460px);
  border-radius: 16px;
  background: rgba(28, 28, 30, 0.92);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  color: #fff;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
}
/* Column layout so the name/subtitle row and the action buttons each stay on one line
   (the old single-row layout wrapped the text on narrow phones). */
.cw-prompt {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 14px;
  width: min(92%, 380px);
}
.cw-prompt-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cw-avatar {
  width: 38px;
  height: 38px;
  flex: none;
}
.cw-text {
  flex: 1;
  min-width: 0;
}
.cw-text strong {
  display: block;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cw-text span {
  font-size: 12px;
  opacity: 0.8;
}
.cw-actions {
  display: flex;
  gap: 8px;
}
.cw-btn {
  flex: 1; /* the two buttons split the row evenly, each on a single line */
  border: none;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.cw-decline {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}
.cw-accept {
  background: var(--ion-color-primary, #10b981);
  color: #fff;
}
.cw-held,
.cw-onhold {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
}
/* .cw-held is a <button> (tap to swap back to the held call) — strip the native chrome and
   inherit the bar's own palette/typography. */
.cw-held {
  border: none;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.cw-held:active {
  transform: translateX(-50%) scale(0.97);
}
.cw-onhold {
  /* When BOTH a held bar and the remote-held badge could show, stack this one higher so they
     don't overlap (both are bottom-anchored). */
  bottom: calc(env(safe-area-inset-bottom, 0px) + 152px);
  background: rgba(120, 120, 128, 0.85);
}
/* On hold (spec 0005): the held peer's last frame is frozen, so blur it and dim it slightly —
   paired with the .held-overlay / .tile-onhold pause badge so it reads as paused, not broken. */
.held-frozen {
  filter: blur(16px) brightness(0.7);
}
/* Centered pause badge over the blurred 1:1 main video while the other side has us on hold. */
.held-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fff;
  pointer-events: none;
}
.held-overlay ion-icon {
  font-size: 56px;
  opacity: 0.95;
}
.held-overlay span {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
/* Resume countdown (spec 0005): a prominent, unmissable heads-up shown to the person coming off
   hold for the few seconds before their camera/mic go live again. */
.resume-countdown {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: #fff;
}
.rc-num {
  font-size: 72px;
  font-weight: 700;
  line-height: 1;
  width: 110px;
  height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.85);
}
.rc-text {
  font-size: 16px;
  font-weight: 600;
  opacity: 0.92;
}
/* A departed participant's placeholder: a waving hand that lingers, then fades out.
   Duration must match LEAVE_MS in the script. */
.float-tile.leaving {
  /* The avatar (.tile-camoff) fills the tile behind; the in-flow waving hand is centred over
     it by this flex, and the name label sits bottom-left as on a normal tile. */
  display: flex;
  align-items: center;
  justify-content: center;
  animation: tile-leave 5s ease forwards;
}
@keyframes tile-in {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
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
/* The draggable PiP is now a wrapper (position/drag) holding the <video> + flip button,
   so mirroring the video doesn't also flip the button. */
.pip-wrap {
  position: absolute;
  width: var(--pip-w);
  height: var(--pip-h);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  z-index: 3;
  cursor: grab;
  touch-action: none; /* claim the drag gesture (no page pan) */
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  transition:
    top 0.18s ease,
    left 0.18s ease,
    transform 0.18s ease;
}
.pip-video {
  width: 100%;
  height: 100%;
  /* contain so the self/other feed keeps its true aspect ratio (no zoom/crop) inside
     the PiP box, matching the main stage. */
  object-fit: contain;
  border-radius: 12px;
  background: #111;
  display: block;
}
/* Flip-camera button overlaid on a local-video box (group self tile, 1:1 main, PiP). */
.flip-btn {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  z-index: 4;
}
.flip-btn ion-icon {
  pointer-events: none;
}
.tile-flip {
  top: 6px;
  right: 6px;
  width: 30px;
  height: 30px;
  font-size: 16px;
}
/* Recall/remove control on a non-joiner's tile (any participant): centred over the avatar. */
.recall-btn {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: var(--ion-color-primary, #10b981);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  z-index: 4;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}
.recall-btn ion-icon {
  pointer-events: none;
}
.pip-flip {
  right: 4px;
  bottom: 4px;
  width: 28px;
  height: 28px;
  font-size: 15px;
}
.main-flip {
  top: max(16px, env(safe-area-inset-top));
  right: 16px;
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
/* Immersive view: tapping the video hides the header + controls so only the feeds show;
   they fade back in on the next tap. pointer-events:none lets that tap reach the stage. */
.overlay-top,
.controls {
  transition: opacity 0.25s ease;
}
.stage.chrome-hidden .overlay-top,
.stage.chrome-hidden .controls {
  opacity: 0;
  pointer-events: none;
}
.minimize-btn {
  position: absolute;
  left: 8px;
  top: -4px;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.minimize-btn ion-icon {
  font-size: 24px;
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
.queue-note {
  margin: 6px auto 0;
  max-width: 280px;
  font-size: 13px;
  line-height: 1.35;
  opacity: 0.75;
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

/* ---- full-screen incoming-call answer view ---- */
.incoming-fs {
  position: absolute;
  inset: 0;
  z-index: 30; /* above the (empty) stage, below modals */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: calc(env(safe-area-inset-top) + 8vh) 24px calc(env(safe-area-inset-bottom) + 6vh);
  background: radial-gradient(120% 120% at 50% 0%, #0e8a63 0%, #06402f 70%);
  color: #fff;
  text-align: center;
}
.incoming-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  margin-top: 6vh;
}
.incoming-avatar {
  width: 128px;
  height: 128px;
  border: 3px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
}
.incoming-name {
  margin: 6px 0 0;
  font-size: 28px;
  font-weight: 700;
}
.incoming-kind {
  margin: 0;
  font-size: 15px;
  opacity: 0.9;
}
.incoming-with {
  margin: 2px 0 0;
  font-size: 13px;
  opacity: 0.82;
  max-width: 80vw;
}
.incoming-actions {
  display: flex;
  align-items: center;
  gap: 28px;
}
.ans-btn {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 30px;
  cursor: pointer;
}
.ans-btn ion-icon {
  font-size: 30px;
}
.ans-btn.decline {
  background: var(--ion-color-danger, #eb445a);
  transform: rotate(135deg);
}
.ans-btn.message {
  width: 54px;
  height: 54px;
  font-size: 24px;
  background: rgba(255, 255, 255, 0.18);
}
.ans-btn.message ion-icon {
  font-size: 24px;
}
.ans-btn.accept {
  background: #fff;
  color: #0a7d5c;
  animation: ans-pulse 1.6s ease-in-out infinite;
}
@keyframes ans-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}
</style>
