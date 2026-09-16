/**
 * Chat media resolution: on-device Blobs → object URLs for rendering, with a bounded
 * LRU so a long, media-heavy chat never holds every decoded poster and blob URL at
 * once, plus the idle backfill that tiers legacy media.
 *
 * Lifted out of ChatDetailPage (specs 1005/1007/1014). Every object URL the chat
 * renders is minted here, which makes this the page's single largest source of
 * memory that must be handed back — and it was ~200 lines in the middle of a
 * 6,900-line component. Owning it here means the revoke-on-teardown lives beside
 * the allocate, instead of several hundred lines away from it.
 *
 * The caller supplies the two message sets as getters (the rendered window to
 * resolve and protect, and the chat's whole media set for the backfill) plus
 * whether its view is on screen; everything else is private.
 */
import { onUnmounted, ref, watch } from 'vue';
import { get, put } from '@/db/idb';
import { backfillThumbTiers } from '@/db/queries';
import { generateVideoPoster, generateImageThumb, isAnimatedImage } from '@/utils/media-meta';
import { readAudioTags } from '@/utils/id3';
import { selectEvictions } from '@/utils/lru';
import type { Media, Message } from '@/db/types';

/** One resolved media record: the tiers the chat, grid and viewer render. */
export interface MediaInfo {
  url?: string; // full-resolution original; undefined once freed to save space (spec 1014 FR-018)
  posterUrl?: string; // bubble tier (≤512) — chat bubble + viewer main fallback
  gridUrl?: string; // grid tier (≤320) — album grid cells (spec 1014)
  stripUrl?: string; // strip tier (≤128) — viewer bottom thumbnail strip (spec 1014)
  animated?: boolean; // GIF / animated WebP → bubble plays the moving original while visible
  mime: string;
  name: string;
}

export interface UseChatMediaOptions {
  /** The rendered window: resolved eagerly and never evicted. */
  visibleMessages: () => Message[];
  /** Every media message in the chat — the idle tier backfill's work list. */
  chatMediaMsgs: () => Message[];
  /** Whether the owning view is on screen; the backfill stops when it isn't. */
  viewActive: () => boolean;
}

export function useChatMedia(opts: UseChatMediaOptions) {
  const visibleMessages = { get value() { return opts.visibleMessages(); } };
  const chatMediaMsgs = { get value() { return opts.chatMediaMsgs(); } };
  const viewActive = { get value() { return opts.viewActive(); } };

  // Resolve on-device media (Blobs) to object URLs for rendering.
  const mediaInfo = ref<Record<string, MediaInfo>>({});
  // Resolved object URLs are bounded so a very long, media-heavy chat doesn't keep
  // every poster/cover decoded and every blob URL alive at once. We keep at most
  // MAX_MEDIA live, evicting the least-recently-used items that are neither on screen
  // nor pinned by an open viewer, and revoking their URLs. Far-scrolled media is
  // re-resolved lazily when it scrolls back (spec 1005 FR-003/004/005).
  const MAX_MEDIA = 60;
  const mediaLru: string[] = []; // mediaIds, least-recently-used first
  function touchMedia(id: string): void {
    const i = mediaLru.indexOf(id);
    if (i !== -1) mediaLru.splice(i, 1);
    mediaLru.push(id);
  }
  // Media ids the full-screen viewer is currently showing — never evict these while
  // it's open (it can swipe across all of the chat's media).
  const viewerPins = ref<Set<string>>(new Set());

  // The on-screen window (plus viewer pins) that eviction must never touch.
  function currentMediaKeep(): Set<string> {
    const keep = new Set<string>(viewerPins.value);
    for (const m of visibleMessages.value) if (m.mediaId) keep.add(m.mediaId);
    return keep;
  }

  // Resolve on-device media (Blobs) → object URLs for the GIVEN messages only — the
  // rendered window, or all chat media when the viewer opens — so opening a long
  // media chat doesn't eagerly decode every poster/cover up front. Already-resolved
  // items are just marked recently-used (reused, never recreated per render).
  async function resolveMediaFor(list: Message[]): Promise<void> {
    for (const m of list) {
      if (!m.mediaId) continue;
      if (mediaInfo.value[m.mediaId]) {
        touchMedia(m.mediaId);
        continue;
      }
      const media = await get<Media>('media', m.mediaId);
      if (!media) continue;
      const info: MediaInfo = {
        // undefined when the original was freed to save space (spec 1014 FR-018) — the bubble/grid
        // still render from the tiers below, and the viewer falls back to the thumb / placeholder.
        url: media.blob ? URL.createObjectURL(media.blob) : undefined,
        // Poster precedence: a persisted posterBlob, else the sender-embedded
        // posterData (a stable data URL). Feeding posterData into posterUrl means the
        // viewer, bottom slider and Media grid (which read posterUrl, not the message)
        // show a video's thumbnail too — not just the chat bubble (spec 1007 FR-001).
        posterUrl: media.posterBlob
          ? URL.createObjectURL(media.posterBlob)
          : m.kind === 'video'
            ? m.posterData
            : undefined,
        // Right-sized tiers for the grid (320) and strip (128); fall back to the bubble
        // tier (then resolved below for legacy media that predates the tiers). Spec 1014.
        gridUrl: media.posterGrid ? URL.createObjectURL(media.posterGrid) : undefined,
        stripUrl: media.posterStrip ? URL.createObjectURL(media.posterStrip) : undefined,
        mime: media.mime,
        name: media.name,
      };
      mediaInfo.value[m.mediaId] = info;
      touchMedia(m.mediaId);
      // Videos: prefer the sent thumbnail (m.posterData, a stable data URL).
      // Otherwise derive one from the first frame and PERSIST it (posterBlob) so it
      // isn't regenerated/lost on every remount.
      if (m.kind === 'video' && !info.posterUrl && !m.posterData && media.blob) {
        const blob = media.blob;
        const mid = m.mediaId;
        void generateVideoPoster(blob).then(async (poster) => {
          if (!poster || !mediaInfo.value[mid]) return; // evicted before it resolved
          mediaInfo.value[mid] = { ...mediaInfo.value[mid], posterUrl: poster };
          try {
            const md = await get<Media>('media', mid);
            if (md && !md.posterBlob) {
              md.posterBlob = await (await fetch(poster)).blob();
              md.updatedAt = Date.now();
              await put('media', md);
            }
          } catch {
            /* best-effort cache */
          }
        });
      }
      // Images: derive a small thumbnail (stored as posterBlob) the bubble/grid/strip
      // render instead of the full image, so scroll-back doesn't re-decode full-res
      // photos. The full image is still used in the viewer. Persist so it's one-time.
      if (m.kind === 'image' && !info.posterUrl && media.blob) {
        const blob = media.blob;
        const mid = m.mediaId;
        void generateImageThumb(blob).then(async (thumb) => {
          const info2 = mediaInfo.value[mid];
          if (!info2) return; // evicted before it resolved
          if (!thumb) {
            // Small image (or decode failed): the original IS the thumbnail — so the
            // bubble (which renders posterUrl) still has something light to show.
            mediaInfo.value[mid] = { ...info2, posterUrl: info2.url };
            return;
          }
          mediaInfo.value[mid] = { ...info2, posterUrl: URL.createObjectURL(thumb) };
          try {
            const md = await get<Media>('media', mid);
            if (md && !md.posterBlob) {
              md.posterBlob = thumb;
              md.updatedAt = Date.now();
              await put('media', md);
            }
          } catch {
            /* best-effort cache */
          }
        });
      }
      // Images: flag animated GIF / animated WebP so the bubble renders the moving
      // original (autoplaying while visible) instead of a static poster (spec: GIFs
      // autoplay in chat). Static images/photos keep the lightweight poster path.
      if (m.kind === 'image' && media.blob) {
        const blob = media.blob;
        const mid = m.mediaId;
        const mime = media.mime;
        void isAnimatedImage(mime, blob).then((animated) => {
          if (animated && mediaInfo.value[mid]) mediaInfo.value[mid] = { ...mediaInfo.value[mid], animated: true };
        });
      }
      // Audio (shared music): pull embedded cover art for the track card.
      if (m.kind === 'audio' && !info.posterUrl && media.blob) {
        const blob = media.blob;
        const mid = m.mediaId;
        void readAudioTags(blob).then((tags) => {
          if (tags.cover && mediaInfo.value[mid]) {
            mediaInfo.value[mid] = { ...mediaInfo.value[mid], posterUrl: URL.createObjectURL(tags.cover) };
          }
        });
      }
    }
  }

  // Spec 1014: idle, bounded backfill of this chat's media to the grid/strip tiers. Each slice
  // upgrades a handful of records and reschedules until the chat's media is fully tiered or we leave
  // the view, so it never competes with scroll/decoding on the hot path. Idempotent (already-tiered
  // records are skipped), so re-entering the chat just resumes where it left off.
  let thumbBackfillRunning = false;
  function scheduleThumbBackfill(): void {
    if (thumbBackfillRunning) return;
    thumbBackfillRunning = true;
    const idle = (cb: () => void): void => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
      if (ric) ric(cb);
      else window.setTimeout(cb, 400);
    };
    const tick = (): void => {
      if (!viewActive.value) {
        thumbBackfillRunning = false;
        return;
      }
      const ids = chatMediaMsgs.value.map((m) => m.mediaId).filter((id): id is string => !!id);
      void backfillThumbTiers(ids, 8).then((n) => {
        if (n > 0 && viewActive.value) idle(tick); // upgraded a batch — more may remain, keep nibbling
        else thumbBackfillRunning = false;
      });
    };
    idle(tick);
  }

  // Release least-recently-used media that's neither on screen nor pinned, revoking
  // its URLs so memory stays bounded in very long chats.
  function evictMedia(): void {
    if (mediaLru.length <= MAX_MEDIA) return; // nothing over the cap — skip the Set + scan
    const keep = currentMediaKeep();
    for (const id of selectEvictions(mediaLru, keep, MAX_MEDIA)) {
      const mi = mediaInfo.value[id];
      if (mi) {
        if (mi.url) URL.revokeObjectURL(mi.url);
        if (mi.posterUrl) URL.revokeObjectURL(mi.posterUrl);
        if (mi.gridUrl) URL.revokeObjectURL(mi.gridUrl);
        if (mi.stripUrl) URL.revokeObjectURL(mi.stripUrl);
        delete mediaInfo.value[id];
      }
      const i = mediaLru.indexOf(id);
      if (i !== -1) mediaLru.splice(i, 1);
    }
  }

  // Resolve media for the rendered window as it grows/changes (look-ahead paging
  // extends `visibleMessages` before the user reaches the top), then evict far LRU.
  // Keyed on the visible MEDIA SET (mediaIds), not the array identity — so a status
  // tick or reaction (which patches a row in place via useChatHistory) does NOT re-run
  // IndexedDB reads + URL allocation + eviction on the scroll hot path.
  watch(
    () => visibleMessages.value.map((m) => m.mediaId ?? '').join('|'),
    async () => {
      await resolveMediaFor(visibleMessages.value);
      evictMedia();
    },
    { immediate: true },
  );

  // Revoke every resolved object URL when leaving the chat so they don't leak across
  // chat opens (the cache only lives for this view).
  onUnmounted(() => {
    for (const mi of Object.values(mediaInfo.value)) {
      if (mi.url) URL.revokeObjectURL(mi.url);
      if (mi.posterUrl) URL.revokeObjectURL(mi.posterUrl);
      if (mi.gridUrl) URL.revokeObjectURL(mi.gridUrl);
      if (mi.stripUrl) URL.revokeObjectURL(mi.stripUrl);
    }
  });

  return { mediaInfo, viewerPins, resolveMediaFor, evictMedia, scheduleThumbBackfill };
}
