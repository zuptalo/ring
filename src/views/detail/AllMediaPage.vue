<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button :default-href="`/chat/${chatId}`" />
        </ion-buttons>
        <ion-segment :value="tab" @ion-change="tab = String($event.detail.value)">
          <ion-segment-button value="media"><ion-label>Media</ion-label></ion-segment-button>
          <ion-segment-button value="links"><ion-label>Links</ion-label></ion-segment-button>
          <ion-segment-button value="docs"><ion-label>Docs</ion-label></ion-segment-button>
        </ion-segment>
        <ion-buttons slot="end">
          <ion-button aria-label="Clean up media" @click="cleanupChat">
            <ion-icon slot="icon-only" :icon="trashOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <!-- MEDIA: month-grouped grid of thumbnails -->
      <template v-if="tab === 'media'">
        <template v-for="grp in mediaGroups" :key="grp.label">
          <div class="month-head">{{ grp.label }}</div>
          <div class="media-grid">
            <button
              v-for="m in grp.items"
              :key="m.id"
              type="button"
              class="media-cell"
              @click="openViewer(m.id)"
            >
              <img v-if="m.mediaId && info[m.mediaId]" :src="info[m.mediaId].posterUrl || info[m.mediaId].url" alt="" />
              <ion-icon v-if="m.kind === 'video'" class="cell-play" :icon="playCircle" />
            </button>
          </div>
        </template>
        <div v-if="media.length === 0" class="empty"><ion-note>No media yet</ion-note></div>
      </template>

      <!-- LINKS -->
      <template v-else-if="tab === 'links'">
        <ion-list>
          <ion-item v-for="m in links" :key="m.id" button :detail="false" @click="openExternal(firstUrl(m.body))">
            <ion-icon slot="start" :icon="linkOutline" color="primary" />
            <ion-label class="ion-text-wrap">
              <h3>{{ firstUrl(m.body) }}</h3>
              <p>{{ m.body }}</p>
            </ion-label>
          </ion-item>
        </ion-list>
        <div v-if="links.length === 0" class="empty"><ion-note>No links yet</ion-note></div>
      </template>

      <!-- DOCS -->
      <template v-else>
        <ion-list>
          <ion-item v-for="m in docs" :key="m.id" button :detail="false" @click="openDoc(m)">
            <ion-icon slot="start" :icon="documentOutline" color="primary" />
            <ion-label class="ion-text-wrap">
              <h3>{{ m.mediaId && info[m.mediaId] ? info[m.mediaId].name : 'Document' }}</h3>
              <p>{{ docMeta(m) }}</p>
            </ion-label>
          </ion-item>
        </ion-list>
        <div v-if="docs.length === 0" class="empty"><ion-note>No documents yet</ion-note></div>
      </template>
    </ion-content>

    <media-viewer
      :open="viewer.open"
      :items="viewerItems"
      :start="viewer.start"
      @close="viewer.open = false"
      @dismiss="viewer.open = false"
      @react="(id, e) => react(id, e)"
      @favorite="(id) => fav(id)"
      @del="(id) => del(id)"
      @share="(id) => share(id)"
      @caption="(id) => caption(id)"
      @reply="goChat"
      @goto="goChat"
      @allmedia="viewer.open = false"
    />
    <forward-picker :open="forwardOpen" @send="onForwardSend" @close="forwardOpen = false" />
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonButton, IonButtons, IonBackButton, IonSegment, IonSegmentButton,
  IonLabel, IonContent, IonList, IonItem, IonIcon, IonNote, actionSheetController, alertController,
} from '@ionic/vue';
import { playCircle, linkOutline, documentOutline, trashOutline } from 'ionicons/icons';
import { openExternal } from '@/utils/external';
import {
  listChatMedia, listChatDocs, listChatLinks, getChat,
  reactToMessage, toggleFavorite, deleteMessage, setCaption, forwardMessage,
  deleteMediaByKind, deleteMediaLargerThan, mediaCleanupPreview,
  CAPTION_MAX,
} from '@/db/queries';
import { formatBytes } from '@/utils/bytes';
import { get, put } from '@/db/idb';
import { generateVideoPoster, generateImageThumb } from '@/utils/media-meta';
import type { Chat, Media, Message } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { formatStamp, formatFull } from '@/utils/time';
import MediaViewer from '@/components/MediaViewer.vue';
import ForwardPicker from '@/components/ForwardPicker.vue';

const route = useRoute();
const router = useRouter();
const chatId = route.params.id as string;

// Clean up THIS chat's media: delete by type or by size (scoped to the chat).
async function cleanupChat(): Promise<void> {
  const MB = 1024 * 1024;
  const groups: { kinds: Media['kind'][]; label: string }[] = [
    { kinds: ['image'], label: 'photos' },
    { kinds: ['video'], label: 'videos' },
    { kinds: ['voice', 'audio'], label: 'audio' },
    { kinds: ['file'], label: 'documents' },
  ];
  const buttons: { text: string; role?: 'destructive' | 'cancel'; handler?: () => void }[] = [];
  for (const g of groups) {
    const { bytes, count } = await mediaCleanupPreview({ kinds: g.kinds, chatId });
    if (count) {
      buttons.push({
        text: `Delete ${g.label} · ${count} (${formatBytes(bytes)})`,
        role: 'destructive',
        handler: () => void deleteMediaByKind(g.kinds, chatId),
      });
    }
  }
  const large = await mediaCleanupPreview({ minBytes: 10 * MB, chatId });
  if (large.count) {
    buttons.push({
      text: `Delete files > 10 MB · ${large.count} (${formatBytes(large.bytes)})`,
      role: 'destructive',
      handler: () => void deleteMediaLargerThan(10 * MB, chatId),
    });
  }
  if (buttons.length === 0) {
    const a = await alertController.create({
      header: 'Nothing to clean',
      message: 'This chat has no downloaded media on this device.',
      buttons: ['OK'],
    });
    await a.present();
    return;
  }
  buttons.push({ text: 'Cancel', role: 'cancel' });
  const sheet = await actionSheetController.create({ header: "Clean up this chat's media", buttons });
  await sheet.present();
}

const tab = ref('media');
const chat = useLiveQuery<Chat | undefined>(() => getChat(chatId), ['chats'], undefined);
const media = useLiveQuery(() => listChatMedia(chatId), ['messages'], [] as Message[]);
const docs = useLiveQuery(() => listChatDocs(chatId), ['messages'], [] as Message[]);
const links = useLiveQuery(() => listChatLinks(chatId), ['messages'], [] as Message[]);

// Resolve media blobs to object URLs (+ video posters).
interface Info { url: string; posterUrl?: string; mime: string; name: string }
const info = ref<Record<string, Info>>({});
watch(
  [media, docs],
  async () => {
    for (const m of [...media.value, ...docs.value]) {
      if (m.mediaId && !info.value[m.mediaId]) {
        const md = await get<Media>('media', m.mediaId);
        if (md) {
          const url = URL.createObjectURL(md.blob);
          info.value[m.mediaId] = {
            url,
            // posterBlob, else the sender-embedded posterData (data URL) for videos,
            // so the grid shows a thumbnail without re-generating one (spec 1007).
            posterUrl: md.posterBlob
              ? URL.createObjectURL(md.posterBlob)
              : m.kind === 'video'
                ? m.posterData
                : undefined,
            mime: md.mime,
            name: md.name,
          };
          if (m.kind === 'video' && !info.value[m.mediaId].posterUrl) void poster(md.blob, m.mediaId);
          if (m.kind === 'image' && !info.value[m.mediaId].posterUrl) void imageThumb(md.blob, m.mediaId);
        }
      }
    }
  },
  { immediate: true },
);

// Generate a video poster through the SHARED, concurrency-bounded helper (spec
// 2002) instead of a bespoke per-cell <video> — so a media grid full of videos
// can't spin up a decoder per cell at once — and PERSIST it (posterBlob) so it's
// produced once and reused, here and in the chat view.
async function poster(blob: Blob, mediaId: string): Promise<void> {
  const dataUrl = await generateVideoPoster(blob);
  if (!dataUrl) return;
  info.value[mediaId] = { ...info.value[mediaId], posterUrl: dataUrl };
  try {
    const md = await get<Media>('media', mediaId);
    if (md && !md.posterBlob) {
      md.posterBlob = await (await fetch(dataUrl)).blob();
      md.updatedAt = Date.now();
      await put('media', md);
    }
  } catch {
    /* best-effort cache */
  }
}

// Small image thumbnail for the grid (the cells are tiny) so it doesn't decode the
// full-resolution photo per cell. Persisted as posterBlob, shared with the chat view.
async function imageThumb(blob: Blob, mediaId: string): Promise<void> {
  const thumb = await generateImageThumb(blob);
  if (!thumb) return;
  info.value[mediaId] = { ...info.value[mediaId], posterUrl: URL.createObjectURL(thumb) };
  try {
    const md = await get<Media>('media', mediaId);
    if (md && !md.posterBlob) {
      md.posterBlob = thumb;
      md.updatedAt = Date.now();
      await put('media', md);
    }
  } catch {
    /* best-effort cache */
  }
}

// Group media by month (newest-first), with "This month" for the current month.
const monthLabel = (ts: number): string => {
  const d = new Date(ts);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'This month';
  return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
};
const mediaGroups = computed(() => {
  const groups: Array<{ label: string; items: Message[] }> = [];
  for (const m of media.value) {
    const label = monthLabel(m.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(m);
    else groups.push({ label, items: [m] });
  }
  return groups;
});

const firstUrl = (body: string) => body.match(/\bhttps?:\/\/[^\s]+/i)?.[0] ?? body;
const docMeta = (m: Message) => {
  const size = m.mediaId && info.value[m.mediaId] ? '' : '';
  void size;
  return [m.mediaId && info.value[m.mediaId] ? info.value[m.mediaId].mime.split('/')[1] : 'file', formatStamp(m.timestamp)].join(' · ');
};
function openDoc(m: Message): void {
  const i = m.mediaId ? info.value[m.mediaId] : undefined;
  if (i) window.open(i.url, '_blank');
}

/* ---- viewer (media tab) ---- */
const viewer = ref<{ open: boolean; ids: string[]; start: number }>({ open: false, ids: [], start: 0 });
const viewerItems = computed(() =>
  viewer.value.ids
    .map((id) => media.value.find((m) => m.id === id))
    .filter((m): m is Message => !!m && !!m.mediaId && !!info.value[m.mediaId!])
    .map((m) => {
      const mi = info.value[m.mediaId!];
      return {
        id: m.id,
        url: mi.url,
        thumb: mi.posterUrl || mi.url,
        kind: mi.mime.startsWith('video/') ? 'video' : 'image',
        caption: m.body,
        senderName: m.outgoing ? 'You' : chat.value?.isGroup ? m.senderName : chat.value?.name ?? m.senderName,
        when: formatFull(m.timestamp),
        outgoing: m.outgoing,
        favorite: !!m.favorite,
        reactions: reactionGroups(m),
      };
    }),
);
function reactionGroups(m: Message): Array<{ emoji: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of m.reactions ?? []) map.set(r.emoji, (map.get(r.emoji) ?? 0) + 1);
  return [...map.entries()].map(([emoji, count]) => ({ emoji, count }));
}
function openViewer(id: string): void {
  const start = media.value.findIndex((m) => m.id === id);
  viewer.value = { open: true, ids: media.value.map((m) => m.id), start: Math.max(0, start) };
}
watch(viewerItems, (items) => {
  if (viewer.value.open && items.length === 0) viewer.value.open = false;
});

const react = (id: string, emoji: string) => void reactToMessage(id, emoji);
const fav = (id: string) => void toggleFavorite(id);
async function del(id: string): Promise<void> {
  const sheet = await actionSheetController.create({
    header: 'Delete this media?',
    buttons: [
      { text: 'Delete', role: 'destructive', handler: () => void deleteMessage(id) },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}
const forwardOpen = ref(false);
const forwardId = ref<string | null>(null);
function share(id: string): void {
  viewer.value.open = false;
  forwardId.value = id;
  forwardOpen.value = true;
}
async function onForwardSend(chatIds: string[]): Promise<void> {
  forwardOpen.value = false;
  if (forwardId.value && chatIds.length) await forwardMessage(forwardId.value, chatIds);
  forwardId.value = null;
}
async function caption(id: string): Promise<void> {
  const m = media.value.find((x) => x.id === id);
  const alert = await alertController.create({
    header: 'Caption',
    inputs: [{ name: 'cap', type: 'textarea', value: m?.body ?? '', placeholder: 'Add a caption', attributes: { maxlength: CAPTION_MAX } }],
    buttons: [
      { text: 'Cancel', role: 'cancel' as const },
      { text: 'Save', handler: (d: { cap?: string }) => void setCaption(id, (d?.cap ?? '').trim()) },
    ],
  });
  await alert.present();
}
const goChat = () => router.push(`/chat/${chatId}`);
</script>

<style scoped>
.month-head {
  padding: 12px 16px 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-muted);
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
}
.media-cell {
  position: relative;
  aspect-ratio: 1;
  border: none;
  padding: 0;
  background: var(--app-surface);
  cursor: pointer;
  overflow: hidden;
}
.media-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cell-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 26px;
  background: rgba(0, 0, 0, 0.42); /* scrim disc → legible on any thumbnail (spec 1007 FR-003) */
  border-radius: 50%;
  pointer-events: none;
}
.empty {
  text-align: center;
  margin-top: 40px;
}
</style>
