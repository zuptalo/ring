/**
 * Reactive Wall feed (spec 0003). One set of live queries (posts + contacts +
 * engagement) drives the whole feed: each post is enriched with its author identity,
 * an attachment object URL, grouped reactions, and its comments — so the feed can show
 * inline reactions and a comment preview without diving in. A 30s clock tick keeps the
 * "disappears in …" countdowns fresh. Ordering is by last activity (queries side), so
 * new posts and newly-interacted posts both rise to the top.
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useSelfProfile } from '@/composables/useSelfProfile';
import { listWallPosts, listContacts, listAllPostEngagement, getMedia, getWallMutedUsers, syncPosts } from '@/db/queries';
import { wallSyncedOnce } from '@/services/wall-load';
import { stopIfPlaying } from '@/composables/useAudioPlayer';
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
  album?: { url: string; kind: 'image' | 'video' | 'voice'; poster?: string }[]; // all media, for the inline feed gallery
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
  // For ALBUM posts (FR-019): every media resolved in order, so the feed can swipe the whole
  // gallery inline without diving into the post.
  const albumUrls = ref<Record<string, { url: string; kind: 'image' | 'video' | 'voice'; poster?: string }[]>>({});
  // `updatedAt` is in the key so a background-downloaded blob (which touches the post) re-runs
  // resolution — the post is on the Wall instantly via its poster, and each blob fills in after.
  watch(
    () => posts.value.map((p) => `${p.id}:${p.mediaId ?? ''}:${p.mediaIds?.length ?? 0}:${p.updatedAt}`).join('|'),
    async () => {
      const nextMedia: Record<string, string> = {};
      const nextPoster: Record<string, string> = {};
      const nextAlbum: Record<string, { url: string; kind: 'image' | 'video' | 'voice'; poster?: string }[]> = {};
      for (const p of posts.value) {
        if (!p.mediaId) continue;
        // Cover: reuse the full media URL once resolved; otherwise re-resolve so a freshly
        // downloaded blob is picked up. The poster is reused if already created.
        if (mediaUrls.value[p.id]) {
          nextMedia[p.id] = mediaUrls.value[p.id];
          if (posterUrls.value[p.id]) nextPoster[p.id] = posterUrls.value[p.id];
        } else {
          const md = await getMedia(p.mediaId);
          if (md?.blob) nextMedia[p.id] = URL.createObjectURL(md.blob);
          if (posterUrls.value[p.id]) nextPoster[p.id] = posterUrls.value[p.id];
          else {
            const poster = md?.posterBlob ?? md?.posterGrid;
            if (poster) nextPoster[p.id] = URL.createObjectURL(poster);
          }
        }
        // Album (2+ items): reuse when every item already has its full blob; otherwise resolve
        // per-item — keep an item that already has a URL (so a playing clip isn't recreated) and
        // resolve the rest, rendering from the poster (empty url) while the blob streams in.
        if (p.mediaIds && p.mediaIds.length > 1) {
          const prev = albumUrls.value[p.id];
          if (prev && prev.length === p.mediaIds.length && prev.every((it) => it.url)) {
            nextAlbum[p.id] = prev;
          } else {
            const items: { url: string; kind: 'image' | 'video' | 'voice'; poster?: string }[] = [];
            for (let k = 0; k < p.mediaIds.length; k++) {
              const cached = prev?.[k];
              if (cached?.url) {
                items.push(cached);
                continue;
              }
              const md = await getMedia(p.mediaIds[k]);
              if (!md) continue;
              const kind = md.kind === 'video' ? 'video' : md.kind === 'voice' ? 'voice' : 'image';
              const posterBlob = kind === 'video' ? (md.posterBlob ?? md.posterGrid) : undefined;
              items.push({
                url: md.blob ? URL.createObjectURL(md.blob) : '',
                kind,
                poster: cached?.poster ?? (posterBlob ? URL.createObjectURL(posterBlob) : undefined),
              });
            }
            if (items.length) nextAlbum[p.id] = items;
          }
        }
      }
      // Revoke per-URL (not per-post), so URLs reused above survive while truly-dropped ones go.
      const live = new Set<string>();
      for (const u of Object.values(nextMedia)) live.add(u);
      for (const u of Object.values(nextPoster)) live.add(u);
      for (const items of Object.values(nextAlbum))
        for (const it of items) {
          if (it.url) live.add(it.url);
          if (it.poster) live.add(it.poster);
        }
      // If a URL we're about to revoke is the one the floating audio player is playing (e.g. a
      // voice post just got deleted/expired mid-playback), stop + dismiss the player first so it
      // doesn't linger over a dead blob.
      for (const u of Object.values(mediaUrls.value))
        if (!live.has(u)) {
          stopIfPlaying(u);
          URL.revokeObjectURL(u);
        }
      for (const u of Object.values(posterUrls.value)) if (!live.has(u)) URL.revokeObjectURL(u);
      for (const items of Object.values(albumUrls.value))
        for (const it of items) {
          if (it.url && !live.has(it.url)) {
            stopIfPlaying(it.url);
            URL.revokeObjectURL(it.url);
          }
          if (it.poster && !live.has(it.poster)) URL.revokeObjectURL(it.poster);
        }
      mediaUrls.value = nextMedia;
      posterUrls.value = nextPoster;
      albumUrls.value = nextAlbum;
    },
    { immediate: true },
  );
  onUnmounted(() => {
    for (const url of Object.values(mediaUrls.value)) URL.revokeObjectURL(url);
    for (const url of Object.values(posterUrls.value)) URL.revokeObjectURL(url);
    for (const items of Object.values(albumUrls.value))
      for (const it of items) {
        URL.revokeObjectURL(it.url);
        if (it.poster) URL.revokeObjectURL(it.poster);
      }
  });

  const wall = computed<WallPost[]>(() => {
    const byId = new Map(contacts.value.map((c) => [c.id, c]));
    const nameOf = (id: string) => (id === selfId ? 'You' : byId.get(id)?.name ?? 'Someone');
    // A game post carries its host's display info sealed with the game — use it
    // when the author isn't resolvable as a contact (spec 0009).
    const gameHostName = (p: Post) => (p.game?.hostName ? p.game.hostName : undefined);
    const gameHostAvatar = (p: Post) => (p.game?.hostAvatar ? p.game.hostAvatar : undefined);

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

      // Audience members aren't necessarily each other's contacts (the audience
      // is the AUTHOR's friend list) — resolve names/avatars through the sealed
      // self-declared meta too: the comment's own (new rows), or the game
      // payloads (host/accept) for players on a challenge post. Contacts win.
      const gameMeta = new Map<string, { name?: string; avatar?: string }>();
      if (p.game?.hostName || p.game?.hostAvatar) gameMeta.set(p.author, { name: p.game.hostName, avatar: p.game.hostAvatar });
      for (const e of es) {
        if (e.type === 'game' && e.game?.t === 'accept' && (e.game.name || e.game.avatar)) {
          gameMeta.set(e.actor, { name: e.game.name, avatar: e.game.avatar });
        }
      }
      const avatarOf = (id: string) => (id === selfId ? self.avatar.value : byId.get(id)?.avatar ?? '');
      const comments = es
        .filter((e) => e.type === 'comment' && !e.deleted)
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
        .map((cm) => ({
          id: cm.id,
          actor: cm.actor,
          authorName:
            cm.actor === selfId
              ? 'You'
              : byId.get(cm.actor)?.name ?? cm.actorName ?? gameMeta.get(cm.actor)?.name ?? 'Someone',
          authorAvatar: avatarOf(cm.actor) || cm.actorAvatar || gameMeta.get(cm.actor)?.avatar || '',
          text: cm.text ?? '',
          at: cm.at,
        }));

      return {
        ...p,
        isOwn,
        authorName: isOwn ? 'You' : c?.name ?? gameHostName(p) ?? 'Unknown',
        authorAvatar: isOwn ? self.avatar.value : c?.avatar || gameHostAvatar(p) || '',
        authorUsername: isOwn ? undefined : c?.username,
        muted: !!mutedUsers.value[p.author],
        mediaUrl: mediaUrls.value[p.id],
        posterUrl: posterUrls.value[p.id],
        album: albumUrls.value[p.id],
        reactions,
        myEmojis,
        comments,
        commentCount: comments.length,
      };
    });
  });

  // Pull from the server whenever the Wall is opened (cursor-based, so it only fetches what's
  // new). This also guarantees `wallSyncedOnce` flips — dropping the first-load spinner — even
  // if the global sync loop hasn't fired yet for this session.
  let firstSyncFailsafe: number | undefined;
  onMounted(() => {
    void syncPosts();
    // Failsafe so the loader can NEVER spin forever: syncPosts flips `wallSyncedOnce` in its
    // finally, but it early-returns (skipping that) while the keystore is still settling at
    // mount, and a request can also stall. After a short grace period, resolve the spinner
    // regardless — any real posts still stream in via the live query once a sync lands.
    firstSyncFailsafe = window.setTimeout(() => {
      wallSyncedOnce.value = true;
    }, 5000);
  });
  onUnmounted(() => {
    if (firstSyncFailsafe) clearTimeout(firstSyncFailsafe);
  });

  // `loaded` flips true after the first query resolves, so the UI can avoid flashing
  // the empty state / "New post" button before posts have loaded. `synced` flips true after
  // the first server sync attempt — distinguishing "still pulling" (spinner) from "really
  // empty" (the empty state) on a fresh device.
  return { wall, now, loaded: posts.loaded, synced: wallSyncedOnce };
}
