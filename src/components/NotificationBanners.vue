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
      :class="{ replying: replyUrl === b.url, dragging: dragUrl === b.url, 'nb-danger': b.tone === 'danger' }"
      :style="cardStyle(b)"
    >
      <!-- Explicit dismiss affordance (FR-015), in addition to swipe-up / auto-dismiss.
           Stop propagation so closing never opens the chat. -->
      <button class="nb-close" aria-label="Dismiss notification" @click.stop="dismissBanner(b.id)" @pointerdown.stop>
        <ion-icon :icon="closeOutline" />
      </button>
      <!-- Header: tap anywhere here to open the full chat. An 'action' card (the update
           prompt) is not a link — it carries its own buttons — so it isn't clickable. -->
      <div
        class="nb-main"
        :class="{ 'nb-main-static': isStatic(b) }"
        :role="isStatic(b) ? undefined : 'button'"
        :tabindex="isStatic(b) ? undefined : 0"
        @click="isStatic(b) ? undefined : open(b)"
        @keydown.enter="isStatic(b) ? undefined : open(b)"
      >
        <div class="nb-avatar" :class="{ 'nb-system': (b.kind === 'system' || b.kind === 'action' || b.kind === 'status') && !b.avatar }">
          <img v-if="b.avatar" :src="b.avatar" :alt="b.name" />
          <ion-icon v-else :icon="bannerIcon(b)" />
        </div>
        <div class="nb-text">
          <!-- A status notice is a single (possibly long) line and carries no separate
               body, so let its headline wrap instead of truncating. -->
          <div class="nb-name" :class="{ 'nb-body-wrap': b.kind === 'status' }">{{ b.name }}</div>
          <!-- Body renders through EmojiText so notification emoji (a game's 😏/🏆/🤝,
               spec 0008 FR-023) play their Noto animation when they have one — same
               pipeline as chat bodies, honoring the animation preference. -->
          <div v-if="b.body || sentId === b.id" class="nb-body" :class="{ 'nb-body-wrap': b.kind === 'action' }">
            <emoji-text :text="sentId === b.id ? 'Sent' : b.body" />
          </div>
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
      <!-- Action card (update prompt): its buttons (What's new / Update / Later). -->
      <div v-else-if="b.kind === 'action' && b.actions?.length" class="nb-actions">
        <button
          v-for="(a, i) in b.actions"
          :key="i"
          class="nb-action"
          :class="{ cancel: a.role === 'cancel' }"
          @click.stop="onAction(b, a)"
        >
          {{ a.text }}
        </button>
      </div>
      <!-- A status notice is a self-contained transient line: no quick-reply, no buttons,
           and no grab handle (nothing to pull open). -->
      <span v-else-if="b.kind !== 'status'" class="nb-handle nb-handle-static" aria-hidden="true" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { IonIcon, IonTextarea } from '@ionic/vue';
import {
  personAddOutline, chatbubbleEllipsesOutline, sendOutline, checkmarkCircle, closeOutline,
  sparklesOutline, informationCircleOutline, alertCircleOutline,
} from 'ionicons/icons';
import router from '@/router';
import EmojiText from '@/components/EmojiText.vue';
import {
  notifyBanners, dismissBanner, holdBanner, pinBanner, unpinBanner,
  type NotifyBanner, type NotifyAction,
} from '@/services/notify';
import { sendMessage } from '@/db/queries';
import { appToast } from '@/services/toast';
import { normalizeOutgoing } from '@/utils/text';

const banners = notifyBanners;

// A static (non-clickable) card carries its own content rather than linking to a chat:
// the update prompt ('action') with its buttons, and transient functional notices ('status').
function isStatic(b: NotifyBanner): boolean {
  return b.kind === 'action' || b.kind === 'status';
}

// The glyph for a banner with no avatar: a system / action / status notice carries its own
// icon; a request shows the add-person icon; an action card falls back to sparkles; a status
// notice falls back to an info (or alert, when it's an error) glyph; a message falls back to
// the chat bubble.
function bannerIcon(b: NotifyBanner): string {
  if (b.icon) return b.icon;
  if (b.kind === 'request') return personAddOutline;
  if (b.kind === 'action') return sparklesOutline;
  if (b.kind === 'status') return b.tone === 'danger' ? alertCircleOutline : informationCircleOutline;
  return chatbubbleEllipsesOutline;
}

// An action card's button: run its handler, then dismiss the card. Mirrors the old
// update toast where any button closed it; dismissing fires the banner's onDismiss, which
// lets useAppUpdate re-surface the prompt next foreground if the user chose "Later".
function onAction(b: NotifyBanner, a: NotifyAction): void {
  a.handler();
  dismissBanner(b.id);
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
    await appToast({ message: "Couldn't send. Tap the banner to open the chat.", duration: 2200, color: 'danger' });
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
  /* Anchored BELOW the header (spec 1015 FR-014): offset by the toolbar height +
     the safe-area inset so the banner never covers the header title / back control.
     ~56px covers the Ionic toolbar (MD 56 / iOS 44 + chrome); a little breathing gap. */
  top: calc(env(safe-area-inset-top, 0px) + 56px);
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
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 10px 14px 6px;
  border-radius: 18px;
  color: #fff;
  /* Translucent banner in the app's greenish theme colour (spec 1015 FR-013),
     built from the existing primary token (no new colours). White text stays
     legible on the saturated green in both light and dark. */
  background: rgba(var(--ion-color-primary-rgb, 16, 185, 129), 0.9);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.28);
  animation: nb-in 0.22s ease;
  transition: transform 0.22s ease;
}
/* No transition while a finger is dragging the handle (it should track 1:1). */
.nb.dragging {
  transition: none;
}
@media (prefers-color-scheme: dark) {
  .nb {
    /* Slightly more opaque in dark mode so the green reads as a solid surface. */
    background: rgba(var(--ion-color-primary-rgb, 16, 185, 129), 0.95);
  }
}
/* Error status notices ("Couldn't send…") use the danger token instead of the green theme,
   so a failure reads as a failure while still sitting in the same banner surface/position. */
.nb.nb-danger {
  background: rgba(var(--ion-color-danger-rgb, 235, 68, 90), 0.92);
}
@media (prefers-color-scheme: dark) {
  .nb.nb-danger {
    background: rgba(var(--ion-color-danger-rgb, 235, 68, 90), 0.95);
  }
}
.nb.nb-danger .nb-avatar.nb-system {
  background: var(--ion-color-danger, #eb445a);
}
/* Explicit dismiss button (FR-015), top-trailing so it clears the avatar + text. */
.nb-close {
  position: absolute;
  top: 6px;
  inset-inline-end: 8px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 1;
}
.nb-close ion-icon {
  font-size: 15px;
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
/* An action card's header is informational (the prompt's title + body), not a link. */
.nb-main-static {
  cursor: default;
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
/* The update prompt's body is a full sentence (and a version string that must not blow up
   the layout) — let it wrap and break an unbreakable token instead of truncating. */
.nb-body-wrap {
  white-space: normal;
  overflow: visible;
  overflow-wrap: anywhere;
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
/* Action-card button row (update prompt). Buttons read on the saturated green using the
   same translucent-white treatment as the quick-reply send button, so the card stays one
   coherent surface; the cancel ("Later") option is quieter. */
.nb-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
  padding-top: 2px;
}
.nb-action {
  border: none;
  border-radius: 14px;
  padding: 7px 14px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: background 0.15s ease;
}
.nb-action:hover {
  background: rgba(255, 255, 255, 0.28);
}
.nb-action.cancel {
  background: transparent;
  font-weight: 500;
  opacity: 0.85;
}
</style>
