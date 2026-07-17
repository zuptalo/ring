<!--
  An animated image (GIF / animated WebP) in a chat bubble that plays ONLY while it is
  visible on screen. An `<img>` whose src is an animated file autoplays and loops with
  no JS control, and continues decoding off-screen; to honour "play when visible" we
  swap the src to a static poster whenever the bubble scrolls out of view (which freezes
  it) and back to the moving original when it returns (a GIF/WebP restarts from frame 0
  when its src is re-set, so it visibly autoplays again).

  Mirrors the IntersectionObserver visibility pattern used by VideoNote/AnimatedEmoji.
  Falls back gracefully: with no poster it just keeps the original (still animates); with
  no original (the full blob was evicted from the LRU) it shows the poster.
-->
<template>
  <img
    ref="el"
    class="bubble-image"
    :src="shownUrl"
    :alt="alt"
    decoding="async"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps<{
  animatedUrl?: string; // the moving original (GIF / animated WebP) blob URL
  posterUrl?: string; // a static first-frame poster to freeze on while off-screen
  alt?: string;
}>();

const el = ref<HTMLImageElement | null>(null);
const visible = ref(false);
let io: IntersectionObserver | undefined;

// Visible → the animated source (plays); off-screen → the static poster (frozen). Each
// branch falls back to the other url so a missing poster or evicted original still renders.
const shownUrl = computed(() =>
  visible.value
    ? props.animatedUrl ?? props.posterUrl ?? ''
    : props.posterUrl ?? props.animatedUrl ?? '',
);

onMounted(() => {
  if (!el.value) return;
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) visible.value = e.isIntersecting;
    },
    // A small threshold so it starts playing as soon as it scrolls meaningfully into
    // view and freezes once it leaves — matching AnimatedEmoji's gentle trigger.
    { threshold: 0.1 },
  );
  io.observe(el.value);
});
onBeforeUnmount(() => io?.disconnect());
</script>
