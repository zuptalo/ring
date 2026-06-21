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
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Wall</ion-title>
        </ion-toolbar>
      </ion-header>

      <div v-if="loaded && !wall.length" class="empty">
        <ion-icon :icon="sparklesOutline" />
        <p>No posts yet. Share a moment with your friends.</p>
        <ion-button fill="solid" @click="compose">New post</ion-button>
      </div>

      <div v-if="loaded && wall.length && !filteredWall.length" class="empty">
        <p>No posts match “{{ search }}”.</p>
      </div>

      <!-- Each post is a sliding item: swipe LEFT to delete your own post (or hide
           someone else's), swipe RIGHT to mute/unmute their Wall notifications. -->
      <ion-item-sliding v-for="p in filteredWall" :key="p.id">
        <ion-item lines="none" class="postitem">
          <div class="post">
            <!-- Header: avatar + name + a subtle "disappears in …" countdown. -->
            <div class="phead">
              <ion-avatar class="avatar" @click="open(p.id)">
                <img v-if="p.authorAvatar" :src="p.authorAvatar" :alt="p.authorName" />
                <div v-else class="ph">{{ initial(p.authorName) }}</div>
              </ion-avatar>
              <div class="who" @click="open(p.id)">
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
            </div>

            <!-- Media + body (tap → full post). The image/video box reserves the
                 media's aspect ratio with a skeleton so the feed doesn't jump as it
                 decodes; a placeholder box also shows before the blob URL resolves. -->
            <div
              v-if="p.kind === 'image' || p.kind === 'video'"
              class="thumb"
              :class="{ loading: !mediaLoaded[p.id] }"
              :style="mediaStyle(p)"
              @click="open(p.id)"
            >
              <img
                v-if="p.kind === 'image' && p.mediaUrl"
                :src="p.mediaUrl"
                :alt="p.body || 'Photo'"
                @load="onMediaLoad(p.id)"
              />
              <video
                v-else-if="p.kind === 'video' && p.mediaUrl"
                :src="p.mediaUrl"
                muted
                playsinline
                preload="metadata"
                @loadeddata="onMediaLoad(p.id)"
              />
              <ion-icon v-if="p.kind === 'video' && p.mediaUrl" class="play" :icon="playCircleOutline" />
            </div>
            <div v-else-if="p.mediaUrl && p.kind === 'voice'" class="voice" @click="open(p.id)">
              <ion-icon :icon="micOutline" /> Voice message
            </div>
            <p v-if="p.body" class="body" @click="open(p.id)"><EmojiText :text="p.body" /></p>

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

            <!-- Comment preview: first comment → "view all" → last comment (with avatars). -->
            <div v-if="p.commentCount" class="cpreview">
              <div class="crow">
                <ion-avatar class="cmini">
                  <img v-if="p.comments[0].authorAvatar" :src="p.comments[0].authorAvatar" :alt="p.comments[0].authorName" />
                  <div v-else class="ph">{{ initial(p.comments[0].authorName) }}</div>
                </ion-avatar>
                <span class="cname">{{ p.comments[0].authorName }}</span>
                <EmojiText :text="p.comments[0].text" />
              </div>
              <a v-if="p.commentCount > 2" class="more" @click="open(p.id)">
                View all {{ p.commentCount }} comments
              </a>
              <div v-if="p.commentCount > 1" class="crow">
                <ion-avatar class="cmini">
                  <img v-if="p.comments[p.commentCount - 1].authorAvatar" :src="p.comments[p.commentCount - 1].authorAvatar" :alt="p.comments[p.commentCount - 1].authorName" />
                  <div v-else class="ph">{{ initial(p.comments[p.commentCount - 1].authorName) }}</div>
                </ion-avatar>
                <span class="cname">{{ p.comments[p.commentCount - 1].authorName }}</span>
                <EmojiText :text="p.comments[p.commentCount - 1].text" />
              </div>
            </div>

            <!-- Quick comment from the feed. -->
            <div class="cinput">
              <ion-input
                class="cfield"
                :value="draft[p.id] || ''"
                placeholder="Add a comment…"
                @ion-input="onDraft(p.id, $event)"
                @keyup.enter="sendComment(p)"
              />
              <ion-button size="small" fill="clear" :disabled="!(draft[p.id] || '').trim()" @click="sendComment(p)">
                Post
              </ion-button>
            </div>
          </div>
        </ion-item>

        <ion-item-options v-if="!p.isOwn" side="start">
          <ion-item-option color="medium" @click="toggleMute(p)">{{ p.muted ? 'Unmute' : 'Mute' }}</ion-item-option>
        </ion-item-options>
        <ion-item-options side="end">
          <ion-item-option v-if="p.isOwn" color="danger" @click="confirmDeletePost(p)">Delete</ion-item-option>
          <ion-item-option v-else color="dark" @click="hideUser(p)">Hide</ion-item-option>
        </ion-item-options>
      </ion-item-sliding>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonItem, IonItemSliding, IonItemOption, IonItemOptions, IonAvatar, IonIcon, IonInput, IonSearchbar,
  toastController, actionSheetController, alertController,
  onIonViewWillEnter, onIonViewWillLeave,
} from '@ionic/vue';
import { useRouter } from 'vue-router';
import {
  createOutline, sparklesOutline, micOutline, playCircleOutline, happyOutline, timeOutline,
  notificationsOutline, notificationsOffOutline,
} from 'ionicons/icons';
import Emoji from '@/components/Emoji.vue';
import EmojiText from '@/components/EmojiText.vue';
import { useWall, type WallPost } from '@/composables/useWall';
import { useReactionPicker } from '@/composables/useReactionPicker';
import {
  reactToPost, commentOnPost, deletePost, MAX_REACTIONS_PER_USER, MAX_DISTINCT_REACTIONS,
  markWallSeen, setWallMuteUntil, isWallTempMuted, setWallUserMuted, setWallUserHidden,
} from '@/db/queries';
import { timeLeft, ago } from '@/utils/post-time';

const router = useRouter();
const { wall, now, loaded } = useWall();
const { openQuick } = useReactionPicker();
const draft = reactive<Record<string, string>>({});

// Reserve the media's aspect ratio (fallback 4:3) so the card height is fixed before
// the image/video decodes; track which have loaded to drop the skeleton shimmer.
const mediaLoaded = reactive<Record<string, boolean>>({});
function onMediaLoad(id: string): void {
  mediaLoaded[id] = true;
}
function mediaStyle(p: WallPost): Record<string, string> {
  return { aspectRatio: p.mediaW && p.mediaH ? `${p.mediaW} / ${p.mediaH}` : '4 / 3' };
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
function open(id: string): void {
  void router.push(`/wall/post/${id}`);
}
function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
const left = (p: WallPost): string => timeLeft(p.expiresAt, now.value);

async function onReact(post: WallPost, emoji: string): Promise<void> {
  const res = await reactToPost(post.id, emoji);
  if (res === 'limit' || res === 'limit-emojis') {
    const t = await toastController.create({
      message:
        res === 'limit-emojis'
          ? `This post already has ${MAX_DISTINCT_REACTIONS} different reactions — tap one of those instead.`
          : `You can add up to ${MAX_REACTIONS_PER_USER} reactions.`,
      duration: 1600,
      position: 'top',
    });
    await t.present();
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
    { text: 'Mute for 8 hours', handler: () => void mute(Date.now() + 8 * 60 * 60_000) },
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

// --- per-user mute / hide (swipe-right = mute, swipe-left = hide) ---
async function toggleMute(post: WallPost): Promise<void> {
  await setWallUserMuted(post.author, !post.muted);
  const t = await toastController.create({
    message: post.muted ? `Unmuted ${post.authorName}` : `Muted ${post.authorName}'s Wall notifications`,
    duration: 1400,
    position: 'top',
  });
  await t.present();
}
async function hideUser(post: WallPost): Promise<void> {
  await setWallUserHidden(post.author, true);
  const t = await toastController.create({
    message: `Hid ${post.authorName}'s posts. Undo from the bell menu.`,
    duration: 1800,
    position: 'top',
  });
  await t.present();
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
  background: var(--ion-card-background, var(--ion-item-background, #fff));
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}
.phead {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 8px;
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
.thumb {
  position: relative;
  cursor: pointer;
  width: 100%;
  max-height: 60vh;
  overflow: hidden;
  background: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
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
.thumb img,
.thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.voice {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 14px;
  color: var(--ion-color-medium);
  cursor: pointer;
}
.thumb .play {
  position: absolute;
  inset: 0;
  margin: auto;
  font-size: 52px;
  color: rgba(255, 255, 255, 0.92);
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
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
