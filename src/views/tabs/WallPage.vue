<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>Wall</ion-title>
        <ion-buttons slot="end">
          <ion-button aria-label="New post" @click="compose">
            <ion-icon slot="icon-only" :icon="createOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Wall</ion-title>
        </ion-toolbar>
      </ion-header>

      <div v-if="!wall.length" class="empty">
        <ion-icon :icon="sparklesOutline" />
        <p>No posts yet. Share a moment with your friends.</p>
        <ion-button fill="solid" @click="compose">New post</ion-button>
      </div>

      <ion-card v-for="p in wall" :key="p.id" class="post">
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
              {{ ago(p.createdAt, now) }}<span v-if="p.audience === 'close'"> · Close friends</span>
            </div>
          </div>
          <span v-if="left(p)" class="countdown" :title="'This post auto-deletes'">
            <ion-icon :icon="timeOutline" />{{ left(p) }}
          </span>
        </div>

        <!-- Media + body (tap → full post). -->
        <div v-if="p.mediaUrl" class="thumb" @click="open(p.id)">
          <img v-if="p.kind === 'image'" :src="p.mediaUrl" :alt="p.body || 'Photo'" />
          <video v-else-if="p.kind === 'video'" :src="p.mediaUrl" muted playsinline preload="metadata" />
          <div v-else class="voice"><ion-icon :icon="micOutline" /> Voice message</div>
          <ion-icon v-if="p.kind === 'video'" class="play" :icon="playCircleOutline" />
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

        <!-- Comment preview: first comment → "view all" → last comment. -->
        <div v-if="p.commentCount" class="cpreview">
          <div class="crow">
            <span class="cname">{{ p.comments[0].authorName }}</span>
            <EmojiText :text="p.comments[0].text" />
          </div>
          <a v-if="p.commentCount > 2" class="more" @click="open(p.id)">
            View all {{ p.commentCount }} comments
          </a>
          <div v-if="p.commentCount > 1" class="crow">
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
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonCard, IonAvatar, IonIcon, IonInput, toastController,
} from '@ionic/vue';
import { useRouter } from 'vue-router';
import { createOutline, sparklesOutline, micOutline, playCircleOutline, happyOutline, timeOutline } from 'ionicons/icons';
import Emoji from '@/components/Emoji.vue';
import EmojiText from '@/components/EmojiText.vue';
import { useWall, type WallPost } from '@/composables/useWall';
import { useReactionPicker } from '@/composables/useReactionPicker';
import { reactToPost, commentOnPost, MAX_REACTIONS_PER_USER, MAX_DISTINCT_REACTIONS } from '@/db/queries';
import { timeLeft, ago } from '@/utils/post-time';

const router = useRouter();
const { wall, now } = useWall();
const { openQuick } = useReactionPicker();
const draft = reactive<Record<string, string>>({});

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
.post {
  margin: 12px;
  border-radius: 16px;
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
}
.thumb img,
.thumb video {
  width: 100%;
  max-height: 360px;
  object-fit: cover;
  display: block;
}
.thumb .voice {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 14px;
  color: var(--ion-color-medium);
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
  font-size: 14px;
  padding: 1px 0;
}
.cpreview .cname {
  font-weight: 600;
  margin-right: 6px;
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
