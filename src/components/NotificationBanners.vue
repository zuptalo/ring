<template>
  <!-- In-app notification banners (iOS/Telegram style): a neutral translucent card
       with the chat avatar + bold name + preview and a grab handle. Tap the header to
       open the chat. PULL DOWN the handle (or tap it) to expand an inline quick-reply
       composer; SWIPE the handle UP to dismiss it and discard the draft. -->
  <div class="nb-stack">
    <div
      v-for="b in banners"
      :key="b.url"
      class="nb"
      :class="{ replying: replyUrl === b.url, dragging: dragUrl === b.url }"
      :style="cardStyle(b)"
    >
      <!-- Header: tap anywhere here to open the full chat. -->
      <div class="nb-main" role="button" tabindex="0" @click="open(b)" @keydown.enter="open(b)">
        <div class="nb-avatar" :class="{ 'nb-system': b.kind === 'system' && !b.avatar }">
          <img v-if="b.avatar" :src="b.avatar" :alt="b.name" />
          <ion-icon v-else :icon="bannerIcon(b)" />
        </div>
        <div class="nb-text">
          <div class="nb-name">{{ b.name }}</div>
          <div class="nb-body">{{ sentId === b.id ? 'Sent' : b.body }}</div>
        </div>
        <ion-icon v-if="sentId === b.id" :icon="checkmarkCircle" class="nb-sent" />
      </div>

      <!-- Quick-reply for message banners. Kept MOUNTED (just collapsed) so its textarea
           exists before the pull-down gesture: that lets openReply() focus it
           SYNCHRONOUSLY inside the pointerup handler, which is the only way iOS will
           raise the keyboard. The composer mirrors the main chat composer. -->
      <template v-if="b.kind === 'message' && b.chatId">
        <div class="nb-reply" :class="{ open: replyUrl === b.url }">
          <ion-textarea
            :ref="(el) => setComposer(b.url, el)"
            class="nb-composer"
            :value="replyUrl === b.url ? draft : ''"
            placeholder="Message"
            :auto-grow="true"
            :rows="1"
            autocapitalize="sentences"
            autocorrect="on"
            :spellcheck="true"
            enterkeyhint="enter"
            @ion-input="onInput"
            @keydown.enter="onEnter"
          />
          <button
            class="nb-send"
            :class="{ ready: draft.trim() }"
            :disabled="!draft.trim()"
            aria-label="Send"
            @pointerdown.prevent
            @click="sendReply(b)"
          >
            <ion-icon :icon="sendOutline" />
          </button>
        </div>
        <!-- Grab handle + drag zone. Collapsed: pull DOWN / tap to open the quick-reply.
             Reply mode: swipe UP to dismiss and discard the draft. -->
        <div
          class="nb-grab"
          @pointerdown="onGrabDown($event, b)"
          @pointermove="onGrabMove($event, b)"
          @pointerup="onGrabUp($event, b)"
          @pointercancel="onGrabUp($event, b)"
        >
          <span class="nb-handle" aria-hidden="true" />
        </div>
      </template>
      <span v-else class="nb-handle nb-handle-static" aria-hidden="true" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { IonIcon, IonTextarea, toastController } from '@ionic/vue';
import {
  personAddOutline, chatbubbleEllipsesOutline, sendOutline, checkmarkCircle,
} from 'ionicons/icons';
import router from '@/router';
import {
  notifyBanners, dismissBanner, holdBanner, pinBanner, unpinBanner, type NotifyBanner,
} from '@/services/notify';
import { sendMessage } from '@/db/queries';
import { normalizeOutgoing } from '@/utils/text';

const banners = notifyBanners;

// The glyph for a banner with no avatar: a system notice carries its own icon; a
// request shows the add-person icon; a message falls back to the chat bubble.
function bannerIcon(b: NotifyBanner): string {
  return b.icon || (b.kind === 'request' ? personAddOutline : chatbubbleEllipsesOutline);
}

// Reply state is keyed by the banner's URL (its dedup identity), so a follow-up
// message in the same chat that REPLACES the banner keeps the quick-reply open
// (the v-for is keyed by url too, so the DOM node and its focus/draft survive).
const replyUrl = ref<string | null>(null);
const draft = ref('');
const sentId = ref<string | null>(null); // brief "Sent" confirmation, keyed by banner id

// The mounted quick-reply textareas, keyed by banner url. A Map (not one shared ref)
// so a reply SWITCH, where Vue may mount the new row's ref before unmounting the old
// one, can't clobber the live composer to null.
type Composer = { $el: HTMLIonTextareaElement };
const composers = new Map<string, Composer>();
function setComposer(url: string, el: unknown): void {
  if (el) {
    composers.set(url, el as Composer);
    // Bidi-aware like the main chat composer: dir="auto" on the native <textarea> so a
    // quick reply typed in Persian/Arabic/Hebrew flows right-to-left (Ionic doesn't forward
    // the host's dir, so set it on the inner element).
    const ta = (el as { $el?: HTMLIonTextareaElement & { getInputElement?: () => Promise<HTMLTextAreaElement> } }).$el;
    void ta?.getInputElement?.().then((native) => native?.setAttribute('dir', 'auto')).catch(() => {});
  } else {
    composers.delete(url);
  }
}

function open(b: NotifyBanner): void {
  // Tapping the header opens the chat; any in-progress quick-reply draft is discarded.
  replyUrl.value = null;
  draft.value = '';
  dismissBanner(b.id);
  void router.push(b.url);
}

function openReply(b: NotifyBanner): void {
  if (replyUrl.value === b.url) return;
  replyUrl.value = b.url; // also pins the banner (watch on replyUrl below)
  draft.value = '';
  holdBanner(b.id); // stop the auto-dismiss while composing
  // Focus SYNCHRONOUSLY, here in the pointerup gesture, on the already-mounted textarea.
  // ion-textarea.setFocus() calls the native focus() synchronously (no await before it),
  // so the iOS keyboard rises. nextTick/await would push it out of the gesture and fail.
  composers.get(b.url)?.$el?.setFocus();
}

function dismissReply(b: NotifyBanner): void {
  replyUrl.value = null;
  draft.value = ''; // discard whatever was typed
  dismissBanner(b.id);
}

async function sendReply(b: NotifyBanner): Promise<void> {
  const text = normalizeOutgoing(draft.value);
  if (!text || !b.chatId) return;
  try {
    await sendMessage(b.chatId, text);
  } catch {
    // Keep the reply open with the draft intact so it can be retried or opened fully.
    const t = await toastController.create({
      message: "Couldn't send. Tap the banner to open the chat.",
      duration: 2200,
      position: 'top',
      color: 'danger',
    });
    await t.present();
    return;
  }
  draft.value = '';
  replyUrl.value = null;
  const id = b.id; // capture: a same-chat follow-up could swap b out during the flash
  sentId.value = id; // flash "Sent" on THIS banner, then let it go
  setTimeout(() => {
    if (sentId.value === id) sentId.value = null;
    dismissBanner(id);
  }, 1000);
}

/* ---- composer behaviour (mirrors the main chat composer) ---- */
function onInput(e: CustomEvent): void {
  draft.value = (e.detail as { value?: string | null }).value ?? '';
  // Keep the newest line visible as the box grows (same fix as the chat composer).
  const host = replyUrl.value ? composers.get(replyUrl.value)?.$el : null;
  if (host) requestAnimationFrame(() => { host.scrollTop = host.scrollHeight; });
}
// Match the chat: Return inserts a newline; block it while empty so a message can't
// start blank. Send is the button (or Enter on a hardware keyboard once non-empty).
function onEnter(e: KeyboardEvent): void {
  if (!draft.value.trim()) e.preventDefault();
}

/* ---- pull-down (open) / swipe-up (dismiss) drag on the grab handle ---- */
const OPEN_THRESHOLD = 24; // px pulled down to commit to opening the quick-reply
const DISMISS_THRESHOLD = 36; // px swiped up to dismiss it
const dragUrl = ref<string | null>(null);
const dragDy = ref(0);
let startY = 0;
let moved = false;

function cardStyle(b: NotifyBanner): Record<string, string> {
  return dragUrl.value === b.url ? { transform: `translateY(${dragDy.value}px)` } : {};
}

function onGrabDown(e: PointerEvent, b: NotifyBanner): void {
  dragUrl.value = b.url;
  startY = e.clientY;
  dragDy.value = 0;
  moved = false;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}
function onGrabMove(e: PointerEvent, b: NotifyBanner): void {
  if (dragUrl.value !== b.url) return;
  const dy = e.clientY - startY;
  if (Math.abs(dy) > 3) moved = true;
  // Collapsed pulls DOWN only; reply mode swipes UP only. Clamp for a rubber-band feel.
  dragDy.value =
    replyUrl.value === b.url ? Math.max(-110, Math.min(0, dy)) : Math.max(0, Math.min(70, dy));
}
function onGrabUp(e: PointerEvent, b: NotifyBanner): void {
  if (dragUrl.value !== b.url) return;
  const dy = e.clientY - startY;
  const wasReplying = replyUrl.value === b.url;
  dragUrl.value = null; // release: the inline transform clears and CSS settles it back
  dragDy.value = 0;
  if (wasReplying) {
    if (dy < -DISMISS_THRESHOLD) dismissReply(b);
  } else if (dy > OPEN_THRESHOLD || !moved) {
    // A deliberate pull down, OR a simple tap on the grab handle, opens the reply.
    openReply(b);
  }
}

// Pin the banner being replied to so the MAX_BANNERS cap can't evict it (and lose the
// draft), and unpin the previous one whenever the reply closes or switches.
watch(replyUrl, (next, prev) => {
  if (prev && prev !== next) unpinBanner(prev);
  if (next) pinBanner(next);
});

// If the banner being replied to is replaced by a newer message in the same chat,
// re-hold the new banner id (so its fresh auto-dismiss timer can't yank the reply
// away). If it disappears entirely, close the reply but KEEP the draft so a re-shown
// same-chat banner can resume it.
watch(
  banners,
  () => {
    if (!replyUrl.value) return;
    const b = banners.value.find((x) => x.url === replyUrl.value);
    if (b) holdBanner(b.id);
    else replyUrl.value = null; // unpins via the replyUrl watch; draft is preserved
  },
  { deep: true },
);
</script>

<style scoped>
.nb-stack {
  position: fixed;
  top: max(8px, env(safe-area-inset-top));
  left: 0;
  right: 0;
  /* Below the incoming-call overlay (20000), above ordinary content + tabs. */
  z-index: 19000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px;
  pointer-events: none; /* only the cards catch taps, not the gaps */
}
.nb {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 10px 14px 6px;
  border-radius: 18px;
  color: #fff;
  /* Neutral translucent slate (light theme); a darker charcoal in dark theme below.
     Self-contained + white text so it stays legible over any background. */
  background: rgba(58, 60, 66, 0.92);
  backdrop-filter: blur(18px) saturate(180%);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.32);
  animation: nb-in 0.22s ease;
  transition: transform 0.22s ease;
}
/* No transition while a finger is dragging the handle (it should track 1:1). */
.nb.dragging {
  transition: none;
}
@media (prefers-color-scheme: dark) {
  .nb {
    background: rgba(44, 44, 48, 0.82);
  }
}
@keyframes nb-in {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.nb-main {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
.nb-avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.16);
}
.nb-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.nb-avatar ion-icon {
  font-size: 20px;
  color: #fff;
}
/* System notices get a tinted circle so they read as an app event, not a person. */
.nb-avatar.nb-system {
  background: var(--ion-color-primary, #10b981);
}
.nb-text {
  flex: 1;
  min-width: 0;
}
.nb-name {
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  unicode-bidi: plaintext;
  text-align: start;
}
.nb-body {
  font-size: 14px;
  opacity: 0.88;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  unicode-bidi: plaintext;
  text-align: start;
}
.nb-sent {
  flex: none;
  font-size: 22px;
  color: #2dd36f;
}
/* Quick-reply composer row. Always mounted but collapsed (height 0, NOT display:none,
   so its textarea stays focusable for the synchronous gesture focus); .open expands it. */
.nb-reply {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  transition: max-height 0.22s ease, opacity 0.18s ease, padding-top 0.22s ease;
}
.nb-reply.open {
  max-height: 160px;
  opacity: 1;
  pointer-events: auto;
  padding-top: 4px;
}
.nb-composer {
  flex: 1;
  min-width: 0;
  margin: 0;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 15px;
  max-height: 132px;
  --background: transparent;
  --color: #fff;
  --placeholder-color: rgba(255, 255, 255, 0.6);
  --placeholder-opacity: 1;
  --padding-start: 12px;
  --padding-end: 12px;
  --padding-top: 8px;
  --padding-bottom: 8px;
}
.nb-send {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}
.nb-send.ready {
  background: var(--ion-color-primary, #3880ff);
}
.nb-send:disabled {
  opacity: 0.5;
  cursor: default;
}
.nb-send ion-icon {
  font-size: 19px;
}
/* The grab handle's drag zone gets a generous hit area; it owns the vertical drag so
   the page underneath doesn't scroll while pulling the banner open/closed. */
.nb-grab {
  padding: 6px 0 2px;
  margin-top: 2px;
  cursor: grab;
  touch-action: none;
}
.nb-handle {
  display: block;
  width: 36px;
  height: 4px;
  border-radius: 2px;
  margin: 0 auto;
  background: rgba(255, 255, 255, 0.4);
}
.nb-handle-static {
  margin-top: 4px;
}
</style>
