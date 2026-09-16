<template>
  <img
    v-if="!nativeFallback"
    class="noto-emoji"
    :src="src"
    :alt="emoji"
    draggable="false"
    decoding="async"
    :loading="eager ? 'eager' : 'lazy'"
    :fetchpriority="eager ? 'high' : 'auto'"
    @error="onError"
  />
  <span v-else class="noto-emoji-native">{{ emoji }}</span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { emojiCodepoints, nextEmojiAttempt, EMOJI_ATTEMPT_NATIVE } from '@/utils/emoji';

/**
 * A single emoji at PILL SIZE — reaction chips, the quick-react bar, audience rows —
 * drawn from the Noto set via our own cached proxy (/v1/emoji/...), never a third-party
 * CDN, so emoji use and the user's IP don't leak. Falls back to the platform's native
 * glyph when Noto has no asset. The attempt/fallback logic lives as pure helpers in
 * @/utils/emoji so it can be unit-tested without a DOM.
 *
 * STATIC BY DESIGN (spec 1066). This component renders `emoji.svg`, not the animated
 * `512.webp` it used to. Every one of its call sites draws at roughly 1.2em (~23 px),
 * where the animation is imperceptible but its cost is not: the animated WebP is a
 * 512x512 sheet — 624 KB for a single 😂, 1.78 MB for the default quick-react set —
 * and it re-decodes every frame at full resolution on the main thread before
 * downscaling, so a history full of reaction pills decoded continuously while
 * scrolling. The same upstream serves the identical artwork as vector at ~1/80th the
 * bytes; it rasterises once at display size, and it EXISTS for emoji the animated set
 * omits entirely (flags, ZWJ sequences), which used to fall through to the platform
 * glyph. So this is cheaper and covers more.
 *
 * Emoji that are genuinely meant to move — message bodies, emoji-only messages, emoji
 * avatars — go through <AnimatedEmoji>, which plays the Lottie and honours the
 * Appearance → Animations → Emoji preference. This component deliberately does NOT
 * read that preference: it never animates, so the setting has nothing to say about it,
 * and not reading it avoids four IndexedDB-backed live queries per rendered pill.
 */
const props = withDefaults(defineProps<{ emoji: string; eager?: boolean }>(), { eager: false });

// 0 = full codepoint sequence, 1 = retry without the FE0F variation selector,
// EMOJI_ATTEMPT_NATIVE = give up and render the native glyph (Noto has no asset for it).
const attempt = ref(0);
const nativeFallback = computed(() => attempt.value >= EMOJI_ATTEMPT_NATIVE);

const src = computed(() => {
  const cp = emojiCodepoints(props.emoji, attempt.value === 1);
  // Self-hosted: proxied + cached by our own server (never a third-party CDN).
  return `/v1/emoji/${cp}/emoji.svg`;
});

const onError = (): void => {
  attempt.value = nextEmojiAttempt(props.emoji, attempt.value);
};
watch(
  () => props.emoji,
  () => {
    attempt.value = 0;
  },
);
</script>

<style scoped>
.noto-emoji {
  width: 1.2em;
  height: 1.2em;
  vertical-align: -0.2em;
  object-fit: contain;
}
.noto-emoji-native {
  font-style: normal;
}
</style>
