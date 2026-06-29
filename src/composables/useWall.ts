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
import { listWallPosts, listContacts, listAllPostEngagement, getMedia, getWallMutedUsers } from '@/db/queries';
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
  authorAvatar: string;
  text: string;
  at: number;
}
export interface WallPost extends Post {
  isOwn: boolean;
  authorName: string;
  authorAvatar: string;
  authorUsername?: string;
  muted: boolean; // author's Wall notifications are muted
  mediaUrl?: string; // full-resolution blob (video src; image fallback) — may be absent
  posterUrl?: string; // small poster tier — shows instantly so the feed never blanks (US1)
  reactions: ReactionGroup[];
  myEmojis: string[];
  comments: CommentView[];
  commentCount: number;
}

export function useWall() {
  // Depends on settings too: listWallPosts excludes hidden users (a settings ledger).
  const posts = useLiveQuery(() => listWallPosts(), ['posts', 'settings'], [] as Post[]);
  const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);
  const engagement = useLiveQuery(() => listAllPostEngagement(), ['postEngagement'], [] as PostEngagement[]);
  const mutedUsers = useLiveQuery(() => getWallMutedUsers(), ['settings'], {} as Record<string, boolean>);
  const self = useSelfProfile();
  const selfId = getSelfUserId();

  // Live clock for the countdowns (cheap; 30s granularity is plenty for hours-scale).
  const now = ref(Date.now());
  const tick = setInterval(() => (now.value = Date.now()), 30_000);
  onUnmounted(() => clearInterval(tick));

  // Media object URLs by post id (created/revoked as posts come and go). We resolve TWO
  // tiers: the small poster (shows instantly so the feed never flashes a blank tile — it
  // rode the sealed envelope, so it's local even before the full media downloads) and the
  // full blob (the video src; the image fallback when there's no poster).
  const mediaUrls = ref<Record<string, string>>({});
  const posterUrls = ref<Record<string, string>>({});
  watch(
    () => posts.value.map((p) => `${p.id}:${p.mediaId ?? ''}`).join('|'),
    async () => {
      const nextMedia: Record<string, string> = {};
      const nextPoster: Record<string, string> = {};
      for (const p of posts.value) {
        if (!p.mediaId) continue;
        // Reuse already-resolved URLs (both tiers were resolved together on a prior pass).
        if (mediaUrls.value[p.id] || posterUrls.value[p.id]) {
          if (mediaUrls.value[p.id]) nextMedia[p.id] = mediaUrls.value[p.id];
          if (posterUrls.value[p.id]) nextPoster[p.id] = posterUrls.value[p.id];
          continue;
        }
        const md = await getMedia(p.mediaId);
        if (md?.blob) nextMedia[p.id] = URL.createObjectURL(md.blob);
        const poster = md?.posterBlob ?? md?.posterGrid;
        if (poster) nextPoster[p.id] = URL.createObjectURL(poster);
      }
      for (const [pid, url] of Object.entries(mediaUrls.value)) {
        if (nextMedia[pid] !== url) URL.revokeObjectURL(url);
      }
      for (const [pid, url] of Object.entries(posterUrls.value)) {
        if (nextPoster[pid] !== url) URL.revokeObjectURL(url);
      }
      mediaUrls.value = nextMedia;
      posterUrls.value = nextPoster;
    },
    { immediate: true },
  );
  onUnmounted(() => {
    for (const url of Object.values(mediaUrls.value)) URL.revokeObjectURL(url);
    for (const url of Object.values(posterUrls.value)) URL.revokeObjectURL(url);
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

      const avatarOf = (id: string) => (id === selfId ? self.avatar.value : byId.get(id)?.avatar ?? '');
      const comments = es
        .filter((e) => e.type === 'comment' && !e.deleted)
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
        .map((cm) => ({
          id: cm.id,
          actor: cm.actor,
          authorName: nameOf(cm.actor),
          authorAvatar: avatarOf(cm.actor),
          text: cm.text ?? '',
          at: cm.at,
        }));

      return {
        ...p,
        isOwn,
        authorName: isOwn ? 'You' : c?.name ?? 'Unknown',
        authorAvatar: isOwn ? self.avatar.value : c?.avatar ?? '',
        authorUsername: isOwn ? undefined : c?.username,
        muted: !!mutedUsers.value[p.author],
        mediaUrl: mediaUrls.value[p.id],
        posterUrl: posterUrls.value[p.id],
        reactions,
        myEmojis,
        comments,
        commentCount: comments.length,
      };
    });
  });

  // `loaded` flips true after the first query resolves, so the UI can avoid flashing
  // the empty state / "New post" button before posts have loaded.
  return { wall, now, loaded: posts.loaded };
}
