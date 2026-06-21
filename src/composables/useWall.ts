/**
 * Reactive Wall feed (spec 0003, US3). Live-queries the local `posts` store and
 * hydrates each post's author identity (avatar/name/username) from contacts — "You"
 * for own posts. Reactive via the idb change bus, so a newly received or composed
 * post appears without a manual refresh.
 */
import { computed } from 'vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useSelfProfile } from '@/composables/useSelfProfile';
import { listWallPosts, listContacts } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import type { Post, Contact } from '@/db/types';

export interface WallPost extends Post {
  isOwn: boolean;
  authorName: string;
  authorAvatar: string;
  authorUsername?: string;
}

export function useWall() {
  const posts = useLiveQuery(() => listWallPosts(), ['posts'], [] as Post[]);
  const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);
  const self = useSelfProfile();
  const selfId = getSelfUserId();

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
      };
    });
  });

  return { wall };
}
