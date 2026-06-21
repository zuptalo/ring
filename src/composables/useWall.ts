/**
 * Reactive Wall feed (spec 0003, US3). Live-queries the local `posts` store and
 * hydrates each post's author identity (avatar/name/username) from contacts — "You"
 * for own posts — plus an object URL for any attached photo/video/voice. Reactive via
 * the idb change bus, so a newly received or composed post appears without a refresh.
 */
import { computed, ref, watch, onUnmounted } from 'vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useSelfProfile } from '@/composables/useSelfProfile';
import { listWallPosts, listContacts, getMedia } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import type { Post, Contact } from '@/db/types';

export interface WallPost extends Post {
  isOwn: boolean;
  authorName: string;
  authorAvatar: string;
  authorUsername?: string;
  mediaUrl?: string;
}

export function useWall() {
  const posts = useLiveQuery(() => listWallPosts(), ['posts'], [] as Post[]);
  const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);
  const self = useSelfProfile();
  const selfId = getSelfUserId();

  // Resolve media blobs → object URLs, keyed by post id. Reused across re-renders;
  // URLs no longer referenced are revoked.
  const mediaUrls = ref<Record<string, string>>({});
  watch(
    () => posts.value.map((p) => `${p.id}:${p.mediaId ?? ''}`).join('|'),
    async () => {
      const next: Record<string, string> = {};
      for (const p of posts.value) {
        if (!p.mediaId) continue;
        if (mediaUrls.value[p.id]) {
          next[p.id] = mediaUrls.value[p.id];
          continue;
        }
        const md = await getMedia(p.mediaId);
        if (md?.blob) next[p.id] = URL.createObjectURL(md.blob);
      }
      for (const [pid, url] of Object.entries(mediaUrls.value)) {
        if (next[pid] !== url) URL.revokeObjectURL(url);
      }
      mediaUrls.value = next;
    },
    { immediate: true },
  );
  onUnmounted(() => {
    for (const url of Object.values(mediaUrls.value)) URL.revokeObjectURL(url);
  });

  const wall = computed<WallPost[]>(() => {
    const byId = new Map(contacts.value.map((c) => [c.id, c]));
    return posts.value.map((p) => {
      const isOwn = p.author === selfId;
      const c = byId.get(p.author);
      return {
        ...p,
        isOwn,
        authorName: isOwn ? 'You' : c?.name ?? 'Unknown',
        authorAvatar: isOwn ? self.avatar.value : c?.avatar ?? '',
        authorUsername: isOwn ? undefined : c?.username,
        mediaUrl: mediaUrls.value[p.id],
      };
    });
  });

  return { wall };
}
