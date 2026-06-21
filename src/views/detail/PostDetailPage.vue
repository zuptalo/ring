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

        <p v-if="post.body" class="body">{{ post.body }}</p>

        <p v-if="post.expiresAt" class="expiry">
          Disappears {{ when(post.expiresAt) }}
        </p>

        <!-- Reactions (audience-visible). -->
        <div class="reactions">
          <div class="picker">
            <button
              v-for="e in EMOJIS"
              :key="e"
              class="emoji"
              :class="{ mine: myEmoji === e }"
              :aria-label="'React ' + e"
              @click="react(e)"
            ><Emoji :emoji="e" /></button>
          </div>
          <ul v-if="grouped.length" class="rlist">
            <li v-for="g in grouped" :key="g.emoji">
              <Emoji class="e" :emoji="g.emoji" />
              <span class="who">{{ g.who }}</span>
            </li>
          </ul>
        </div>

        <!-- Comments (audience-visible thread). -->
        <div class="comments">
          <h3>Comments</h3>
          <ul v-if="comments.length" class="clist">
            <li v-for="c in comments" :key="c.id">
              <div class="cmeta">
                <span class="cname">{{ nameOf(c.actor) }}</span>
                <span class="ctime">{{ ago(c.at) }}</span>
                <button v-if="canModerate(c)" class="cdel" aria-label="Delete comment" @click="removeComment(c)">
                  <ion-icon :icon="trashOutline" />
                </button>
              </div>
              <p class="ctext">{{ c.text }}</p>
            </li>
          </ul>
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
  IonContent, IonAvatar, IonIcon, IonTextarea, onIonViewWillEnter, onIonViewWillLeave, alertController,
} from '@ionic/vue';
import { useRoute, useRouter } from 'vue-router';
import { trashOutline } from 'ionicons/icons';
import Emoji from '@/components/Emoji.vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import {
  getPost, getContact, getMedia, deletePost,
  listPostReactions, reactToPost, syncEngagement, listContacts,
  listPostComments, commentOnPost, deleteComment, recordPostView, listPostViews,
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

// The same canonical quick-react set the chat uses (rendered via the Noto Emoji
// component for visual + animation consistency).
const EMOJIS = ['👍', '❤️', '😂', '😮', '🙏'];
const reactions = useLiveQuery(() => listPostReactions(postId), ['postEngagement'], [] as PostEngagement[]);
const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);

const myEmoji = computed(() => reactions.value.find((r) => r.actor === selfId)?.emoji);
// Group reactions by emoji with a human "who" label.
const grouped = computed(() => {
  const byId = new Map(contacts.value.map((c) => [c.id, c.name] as const));
  const map = new Map<string, string[]>();
  for (const r of reactions.value) {
    if (!r.emoji) continue;
    const who = r.actor === selfId ? 'You' : byId.get(r.actor) ?? 'Someone';
    const list = map.get(r.emoji) ?? [];
    list.push(who);
    map.set(r.emoji, list);
  }
  return [...map.entries()].map(([emoji, names]) => ({ emoji, who: names.join(', ') }));
});

function react(emoji: string): void {
  void reactToPost(postId, emoji);
}

const nameOf = (actorId: string): string => {
  if (actorId === selfId) return 'You';
  return contacts.value.find((c) => c.id === actorId)?.name ?? 'Someone';
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
function removeComment(c: PostEngagement): void {
  void deleteComment(postId, c.id);
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
  return new Date(ts).toLocaleString();
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
.reactions .picker {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.reactions .emoji {
  font-size: 22px;
  line-height: 1;
  padding: 6px 8px;
  border: none;
  border-radius: 999px;
  background: var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
  cursor: pointer;
}
.reactions .emoji.mine {
  background: var(--ion-color-primary);
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
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
}
.comments .clist li {
  padding: 8px 0;
  border-bottom: 1px solid var(--ion-color-step-100, rgba(120, 120, 128, 0.12));
}
.comments .cmeta {
  display: flex;
  align-items: center;
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
.comments .cdel {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--ion-color-medium);
  cursor: pointer;
  font-size: 16px;
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
