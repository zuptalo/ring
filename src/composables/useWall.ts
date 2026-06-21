/**
 * Reactive Wall feed (spec 0003). One set of live queries (posts + contacts +
 * engagement) drives the whole feed: each post is enriched with its author identity,
 * an attachment object URL, grouped reactions, and its comments — so the feed can show
 * inline reactions and a comment preview without diving in. A 30s clock tick keeps the
 * "disappears in …" countdowns fresh. Ordering is by last activity (queries side), so
 * new posts and newly-interacted posts both rise to the top.
 */
import { computed, ref, watch, onUnmounted } from 'vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useSelfProfile } from '@/composables/useSelfProfile';
import { listWallPosts, listContacts, listAllPostEngagement, getMedia } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import type { Post, Contact, PostEngagement } from '@/db/types';

export interface ReactionGroup {
  emoji: string;
  count: number;
  mine: boolean;
}
export interface CommentView {
  id: string;
  actor: string;
  authorName: string;
  text: string;
  at: number;
}
export interface WallPost extends Post {
  isOwn: boolean;
  authorName: string;
  authorAvatar: string;
  authorUsername?: string;
  mediaUrl?: string;
  reactions: ReactionGroup[];
  myEmojis: string[];
  comments: CommentView[];
  commentCount: number;
}

export function useWall() {
  const posts = useLiveQuery(() => listWallPosts(), ['posts'], [] as Post[]);
  const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);
  const engagement = useLiveQuery(() => listAllPostEngagement(), ['postEngagement'], [] as PostEngagement[]);
  const self = useSelfProfile();
  const selfId = getSelfUserId();

  // Live clock for the countdowns (cheap; 30s granularity is plenty for hours-scale).
  const now = ref(Date.now());
  const tick = setInterval(() => (now.value = Date.now()), 30_000);
  onUnmounted(() => clearInterval(tick));

  // Media object URLs by post id (created/revoked as posts come and go).
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
    const nameOf = (id: string) => (id === selfId ? 'You' : byId.get(id)?.name ?? 'Someone');

    // Group engagement by post in one pass.
    const byPost = new Map<string, PostEngagement[]>();
    for (const e of engagement.value) {
      const list = byPost.get(e.postId) ?? [];
      list.push(e);
      byPost.set(e.postId, list);
    }

    return posts.value.map((p) => {
      const isOwn = p.author === selfId;
      const c = byId.get(p.author);
      const es = byPost.get(p.id) ?? [];

      const reactionRows = es.filter((e) => e.type === 'reaction' && !e.deleted && e.emoji);
      const rmap = new Map<string, { count: number; mine: boolean }>();
      for (const r of reactionRows) {
        const g = rmap.get(r.emoji!) ?? { count: 0, mine: false };
        g.count += 1;
        if (r.actor === selfId) g.mine = true;
        rmap.set(r.emoji!, g);
      }
      const reactions = [...rmap.entries()].map(([emoji, g]) => ({ emoji, ...g }));
      const myEmojis = reactionRows.filter((r) => r.actor === selfId).map((r) => r.emoji!);

      const comments = es
        .filter((e) => e.type === 'comment' && !e.deleted)
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
        .map((cm) => ({ id: cm.id, actor: cm.actor, authorName: nameOf(cm.actor), text: cm.text ?? '', at: cm.at }));

      return {
        ...p,
        isOwn,
        authorName: isOwn ? 'You' : c?.name ?? 'Unknown',
        authorAvatar: isOwn ? self.avatar.value : c?.avatar ?? '',
        authorUsername: isOwn ? undefined : c?.username,
        mediaUrl: mediaUrls.value[p.id],
        reactions,
        myEmojis,
        comments,
        commentCount: comments.length,
      };
    });
  });

  return { wall, now };
}
