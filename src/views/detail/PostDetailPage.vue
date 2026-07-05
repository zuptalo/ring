<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/wall" />
        </ion-buttons>
        <ion-title>Post</ion-title>
        <ion-buttons v-if="post?.outgoing" slot="end">
          <ion-button color="danger" aria-label="Delete post" @click="confirmDelete">
            <ion-icon slot="icon-only" :icon="trashOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div v-if="post" class="wrap">
        <div class="head">
          <ion-avatar class="avatar">
            <user-avatar v-if="authorAvatar" :src="authorAvatar" :alt="authorName" />
            <div v-else class="ph">{{ initial(authorName) }}</div>
          </ion-avatar>
          <div class="who">
            <div class="name">{{ authorName }}</div>
            <div v-if="authorUsername" class="user">@{{ authorUsername }}</div>
            <div class="time">{{ when(post.createdAt) }}</div>
          </div>
        </div>

        <!-- Album (FR-019): a swipeable horizontal gallery — slide between items — with a
             live position counter. Mixed image+video is fine; each slide plays on tap. -->
        <div v-if="albumMedia.length > 1" class="album">
          <div class="album-track" @scroll="onAlbumScroll">
            <!-- Mixed aspect ratios: each item shown whole (contain) with its own blurred
                 copy filling the letterbox — same treatment as the feed gallery. -->
            <div v-for="(m, i) in albumMedia" :key="i" class="album-slide" @click="openViewer(i)">
              <!-- Stills only here (no per-slide <video>): the blurred fill + the item are
                   images; a video shows its poster + play glyph and plays in the viewer on tap. -->
              <img class="aslide-fill" :src="m.kind === 'video' ? m.poster : m.url" alt="" aria-hidden="true" />
              <img v-if="m.kind === 'image'" class="aslide-main" :src="m.url" alt="" />
              <template v-else>
                <img class="aslide-main" :src="m.poster" alt="" />
                <ion-icon class="aslide-play" :icon="playCircleOutline" aria-hidden="true" />
              </template>
            </div>
          </div>
          <div class="album-count">{{ albumIndex + 1 }} / {{ albumMedia.length }}</div>
        </div>
        <div
          v-else-if="mediaUrl && (post.kind === 'image' || post.kind === 'video')"
          class="media"
          :style="mediaBoxStyle"
          @click="openViewer(0)"
        >
          <img v-if="post.kind === 'image'" :src="mediaUrl" :alt="post.body || 'Photo'" />
          <template v-else>
            <img v-if="posterUrl" :src="posterUrl" :alt="post.body || 'Video'" />
            <div v-else class="media-vid" />
            <ion-icon class="aslide-play" :icon="playCircleOutline" aria-hidden="true" />
          </template>
        </div>
        <audio v-else-if="mediaUrl && post.kind === 'voice'" class="vaudio" :src="mediaUrl" controls />

        <wall-game-card v-if="post.game" :post-id="post.id" :author-name="authorName" :is-own="!!post.outgoing" />
        <p v-else-if="post.body" class="body"><EmojiText :text="post.body" big /></p>

        <p v-if="post.expiresAt" class="expiry" :title="when(post.expiresAt)">
          <ion-icon :icon="timeOutline" /> Disappears in {{ leftLabel }}
        </p>

        <!-- Reactions (audience-visible): pills + the shared quick-react picker. -->
        <div class="reactions">
          <div class="rrow">
            <button
              v-for="g in grouped"
              :key="g.emoji"
              class="rpill"
              :class="{ mine: g.mine }"
              @click="react(g.emoji)"
            ><Emoji :emoji="g.emoji" /><span class="rc">{{ g.count }}</span></button>
            <button class="raddbtn" aria-label="React" @click="openPicker($event)">
              <ion-icon :icon="happyOutline" />
            </button>
          </div>
          <ul v-if="grouped.length" class="rlist">
            <li v-for="g in grouped" :key="g.emoji">
              <Emoji class="e" :emoji="g.emoji" />
              <span class="who">{{ g.who }}</span>
            </li>
          </ul>
        </div>

        <!-- Comments (audience-visible thread). Swipe a comment you can remove to the
             left to delete it (with confirmation). -->
        <div class="comments">
          <h3>Comments</h3>
          <ion-list v-if="comments.length" class="clist">
            <ion-item-sliding v-for="c in comments" :key="c.id">
              <ion-item lines="none" class="citem">
                <ion-avatar slot="start" class="cavatar">
                  <user-avatar v-if="avatarOf(c.actor)" :src="avatarOf(c.actor)" :alt="nameOf(c.actor)" />
                  <div v-else class="ph">{{ initial(nameOf(c.actor)) }}</div>
                </ion-avatar>
                <ion-label class="cwrap">
                  <div class="cmeta">
                    <span class="cname">{{ nameOf(c.actor) }}</span>
                    <span class="ctime">{{ ago(c.at) }}</span>
                  </div>
                  <p class="ctext"><EmojiText :text="c.text || ''" /></p>
                </ion-label>
              </ion-item>
              <ion-item-options v-if="canModerate(c)" side="end">
                <ion-item-option color="danger" @click="confirmDeleteComment(c)">Delete</ion-item-option>
              </ion-item-options>
            </ion-item-sliding>
          </ion-list>
          <p v-else class="empty">No comments yet.</p>
          <div class="cinput">
            <ion-textarea
              v-enter-send="sendComment"
              :auto-grow="true"
              :rows="1"
              placeholder="Add a comment…"
              autocapitalize="sentences"
              :spellcheck="true"
              dir="auto"
              :value="commentText"
              @ion-input="onComment"
            />
            <ion-button size="small" :disabled="!commentText.trim()" @click="sendComment">Post</ion-button>
          </div>
        </div>

        <!-- Author-only: who viewed this post (seen-receipts gated). -->
        <div v-if="post.outgoing && viewers.length" class="viewers">
          <h3>Viewed by</h3>
          <p>{{ viewers.map(nameOf).join(', ') }}</p>
        </div>
      </div>
      <div v-else class="missing">This post is no longer available.</div>
    </ion-content>

    <!-- Stills in the gallery → full-screen viewer (minimal: just close + react) on tap. -->
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
import WallGameCard from '@/components/WallGameCard.vue';
import { computed, reactive, ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonContent, IonAvatar, IonIcon, IonTextarea, IonList, IonItem, IonLabel,
  IonItemSliding, IonItemOptions, IonItemOption,
  onIonViewWillEnter, onIonViewWillLeave, alertController,
} from '@ionic/vue';
import { useRoute, useRouter } from 'vue-router';
import { trashOutline, happyOutline, timeOutline, playCircleOutline } from 'ionicons/icons';
import MediaViewer, { type ViewerItem } from '@/components/MediaViewer.vue';
import { timeLeft, formatPostDateTime } from '@/utils/post-time';
import { appToast } from '@/services/toast';
import Emoji from '@/components/Emoji.vue';
import EmojiText from '@/components/EmojiText.vue';
import { vEnterSend } from '@/directives/enter-send';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useReactionPicker } from '@/composables/useReactionPicker';
import {
  getPost, getContact, getMedia, deletePost,
  listPostReactions, reactToPost, syncEngagement, listContacts,
  listPostComments, commentOnPost, deleteComment, recordPostView, listPostViews,
  MAX_REACTIONS_PER_USER, MAX_DISTINCT_REACTIONS,
} from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import { useSelfProfile } from '@/composables/useSelfProfile';
import type { Post, PostEngagement, Contact } from '@/db/types';

const route = useRoute();
const router = useRouter();
const self = useSelfProfile();
const selfId = getSelfUserId();
const postId = String(route.params.id);
const post = ref<Post | null>(null);
const authorName = ref('Unknown');
const authorAvatar = ref('');
const authorUsername = ref<string | undefined>(undefined);
const mediaUrl = ref<string | undefined>(undefined);
const posterUrl = ref<string | undefined>(undefined); // single-video poster (still shown until tapped)
// Album posts (FR-019): every media resolved to an object URL, shown as a swipeable gallery.
const albumMedia = ref<{ url: string; kind: 'image' | 'video'; poster?: string }[]>([]);
const albumIndex = ref(0);
function onAlbumScroll(e: Event): void {
  const el = e.target as HTMLElement;
  albumIndex.value = el.clientWidth ? Math.round(el.scrollLeft / el.clientWidth) : 0;
}
const leftLabel = computed(() => (post.value?.expiresAt ? timeLeft(post.value.expiresAt, Date.now()) : ''));
// Reserve the media's aspect ratio so the page doesn't reflow as it decodes.
const mediaBoxStyle = computed(() =>
  post.value?.mediaW && post.value?.mediaH
    ? { aspectRatio: `${post.value.mediaW} / ${post.value.mediaH}` }
    : {},
);

const reactions = useLiveQuery(() => listPostReactions(postId), ['postEngagement'], [] as PostEngagement[]);
const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);
const { openQuick } = useReactionPicker();

const myEmojis = computed(() => reactions.value.filter((r) => r.actor === selfId).map((r) => r.emoji ?? ''));
// Reaction pills (emoji + count + whether I reacted), plus a "who reacted" line.
const grouped = computed(() => {
  const byId = new Map(contacts.value.map((c) => [c.id, c.name] as const));
  const map = new Map<string, { who: string[]; count: number; mine: boolean }>();
  for (const r of reactions.value) {
    if (!r.emoji) continue;
    const g = map.get(r.emoji) ?? { who: [], count: 0, mine: false };
    g.who.push(r.actor === selfId ? 'You' : byId.get(r.actor) ?? 'Someone');
    g.count += 1;
    if (r.actor === selfId) g.mine = true;
    map.set(r.emoji, g);
  }
  return [...map.entries()].map(([emoji, g]) => ({ emoji, who: g.who.join(', '), count: g.count, mine: g.mine }));
});

async function react(emoji: string): Promise<void> {
  const res = await reactToPost(postId, emoji);
  if (res === 'limit' || res === 'limit-emojis') {
    await appToast({
      message:
        res === 'limit-emojis'
          ? `This post already has ${MAX_DISTINCT_REACTIONS} different reactions — tap one of those instead.`
          : `You can add up to ${MAX_REACTIONS_PER_USER} reactions.`,
      duration: 1600,
    });
  }
}
// Full-screen viewer (minimal mode): the gallery shows stills, the clip plays here on tap.
const viewer = reactive<{ open: boolean; items: ViewerItem[]; start: number }>({ open: false, items: [], start: 0 });
function openViewer(start: number): void {
  const list: { url: string; kind: 'image' | 'video'; poster?: string }[] = albumMedia.value.length
    ? albumMedia.value
    : mediaUrl.value
      ? [{ url: mediaUrl.value, kind: post.value?.kind === 'video' ? 'video' : 'image', poster: posterUrl.value }]
      : [];
  if (!list.length) return;
  viewer.items = list.map((m, i) => ({
    id: `${postId}:${i}`,
    url: m.url,
    thumb: (m.kind === 'video' ? m.poster : m.url) ?? m.url,
    kind: m.kind,
    caption: post.value?.body ?? '',
    senderName: authorName.value,
    when: '',
    outgoing: post.value?.author === selfId,
    favorite: false,
    reactions: [],
  }));
  viewer.start = Math.min(start, viewer.items.length - 1);
  viewer.open = true;
}
function openPicker(ev: Event): void {
  const existing = grouped.value.map((g) => g.emoji);
  void openQuick(ev, {
    myEmojis: myEmojis.value,
    existing,
    atEmojiCap: existing.length >= MAX_DISTINCT_REACTIONS,
    onPick: react,
  });
}

const nameOf = (actorId: string): string => {
  if (actorId === selfId) return 'You';
  return contacts.value.find((c) => c.id === actorId)?.name ?? 'Someone';
};
const avatarOf = (actorId: string): string => {
  if (actorId === selfId) return self.avatar.value;
  return contacts.value.find((c) => c.id === actorId)?.avatar ?? '';
};

// Comments thread.
const comments = useLiveQuery(() => listPostComments(postId), ['postEngagement'], [] as PostEngagement[]);
const commentText = ref('');
function onComment(e: CustomEvent): void {
  commentText.value = (e.detail as { value?: string | null }).value ?? '';
}
async function sendComment(): Promise<void> {
  const t = commentText.value.trim();
  if (!t) return;
  commentText.value = '';
  await commentOnPost(postId, t);
}
function canModerate(c: PostEngagement): boolean {
  return c.actor === selfId || !!post.value?.outgoing;
}
async function confirmDeleteComment(c: PostEngagement): Promise<void> {
  const a = await alertController.create({
    header: 'Delete comment',
    message: 'This removes your comment for everyone in the audience.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Delete', role: 'destructive', handler: () => void deleteComment(postId, c.id) },
    ],
  });
  await a.present();
}

// Author-only view list.
const viewers = ref<string[]>([]);

onIonViewWillEnter(async () => {
  void syncEngagement(postId); // refresh reactions from the server
  post.value = await getPost(postId);
  if (!post.value) return;
  const ids = post.value.mediaIds?.length ? post.value.mediaIds : post.value.mediaId ? [post.value.mediaId] : [];
  if (ids.length > 1) {
    // Album: resolve every item in order for the swipeable gallery. Video slides carry a poster
    // so the gallery shows a still (no live <video> per slide) and only plays in the viewer.
    for (const id of ids) {
      const md = await getMedia(id);
      if (!md?.blob) continue;
      const kind = md.kind === 'video' ? 'video' : 'image';
      const posterBlob = kind === 'video' ? (md.posterBlob ?? md.posterGrid) : undefined;
      albumMedia.value.push({
        url: URL.createObjectURL(md.blob),
        kind,
        poster: posterBlob ? URL.createObjectURL(posterBlob) : undefined,
      });
    }
  } else if (ids.length === 1) {
    const md = await getMedia(ids[0]);
    if (md?.blob) mediaUrl.value = URL.createObjectURL(md.blob);
    const posterBlob = md?.kind === 'video' ? (md.posterBlob ?? md.posterGrid) : undefined;
    if (posterBlob) posterUrl.value = URL.createObjectURL(posterBlob);
  }
  if (post.value.author === getSelfUserId()) {
    authorName.value = 'You';
    authorAvatar.value = self.avatar.value;
    authorUsername.value = undefined;
  } else {
    const c = await getContact(post.value.author);
    authorName.value = c?.name ?? 'Unknown';
    authorAvatar.value = c?.avatar ?? '';
    authorUsername.value = c?.username;
  }
  // Views: record ours on someone else's post; load the list on our own.
  if (post.value.outgoing) {
    viewers.value = await listPostViews(postId);
  } else {
    void recordPostView(postId);
  }
});

onIonViewWillLeave(() => {
  if (mediaUrl.value) {
    URL.revokeObjectURL(mediaUrl.value);
    mediaUrl.value = undefined;
  }
  if (posterUrl.value) {
    URL.revokeObjectURL(posterUrl.value);
    posterUrl.value = undefined;
  }
  for (const m of albumMedia.value) {
    URL.revokeObjectURL(m.url);
    if (m.poster) URL.revokeObjectURL(m.poster);
  }
  albumMedia.value = [];
});

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
function when(ts: number): string {
  return formatPostDateTime(ts);
}
function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

async function confirmDelete(): Promise<void> {
  if (!post.value) return;
  const a = await alertController.create({
    header: 'Delete post',
    message:
      'This removes the post for you and signals your audience to remove their copies. ' +
      'Copies already downloaded can’t be guaranteed to disappear.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete',
        role: 'destructive',
        handler: () => {
          void deletePost(post.value!.id).then(() => router.back());
        },
      },
    ],
  });
  await a.present();
}
</script>

<style scoped>
.wrap {
  padding: 16px 20px;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar {
  width: 48px;
  height: 48px;
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
.who .name {
  font-weight: 600;
}
.who .user,
.who .time {
  color: var(--ion-color-medium);
  font-size: 13px;
}
.media {
  position: relative;
  margin: 16px 0 0;
  width: 100%;
  max-height: 70vh;
  border-radius: 14px;
  overflow: hidden;
  background: #000;
}
.media-vid {
  width: 100%;
  aspect-ratio: 4 / 5;
  background: #1c1c1c;
}
.media img,
.media video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
/* Swipeable album gallery: scroll-snap row, one item per view + a position counter. */
.album {
  position: relative;
  margin: 16px 0 0;
}
.album-track {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  border-radius: 14px;
  background: #000;
  scrollbar-width: none;
  /* One stable frame for the whole mixed-aspect album (4:5, capped to most of the screen). */
  aspect-ratio: 4 / 5;
  max-height: 74vh;
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
}
/* Blurred, zoomed copy fills the letterbox; the item itself is shown whole (contain). */
.aslide-fill {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.15);
  filter: blur(22px) brightness(0.85) saturate(1.1);
}
.aslide-main {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.aslide-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 56px;
  color: rgba(255, 255, 255, 0.92);
  filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.55));
  pointer-events: none;
  z-index: 2;
}
.album-count {
  position: absolute;
  top: 10px;
  right: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
}
.vaudio {
  width: 100%;
  margin: 16px 0 0;
}
.body {
  margin: 16px 0 0;
  font-size: 17px;
  white-space: pre-wrap;
}
.expiry {
  margin-top: 16px;
  font-size: 13px;
  color: var(--ion-color-medium);
}
.reactions {
  margin-top: 20px;
}
.reactions .rrow {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.reactions .rpill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 16px;
  padding: 4px 10px;
  border: none;
  border-radius: 999px;
  background: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
  cursor: pointer;
}
.reactions .rpill.mine {
  background: color-mix(in srgb, var(--ion-color-primary) 22%, transparent);
}
.reactions .rpill .rc {
  font-size: 12px;
  color: var(--ion-color-medium);
}
.reactions .raddbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
  color: var(--ion-color-medium);
  font-size: 20px;
  cursor: pointer;
}
.reactions .rlist {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}
.reactions .rlist li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 4px 0;
}
.reactions .rlist .e {
  font-size: 18px;
}
.reactions .rlist .who {
  color: var(--ion-color-medium);
  font-size: 14px;
}
.comments {
  margin-top: 24px;
}
.comments h3,
.viewers h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 8px;
}
.comments .clist {
  margin: 0 0 12px;
  padding: 0;
  background: transparent;
}
.comments .citem {
  /* Opaque tinted row surface (the app's standard row wash, matching the post card)
     rather than transparent, so that as the row slides back it slides OVER the swipe
     action and hides it — otherwise the action shows through the row and then blinks
     out when the slider collapses. */
  --background: var(--ion-item-background);
  --padding-start: 0;
  --inner-padding-end: 0;
  --min-height: 0;
  align-items: flex-start;
}
/* Match the swipe-to-delete action to the comment row: a rounded, vertically-inset
   pill that's revealed from behind the row as it slides, not a tall square button. */
.comments ion-item-option {
  margin: 6px 0 6px 8px;
  border-radius: 12px;
  --border-radius: 12px;
  overflow: hidden;
  font-weight: 600;
  min-width: 72px;
}
.comments .cavatar {
  width: 32px;
  height: 32px;
  margin: 6px 10px 6px 0;
}
.comments .cavatar .ph {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--ion-color-step-150, rgba(120, 120, 128, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 13px;
}
.comments .cwrap {
  margin: 6px 0;
}
.comments .cmeta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.comments .cname {
  font-weight: 600;
  font-size: 14px;
}
.comments .ctime {
  color: var(--ion-color-medium);
  font-size: 12px;
}
.comments .ctext {
  margin: 2px 0 0;
  white-space: pre-wrap;
}
.comments .empty {
  color: var(--ion-color-medium);
  font-size: 14px;
}
.comments .cinput {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.comments .cinput ion-textarea {
  flex: 1;
  --background: var(--ion-color-step-100, rgba(120, 120, 128, 0.1));
  --padding-start: 12px;
  --padding-end: 12px;
  border-radius: 18px;
}
.viewers {
  margin-top: 20px;
  color: var(--ion-color-medium);
  font-size: 14px;
}
.viewers p {
  margin: 0;
}
.missing {
  padding: 56px 24px;
  text-align: center;
  color: var(--ion-color-medium);
}
</style>
