<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>Wall</ion-title>
        <ion-buttons slot="end">
          <ion-button :aria-label="muted ? 'Wall notifications muted' : 'Mute Wall notifications'" @click="openMuteMenu">
            <ion-icon slot="icon-only" :icon="muted ? notificationsOffOutline : notificationsOutline" />
          </ion-button>
          <ion-button aria-label="New post" @click="compose">
            <ion-icon slot="icon-only" :icon="createOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="search"
          placeholder="Search posts, comments, people"
          :debounce="150"
          @ion-input="onSearch"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <!-- Pull down to re-pull the feed from the server (the same cursor-based syncPosts behind
           the loader). The natural gesture for a feed; the only other way to re-pull is to
           leave and re-open the tab. -->
      <ion-refresher slot="fixed" @ion-refresh="onPullRefresh">
        <ion-refresher-content pulling-text="Pull to check for new posts" refreshing-text="Checking for new posts…" />
      </ion-refresher>
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Wall</ion-title>
        </ion-toolbar>
      </ion-header>

      <!-- Fresh device, nothing local yet AND the first server sync hasn't returned → show a
           loader instead of the "No posts yet" empty state (which would flash misleadingly).
           A pending (uploading) post counts as content, so the empty/loader states yield to it. -->
      <div v-if="loaded && !wall.length && !synced && !pending.length" class="empty">
        <ion-spinner name="crescent" />
        <p>Loading your Wall…</p>
      </div>
      <div v-else-if="loaded && !wall.length && synced && !pending.length" class="empty">
        <ion-icon :icon="sparklesOutline" />
        <p>No posts yet. Share a moment with your friends.</p>
        <ion-button fill="solid" @click="compose">New post</ion-button>
      </div>

      <div v-if="loaded && wall.length && !filteredWall.length && !pending.length" class="empty">
        <p>No posts match “{{ search }}”.</p>
      </div>

      <!-- Spec 1024: posts still uploading. The composer dismissed immediately; the worker
           finishes them in the background and each becomes a real post on confirmation.
           An 'interrupted' post is a draft recovered after the app was closed mid-upload:
           caption + voice notes were kept; the user re-adds media and finishes it. -->
      <ion-item v-for="pp in pending" :key="pp.id" lines="none" class="postitem">
        <div class="post pending-post">
          <div class="phead">
            <ion-avatar class="avatar"><div class="ph">{{ initial('You') }}</div></ion-avatar>
            <div class="who">
              <div class="name">You</div>
              <div class="sub">
                {{ pp.status === 'failed' ? 'Couldn’t post' : pp.status === 'interrupted' ? 'Post didn’t finish' : 'Posting…' }}
              </div>
            </div>
            <ion-spinner v-if="pp.status === 'uploading'" name="crescent" class="pspin" />
          </div>
          <p v-if="pp.body" class="body"><EmojiText :text="pp.body" /></p>
          <ion-progress-bar v-if="pp.status === 'uploading'" :value="pp.progress" class="pbar" />
          <p class="pending-note">
            <template v-if="pp.status === 'interrupted'">
              The app closed before this finished. Everything you added is saved. Tap Finish to post it.
            </template>
            <template v-else>
              {{ pp.count ? pp.count + (pp.count > 1 ? ' items' : ' item') : 'Text post' }} ·
              {{ pp.status === 'failed' ? (pp.error || 'Failed') : Math.round(pp.progress * 100) + '%' }}
            </template>
          </p>
          <!-- A failed upload keeps its cached blobs: the user can retry it or discard it. -->
          <div v-if="pp.status === 'failed'" class="pending-actions">
            <ion-button size="small" fill="solid" @click="retryPendingPost(pp.id)">Retry</ion-button>
            <ion-button size="small" fill="clear" color="medium" @click="cancelPendingPost(pp.id)">Cancel</ion-button>
          </div>
          <!-- A recovered draft: reopen the composer (caption + voice restored) or discard it. -->
          <div v-else-if="pp.status === 'interrupted'" class="pending-actions">
            <ion-button size="small" fill="solid" @click="finishPendingPost(pp.id)">Finish</ion-button>
            <ion-button size="small" fill="clear" color="medium" @click="cancelPendingPost(pp.id)">Discard</ion-button>
          </div>
        </div>
      </ion-item>

      <!-- Each post is a sliding item: swipe LEFT to delete your own post (or hide
           someone else's), swipe RIGHT to mute/unmute their Wall notifications. -->
      <ion-item v-for="p in filteredWall" :key="p.id" lines="none" class="postitem">
          <div class="post" :class="{ own: p.isOwn }">
            <!-- Header: avatar + name + a subtle "disappears in …" countdown. -->
            <div class="phead">
              <ion-avatar class="avatar">
                <user-avatar v-if="p.authorAvatar" :src="p.authorAvatar" :alt="p.authorName" />
                <div v-else class="ph">{{ initial(p.authorName) }}</div>
              </ion-avatar>
              <div class="who">
                <div class="name">
                  {{ p.authorName }}<span v-if="p.authorUsername" class="user"> @{{ p.authorUsername }}</span>
                </div>
                <div class="sub">
                  {{ ago(p.createdAt, now) }}<span v-if="p.audience === 'close'"> · Close friends</span><span v-if="p.muted"> · Muted</span>
                </div>
              </div>
              <span v-if="left(p)" class="countdown" :title="'This post auto-deletes'">
                <ion-icon :icon="timeOutline" />{{ left(p) }}
              </span>
              <!-- Post actions moved off the swipe (which fought the album swipe) into this
                   menu: own posts → keep-for-longer / delete; others' → mute / hide. -->
              <button type="button" class="postmenu" aria-label="Post actions" @click="openPostMenu(p)">
                <ion-icon :icon="ellipsisHorizontal" />
              </button>
            </div>

            <!-- Album (FR-019): swipe through every photo/video right here in the feed —
                 no need to open the post. A live "n / N" counter tracks the slide. -->
            <div
              v-if="p.album && p.album.length > 1"
              class="thumb album-feed"
              :style="albumFrameStyle(p)"
            >
              <div class="album-track" @scroll="onAlbumScroll(p.id, $event)">
                <!-- Mixed aspect ratios: one stable frame; each item shown WHOLE (contain),
                     with its own blurred copy filling the letterbox so nothing is cropped and
                     the height never jumps as you swipe portrait → square → landscape. -->
                <div v-for="(m, i) in p.album" :key="i" class="album-slide">
                  <!-- Blurred backdrop is ALWAYS an image (a video's poster) — never a second
                       <video> — so the letterbox fill costs nothing to decode. Voice has none. -->
                  <img v-if="(m.kind === 'image' && m.url) || (m.kind === 'video' && m.poster)" class="aslide-fill" :src="m.kind === 'video' ? m.poster : m.url" alt="" aria-hidden="true" />
                  <!-- Image: tap or the ⤢ button opens a minimal full-screen image (rotatable,
                       pinch-zoom) — no thumbnail strip. A shimmer shows while the blob downloads. -->
                  <template v-if="m.kind === 'image'">
                    <img v-if="m.url" class="aslide-main" :src="m.url" alt="" @click="openImageFullscreen(p, m.url)" />
                    <div v-else class="aslide-main aslide-skel" aria-label="Loading photo"></div>
                    <button v-if="m.url" type="button" class="vid-fs" aria-label="Full screen" @click.stop="openImageFullscreen(p, m.url)">
                      <ion-icon :icon="expandOutline" />
                    </button>
                  </template>
                  <!-- Voice: a centered waveform player (the chat's), no autoplay. -->
                  <template v-else-if="m.kind === 'voice'">
                    <div class="aslide-voice">
                      <voice-player
                        v-if="m.url"
                        :mid="`${p.id}:${i}`"
                        :sender="p.isOwn ? 'You' : p.authorName"
                        :src="m.url"
                        :outgoing="!!p.isOwn"
                        :avatar="p.authorAvatar"
                        :float-when-away="true"
                      />
                      <div v-else class="voice-loading"><ion-icon :icon="micOutline" /><ion-spinner name="crescent" /></div>
                    </div>
                  </template>
                  <!-- Video: only the in-view slide mounts the inline player (autoplay + a bottom
                       bar: play/pause · mute · time + scrubber · native fullscreen). -->
                  <template v-else>
                    <wall-video v-if="(albumIndex[p.id] ?? 0) === i" class="aslide-main" :src="m.url" :poster="m.poster" />
                    <template v-else>
                      <img class="aslide-main" :src="m.poster" alt="" />
                      <ion-icon class="aslide-play" :icon="playCircleOutline" aria-hidden="true" />
                    </template>
                  </template>
                </div>
              </div>
              <div class="album-count">{{ (albumIndex[p.id] ?? 0) + 1 }} / {{ p.album.length }}</div>
            </div>

            <!-- Single media. The image/video box reserves the media's aspect ratio with a
                 skeleton so the feed doesn't jump as it decodes. -->
            <div
              v-else-if="p.kind === 'image' || p.kind === 'video'"
              class="thumb"
              :class="{ loading: p.kind === 'image' && !mediaLoaded[p.id] }"
              :style="mediaStyle(p)"
            >
              <!-- Image: poster shows instantly; tap or ⤢ opens the minimal full-screen image. -->
              <template v-if="p.kind === 'image' && (p.posterUrl || p.mediaUrl)">
                <img
                  :src="p.posterUrl || p.mediaUrl"
                  :alt="p.body || 'Photo'"
                  @load="onMediaLoad(p.id)"
                  @click="openImageFullscreen(p, p.mediaUrl || p.posterUrl)"
                />
                <button type="button" class="vid-fs" aria-label="Full screen" @click.stop="openImageFullscreen(p, p.mediaUrl || p.posterUrl)">
                  <ion-icon :icon="expandOutline" />
                </button>
              </template>
              <!-- Video: inline player (autoplay + bottom bar with scrubber + native fullscreen). -->
              <wall-video
                v-else-if="p.kind === 'video' && (p.mediaUrl || p.posterUrl)"
                :src="p.mediaUrl"
                :poster="p.posterUrl"
              />
            </div>
            <!-- Voice: the chat's waveform player (single-source global playback + seek), not a
                 bare <audio> (which errors on a blob URL on iOS). Shows a loader until the clip's
                 blob has streamed in. -->
            <div v-else-if="p.kind === 'voice'" class="voice">
              <voice-player
                v-if="p.mediaUrl"
                :mid="p.id"
                :sender="p.isOwn ? 'You' : p.authorName"
                :src="p.mediaUrl"
                :outgoing="!!p.isOwn"
                :avatar="p.authorAvatar"
                :float-when-away="true"
              />
              <div v-else class="voice-loading">
                <ion-icon :icon="micOutline" />
                <ion-spinner name="crescent" />
              </div>
            </div>
            <!-- A game-challenge post (spec 0009): the post IS the board; the card
                 derives everything live. The author's own MESSAGE still shows
                 above it — but the auto placeholder body (for pre-0009 clients)
                 is suppressed here since the live card supersedes it. -->
            <template v-if="p.game">
              <p v-if="p.body && p.body !== challengeFallbackBody(p.game.gameType)" class="body"><EmojiText :text="p.body" /></p>
              <wall-game-card :post-id="p.id" :author-name="p.authorName" :is-own="!!p.isOwn" />
            </template>
            <p v-else-if="p.body" class="body"><EmojiText :text="p.body" /></p>

            <!-- Reactions: pills + a quick-react button opening the shared picker. -->
            <div class="rrow">
              <button
                v-for="r in p.reactions"
                :key="r.emoji"
                class="rpill"
                :class="{ mine: r.mine }"
                @click="onReact(p, r.emoji)"
              >
                <Emoji :emoji="r.emoji" /><span class="rc">{{ r.count }}</span>
              </button>
              <button class="raddbtn" aria-label="React" @click="openPicker(p, $event)">
                <ion-icon :icon="happyOutline" />
              </button>
            </div>

            <!-- Comments, expandable inline: the latest one by default, "View all" expands the
                 whole thread right here in the feed (no diving into the post). -->
            <div v-if="p.commentCount" class="cpreview">
              <a v-if="p.commentCount > 1 && !expanded[p.id]" class="more" @click="expanded[p.id] = true">
                View all {{ p.commentCount }} comments
              </a>
              <div
                v-for="cm in expanded[p.id] ? p.comments : p.comments.slice(-1)"
                :key="cm.id"
                class="crow"
              >
                <ion-avatar class="cmini">
                  <user-avatar v-if="cm.authorAvatar" :src="cm.authorAvatar" :alt="cm.authorName" />
                  <div v-else class="ph">{{ initial(cm.authorName) }}</div>
                </ion-avatar>
                <span class="cname">{{ cm.authorName }}</span>
                <EmojiText :text="cm.text" />
              </div>
              <a v-if="p.commentCount > 1 && expanded[p.id]" class="more" @click="expanded[p.id] = false">
                Show less
              </a>
            </div>

            <!-- Quick comment from the feed. -->
            <div class="cinput">
              <ion-textarea
                v-enter-send="() => sendComment(p)"
                class="cfield"
                :auto-grow="true"
                :rows="1"
                placeholder="Add a comment…"
                autocapitalize="sentences"
                :spellcheck="true"
                dir="auto"
                :value="draft[p.id] || ''"
                @ion-input="onDraft(p.id, $event)"
              />
              <ion-button size="small" fill="clear" :disabled="!(draft[p.id] || '').trim()" @click="sendComment(p)">
                Post
              </ion-button>
            </div>
          </div>
      </ion-item>
    </ion-content>

    <!-- Tap any post photo/video → full-screen viewer: pinch-zoom, pan, swipe between an
         album's items. Minimal mode hides the chat-only actions (reply/forward/delete/…). -->
    <media-viewer
      :open="viewer.open"
      :items="viewer.items"
      :start="viewer.start"
      minimal
      @close="viewer.open = false"
      @dismiss="viewer.open = false"
    />
  </ion-page>
</template>

<script setup lang="ts">
import UserAvatar from '@/components/UserAvatar.vue';
import { computed, reactive, ref, watch } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonItem, IonAvatar, IonIcon, IonTextarea, IonSearchbar, IonSpinner, IonProgressBar,
  IonRefresher, IonRefresherContent,
  actionSheetController, alertController,
  onIonViewWillEnter, onIonViewWillLeave,
  type RefresherCustomEvent,
} from '@ionic/vue';
import { useRouter } from 'vue-router';
import {
  createOutline, sparklesOutline, micOutline, playCircleOutline, happyOutline, timeOutline,
  notificationsOutline, notificationsOffOutline, copyOutline,
  ellipsisHorizontal, expandOutline,
} from 'ionicons/icons';
import { appToast } from '@/services/toast';
import Emoji from '@/components/Emoji.vue';
import EmojiText from '@/components/EmojiText.vue';
import MediaViewer, { type ViewerItem } from '@/components/MediaViewer.vue';
import { vEnterSend } from '@/directives/enter-send';
import { suspendAutoplay } from '@/directives/autoplay-visible';
import WallVideo from '@/components/WallVideo.vue';
import VoicePlayer from '@/components/VoicePlayer.vue';
import WallGameCard from '@/components/WallGameCard.vue';
import { useWall, type WallPost } from '@/composables/useWall';
import { usePendingPosts } from '@/composables/usePendingPosts';
import { retryPendingPost, cancelPendingPost } from '@/services/pending-posts';
import { useReactionPicker } from '@/composables/useReactionPicker';
import {
  reactToPost, commentOnPost, deletePost, keepAlivePost, setPostAudience,
  listFriends, listCloseFriends, syncPosts,
  MAX_REACTIONS_PER_USER, MAX_DISTINCT_REACTIONS,
  markWallSeen, setWallMuteUntil, isWallTempMuted, setWallUserMuted, setWallUserHidden,
  challengeFallbackBody,
} from '@/db/queries';
import { timeLeft, ago } from '@/utils/post-time';

const router = useRouter();
const { wall, now, loaded, synced } = useWall();
const { pending } = usePendingPosts();

// Pull-to-refresh: re-pull the feed (new posts stream in via the live query) and release the
// control when the sync settles.
async function onPullRefresh(e: RefresherCustomEvent): Promise<void> {
  try {
    await syncPosts();
  } finally {
    void e.detail.complete();
  }
}
const { openQuick } = useReactionPicker();
const draft = reactive<Record<string, string>>({});
// Inline-feed state: which album slide is showing (for the "n / N" counter), and which
// posts have their full comment thread expanded.
const albumIndex = reactive<Record<string, number>>({});
const expanded = reactive<Record<string, boolean>>({});
function onAlbumScroll(postId: string, e: Event): void {
  const el = e.target as HTMLElement;
  albumIndex[postId] = el.clientWidth ? Math.round(el.scrollLeft / el.clientWidth) : 0;
}

// Minimal full-screen IMAGE overlay (videos use native OS fullscreen via WallVideo). Reuses the
// chat MediaViewer in minimal mode with a SINGLE image → no thumbnail strip, no actions, just
// the photo with pinch-zoom; the PWA rotates freely so the phone can be turned landscape.
const viewer = reactive<{ open: boolean; items: ViewerItem[]; start: number }>({
  open: false,
  items: [],
  start: 0,
});
function openImageFullscreen(p: WallPost, url?: string): void {
  if (!url) return;
  viewer.items = [
    {
      id: `${p.id}:img`,
      url,
      thumb: url,
      kind: 'image',
      caption: p.body ?? '',
      senderName: p.isOwn ? 'You' : p.authorName,
      when: ago(p.createdAt, now.value),
      outgoing: p.isOwn,
      favorite: false,
      reactions: [],
    },
  ];
  viewer.start = 0;
  viewer.open = true;
}
// Pause the feed's inline autoplay while the full-screen overlay is up (it sits over the feed,
// which would otherwise keep a clip playing — with sound — behind it), and resume on close.
watch(
  () => viewer.open,
  (open) => suspendAutoplay(open),
);

// Reserve the media's aspect ratio (fallback 4:3) so the card height is fixed before
// the image/video decodes; track which have loaded to drop the skeleton shimmer.
const mediaLoaded = reactive<Record<string, boolean>>({});
function onMediaLoad(id: string): void {
  mediaLoaded[id] = true;
}
function mediaStyle(p: WallPost): Record<string, string> {
  return { aspectRatio: p.mediaW && p.mediaH ? `${p.mediaW} / ${p.mediaH}` : '4 / 3' };
}
// One stable, slightly-vertical 4:5 frame for a whole mixed-aspect album (Instagram-style):
// portraits — the common case — nearly fill it, while squares/landscapes sit contained with
// the blurred fill. Every slide is letterboxed into this frame, so the album height is constant
// regardless of the mix. (`p` kept for a possible future per-post override.)
function albumFrameStyle(_p: WallPost): Record<string, string> {
  return { aspectRatio: '4 / 5' };
}

// Search across a post's body, its comments, and the author's name/username.
const search = ref('');
function onSearch(e: CustomEvent): void {
  search.value = (e.detail as { value?: string | null }).value ?? '';
}
const filteredWall = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return wall.value;
  return wall.value.filter((p) => {
    const hay = [
      p.body ?? '',
      p.authorName,
      p.authorUsername ?? '',
      ...p.comments.map((c) => `${c.text} ${c.authorName}`),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
});

function compose(): void {
  void router.push('/wall/compose');
}
// Reopen the composer on a recovered draft: its caption + voice notes are restored from the outbox
// record; the user re-adds any photos/videos and shares. The record is cleared once it's re-sent.
function finishPendingPost(id: string): void {
  void router.push({ path: '/wall/compose', query: { resume: id } });
}
function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
const left = (p: WallPost): string => timeLeft(p.expiresAt, now.value);

async function onReact(post: WallPost, emoji: string): Promise<void> {
  const res = await reactToPost(post.id, emoji);
  if (res === 'limit' || res === 'limit-emojis') {
    await appToast({
      message:
        res === 'limit-emojis'
          ? `This post already has ${MAX_DISTINCT_REACTIONS} different reactions. Tap one of those instead.`
          : `You can add up to ${MAX_REACTIONS_PER_USER} reactions.`,
      duration: 1600,
    });
  }
}
function openPicker(post: WallPost, ev: Event): void {
  const existing = post.reactions.map((r) => r.emoji);
  void openQuick(ev, {
    myEmojis: post.myEmojis,
    existing,
    atEmojiCap: existing.length >= MAX_DISTINCT_REACTIONS,
    onPick: (e) => onReact(post, e),
  });
}

function onDraft(id: string, e: CustomEvent): void {
  draft[id] = (e.detail as { value?: string | null }).value ?? '';
}
async function sendComment(post: WallPost): Promise<void> {
  const t = (draft[post.id] || '').trim();
  if (!t) return;
  draft[post.id] = '';
  await commentOnPost(post.id, t);
}

// --- seen-tracking: clear the badge while the Wall is open (and as posts arrive) ---
let active = false;
const muted = ref(false);
onIonViewWillEnter(async () => {
  active = true;
  await markWallSeen();
  muted.value = await isWallTempMuted();
});
onIonViewWillLeave(() => {
  active = false;
});
watch(
  () => wall.value.length,
  () => {
    if (active) void markWallSeen();
  },
);

// --- temporary mute of all Wall notifications ---
function tomorrow9am(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}
async function openMuteMenu(): Promise<void> {
  const buttons = [
    { text: 'Mute for 1 hour', handler: () => void mute(Date.now() + 60 * 60_000) },
    { text: 'Mute for 24 hours', handler: () => void mute(Date.now() + 24 * 60 * 60_000) },
    { text: 'Mute until 9 AM tomorrow', handler: () => void mute(tomorrow9am()) },
    { text: 'Mute until I turn it back on', handler: () => void mute(Number.MAX_SAFE_INTEGER) },
  ];
  if (muted.value) buttons.unshift({ text: 'Turn notifications back on', handler: () => void mute(0) });
  const sheet = await actionSheetController.create({
    header: 'Wall notifications',
    buttons: [
      ...buttons,
      { text: 'Hidden & muted people', handler: () => void router.push('/wall/muted') },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}
async function mute(until: number): Promise<void> {
  await setWallMuteUntil(until);
  muted.value = await isWallTempMuted();
}

// Post actions menu (the "…" button), replacing the swipe gestures so a multi-item post's
// horizontal album swipe is unobstructed. Own posts: keep-for-longer / delete. Others': mute / hide.
async function openPostMenu(post: WallPost): Promise<void> {
  const buttons = post.isOwn
    ? [
        post.audience === 'close'
          ? { text: 'Change to All friends', handler: () => void changeAudience(post, 'friends') }
          : { text: 'Change to Close friends only', handler: () => void changeAudience(post, 'close') },
        { text: 'Keep for longer', handler: () => void extendPost(post) },
        { text: 'Delete post', role: 'destructive' as const, handler: () => void confirmDeletePost(post) },
      ]
    : [
        // These are per-PERSON, not per-post (the header shows whose). Spell that out so
        // "Hide this post" / "Mute notifications" don't read as affecting just this one.
        {
          text: post.muted ? 'Unmute their wall notifications' : 'Mute their wall notifications',
          handler: () => void toggleMute(post),
        },
        { text: 'Hide all their posts', handler: () => void hideUser(post) },
      ];
  // A game post's story in numbers (spec 0009) lives on the post page — the
  // menu is the discoverable way in from the feed.
  const gameStats = post.game
    ? [{ text: 'Game stats', handler: () => void router.push(`/wall/post/${post.id}`) }]
    : [];
  const sheet = await actionSheetController.create({
    header: post.isOwn ? 'Your post' : post.authorName,
    buttons: [...gameStats, ...buttons, { text: 'Cancel', role: 'cancel' as const }],
  });
  await sheet.present();
}

// Change a post's visibility after the fact. Broadening adds the rest of your friends
// (silently — they aren't notified); narrowing revokes the non-close friends' copies.
// Confirm first, spelling out exactly who it reaches with live counts.
async function changeAudience(post: WallPost, audience: 'friends' | 'close'): Promise<void> {
  const [friends, close] = await Promise.all([listFriends(), listCloseFriends()]);
  const n = audience === 'friends' ? friends.length : close.length;
  const noun = n === 1 ? 'friend' : 'friends';
  const message =
    audience === 'friends'
      ? `This will be visible to all your ${n} ${noun}.`
      : `It will now only be visible to your ${n} close ${noun}.`;
  const alert = await alertController.create({
    header: 'Change who can see this',
    message,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: audience === 'friends' ? 'All friends' : 'Close friends',
        handler: () => {
          void (async () => {
            try {
              await setPostAudience(post.id, audience);
              await appToast({
                message: audience === 'friends' ? 'Now visible to all friends.' : 'Now visible to close friends only.',
                duration: 1400,
              });
            } catch {
              await appToast({ message: 'Couldn’t change who can see this. Try again.', duration: 1800 });
            }
          })();
        },
      },
    ],
  });
  await alert.present();
}

// Push the auto-delete back to a full window from now (server keep-alive + local bump).
async function extendPost(post: WallPost): Promise<void> {
  try {
    await keepAlivePost(post.id);
    await appToast({ message: 'Post kept for longer.', duration: 1400 });
  } catch {
    await appToast({ message: 'Couldn’t extend that post. Try again.', duration: 1800 });
  }
}

// --- per-user mute / hide ---
async function toggleMute(post: WallPost): Promise<void> {
  await setWallUserMuted(post.author, !post.muted);
  await appToast({
    message: post.muted ? `Unmuted ${post.authorName}` : `Muted ${post.authorName}'s Wall notifications`,
    duration: 1400,
  });
}
async function hideUser(post: WallPost): Promise<void> {
  await setWallUserHidden(post.author, true);
  await appToast({
    message: `Hid ${post.authorName}'s posts. Undo from the bell menu.`,
    duration: 1800,
  });
}

// --- delete your own post (swipe-left, with confirmation) ---
async function confirmDeletePost(post: WallPost): Promise<void> {
  const a = await alertController.create({
    header: 'Delete post',
    message:
      'This removes the post for you and signals your audience to remove their copies. ' +
      'Copies already downloaded can’t be guaranteed to disappear.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Delete', role: 'destructive', handler: () => void deletePost(post.id) },
    ],
  });
  await a.present();
}
</script>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 56px 24px;
  color: var(--app-text-muted, var(--ion-color-medium));
  text-align: center;
}
.empty ion-icon {
  font-size: 44px;
  color: var(--ion-color-primary);
}
/* The sliding wrapper hosts a card-styled div in a transparent, padding-free item. */
.postitem {
  --background: transparent;
  --padding-start: 12px;
  --inner-padding-end: 12px;
  --border-width: 0;
  --min-height: 0;
}
.post {
  width: 100%;
  margin: 8px 0;
  border-radius: 16px;
  overflow: hidden;
  /* Every post uses the SAME green card colour (the chat "outgoing" bubble) — own and others'
     alike — so the feed reads as one consistent surface. Opaque, like the bubbles, so the
     background pattern doesn't bleed through. */
  background: var(--app-bubble-out);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}
/* Swipe actions are shaped like the card they sit under: same 8px vertical inset and
   16px corners, so as the card slides they're revealed from behind its edge as a
   rounded pill rather than a full-height square button flush to the screen edge.
   (The options are siblings of .postitem inside ion-item-sliding, not descendants.) */
ion-item-sliding ion-item-option {
  margin: 8px 6px;
  border-radius: 16px;
  --border-radius: 16px;
  overflow: hidden;
  font-weight: 600;
  min-width: 76px;
}
.phead {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 8px;
}
/* Spec 1024: pending post card (uploading / failed / interrupted). A warm amber wash + a warning
   accent down the left edge so an unfinished post is obviously NOT final, set apart from the
   settled green posts. Flips to a normal green post once it confirms. */
.pending-post {
  padding-bottom: 10px;
  background: var(--app-bubble-pending, #ffe6ad);
  box-shadow: inset 4px 0 0 var(--ion-color-warning, #ffc409), 0 1px 4px rgba(0, 0, 0, 0.1);
}
.pspin {
  margin-left: auto;
  width: 18px;
  height: 18px;
  color: var(--ion-color-primary);
}
.pbar {
  margin: 6px 14px 4px;
  border-radius: 3px;
  --progress-background: var(--ion-color-primary);
}
.pending-note {
  font-size: 12px;
  color: var(--app-text-muted, #8e8e93);
  margin: 2px 14px 0;
}
.pending-actions {
  display: flex;
  gap: 4px;
  margin: 4px 8px 0;
}
.pending-actions ion-button {
  --padding-start: 12px;
  --padding-end: 12px;
  margin: 0;
}
.avatar {
  width: 40px;
  height: 40px;
  cursor: pointer;
}
.avatar .ph {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--ion-color-step-150, rgba(120, 120, 128, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}
.who {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.who .name {
  font-weight: 600;
}
.who .user {
  color: var(--ion-color-medium);
  font-weight: 400;
  font-size: 14px;
}
.who .sub {
  color: var(--ion-color-medium);
  font-size: 12px;
}
.countdown {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  font-size: 11px;
  color: var(--ion-color-medium);
  background: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
  padding: 3px 8px;
  border-radius: 999px;
}
/* The "…" post-actions button, top-right of the header next to the countdown. */
.postmenu {
  flex: none;
  width: 30px;
  height: 30px;
  margin-left: 2px;
  border: none;
  border-radius: 50%;
  padding: 0;
  background: transparent;
  color: var(--app-text-muted, var(--ion-color-medium));
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.thumb {
  position: relative;
  cursor: pointer;
  width: 100%;
  max-height: 60vh;
  overflow: hidden;
  background: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
}
/* Inline album gallery: a horizontal scroll-snap row inside the aspect-ratio box, so you
   can swipe every photo/video right in the feed. */
.album-feed {
  cursor: default;
}
.album-track {
  display: flex;
  width: 100%;
  height: 100%;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.album-track::-webkit-scrollbar {
  display: none;
}
.album-slide {
  position: relative;
  flex: 0 0 100%;
  height: 100%;
  scroll-snap-align: center;
  overflow: hidden;
  background: #000;
}
/* A blurred, zoomed copy of the slide fills the letterbox, so a portrait/square/landscape
   item in the shared frame reads as intentional rather than bars. */
.aslide-fill {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.15); /* hide the blur's soft edge */
  filter: blur(22px) brightness(0.85) saturate(1.1);
}
/* The item itself, shown WHOLE — never cropped. */
.aslide-main {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
/* Shimmer for an album photo whose blob is still streaming in (the post is already visible). */
.aslide-skel {
  background: linear-gradient(
    100deg,
    rgba(128, 128, 128, 0.15) 30%,
    rgba(128, 128, 128, 0.28) 50%,
    rgba(128, 128, 128, 0.15) 70%
  );
  background-size: 200% 100%;
  animation: aslideShimmer 1.4s ease-in-out infinite;
}
@keyframes aslideShimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}
/* Voice slide in an album: center the waveform player on a neutral panel (no media to fill). */
.aslide-voice {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  /* Darken the post's own (green) card into a panel rather than a glaring white box, so a voice
     slide reads as part of the post and stays on-theme in dark + light. */
  background: rgba(0, 0, 0, 0.2);
}
.aslide-voice > * {
  width: 100%;
  max-width: 420px;
}
/* Play glyph over a video slide's poster (the slides not currently in view). */
.aslide-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 52px;
  color: rgba(255, 255, 255, 0.92);
  filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.55));
  pointer-events: none;
}
.album-count {
  position: absolute;
  top: 8px;
  right: 10px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
}
/* Skeleton shimmer while the media hasn't painted yet (box height is already
   reserved by aspect-ratio, so nothing jumps when it loads). */
.thumb.loading {
  animation: thumb-pulse 1.4s ease-in-out infinite;
}
@keyframes thumb-pulse {
  0%, 100% {
    background-color: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
  }
  50% {
    background-color: var(--ion-color-step-200, rgba(120, 120, 128, 0.22));
  }
}
/* DIRECT children only — a single image/video fills its own (matched) frame. Must NOT cascade
   into the nested album-gallery slides, which use contain + a blurred fill (.aslide-*). */
.thumb > img,
.thumb > video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/* A single voice post: a darkened rounded panel inside the green card, so the green play button
   and waveform read clearly (instead of green-on-green) and it matches the album voice slide. */
.voice {
  margin: 8px 12px 4px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.2);
}
.voice-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  color: var(--ion-color-medium);
}
/* Full-screen ⤢ button over a photo (videos carry their own bar in WallVideo). Promoted to its
   own layer so it sits above the media on iOS. */
.vid-fs {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  color: #fff;
  font-size: 19px;
}
/* Full-screen button — bottom-right, opposite the play/mute cluster. */
.vid-fs {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 20;
  transform: translateZ(0);
  -webkit-transform: translateZ(0);
}
/* Album count badge over the cover (top-right). */
.album-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px 3px 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
.album-badge ion-icon {
  font-size: 14px;
}
/* Sound toggle for autoplaying videos (bottom-right of the cover). */
.vol-toggle {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 18px;
}
.body {
  margin: 8px 14px;
  white-space: normal;
  cursor: pointer;
}
.rrow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 12px 6px;
}
.rpill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: 999px;
  background: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
  padding: 3px 9px;
  font-size: 14px;
  cursor: pointer;
}
.rpill.mine {
  background: color-mix(in srgb, var(--ion-color-primary) 22%, transparent);
}
.rpill .rc {
  color: var(--ion-color-medium);
  font-size: 12px;
}
.raddbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
  color: var(--ion-color-medium);
  font-size: 18px;
  cursor: pointer;
}
.cpreview {
  padding: 2px 14px 4px;
}
.cpreview .crow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  padding: 2px 0;
}
.cpreview .cmini {
  width: 20px;
  height: 20px;
  flex: none;
}
.cpreview .cmini .ph {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--ion-color-step-150, rgba(120, 120, 128, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 10px;
}
.cpreview .cname {
  font-weight: 600;
}
.cpreview .more {
  display: block;
  color: var(--ion-color-medium);
  font-size: 13px;
  padding: 2px 0;
  cursor: pointer;
}
.cinput {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 8px 14px;
}
.cfield {
  flex: 1;
  --padding-start: 0;
  font-size: 14px;
}
</style>
