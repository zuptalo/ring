<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/wall" />
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

        <p class="body">{{ post.body }}</p>

        <p v-if="post.expiresAt" class="expiry">
          Disappears {{ when(post.expiresAt) }}
        </p>

        <!-- Reactions, comments and the viewer list arrive with US4/US6/US7. -->
      </div>
      <div v-else class="missing">This post is no longer available.</div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonContent, IonAvatar, IonIcon, onIonViewWillEnter, alertController,
} from '@ionic/vue';
import { useRoute, useRouter } from 'vue-router';
import { trashOutline } from 'ionicons/icons';
import { getPost, getContact, deletePost } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import { useSelfProfile } from '@/composables/useSelfProfile';
import type { Post } from '@/db/types';

const route = useRoute();
const router = useRouter();
const self = useSelfProfile();
const post = ref<Post | null>(null);
const authorName = ref('Unknown');
const authorAvatar = ref('');
const authorUsername = ref<string | undefined>(undefined);

onIonViewWillEnter(async () => {
  const id = String(route.params.id);
  post.value = await getPost(id);
  if (!post.value) return;
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
});

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
function when(ts: number): string {
  return new Date(ts).toLocaleString();
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
.missing {
  padding: 56px 24px;
  text-align: center;
  color: var(--ion-color-medium);
}
</style>
