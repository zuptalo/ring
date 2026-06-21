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
            <img v-if="authorAvatar" :src="authorAvatar" :alt="authorName" />
            <div v-else class="ph">{{ initial(authorName) }}</div>
          </ion-avatar>
          <div class="who">
            <div class="name">{{ authorName }}</div>
            <div v-if="authorUsername" class="user">@{{ authorUsername }}</div>
            <div class="time">{{ when(post.createdAt) }}</div>
          </div>
        </div>

        <div v-if="mediaUrl" class="media">
          <img v-if="post.kind === 'image'" :src="mediaUrl" :alt="post.body || 'Photo'" />
          <video v-else-if="post.kind === 'video'" :src="mediaUrl" controls playsinline />
          <audio v-else-if="post.kind === 'voice'" :src="mediaUrl" controls />
        </div>

        <p v-if="post.body" class="body"><EmojiText :text="post.body" big /></p>

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
                  <img v-if="avatarOf(c.actor)" :src="avatarOf(c.actor)" :alt="nameOf(c.actor)" />
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
              :auto-grow="true"
              :rows="1"
              placeholder="Add a comment…"
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
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonContent, IonAvatar, IonIcon, IonTextarea, IonList, IonItem, IonLabel,
  IonItemSliding, IonItemOptions, IonItemOption,
  onIonViewWillEnter, onIonViewWillLeave, alertController,
} from '@ionic/vue';
import { useRoute, useRouter } from 'vue-router';
import { trashOutline, happyOutline, timeOutline } from 'ionicons/icons';
import { timeLeft, formatPostDateTime } from '@/utils/post-time';
import { toastController } from '@ionic/vue';
import Emoji from '@/components/Emoji.vue';
import EmojiText from '@/components/EmojiText.vue';
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
const leftLabel = computed(() => (post.value?.expiresAt ? timeLeft(post.value.expiresAt, Date.now()) : ''));

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
  if (post.value.mediaId) {
    const md = await getMedia(post.value.mediaId);
    if (md?.blob) mediaUrl.value = URL.createObjectURL(md.blob);
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
  margin: 16px 0 0;
}
.media img,
.media video {
  width: 100%;
  max-height: 60vh;
  border-radius: 14px;
  object-fit: contain;
  background: #000;
}
.media audio {
  width: 100%;
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
  --background: transparent;
  --padding-start: 0;
  --inner-padding-end: 0;
  --min-height: 0;
  align-items: flex-start;
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
