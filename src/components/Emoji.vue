<template>
  <img
    v-if="useImage"
    class="noto-emoji"
    :src="src"
    :alt="emoji"
    draggable="false"
    decoding="async"
    loading="lazy"
    @error="onError"
  />
  <span v-else class="noto-emoji-native">{{ emoji }}</span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAnimationPrefs } from '@/composables/useAnimationPrefs';
import { emojiCodepoints, nextEmojiAttempt, EMOJI_ATTEMPT_NATIVE } from '@/utils/emoji';

/**
 * Renders an emoji using the Noto emoji set, served from our own server's cached
 * proxy (/v1/emoji/...), never a third-party CDN, so emoji use and the user's IP
 * don't leak. If the emoji has no Noto asset (or the server can't reach it), it
 * falls back to the platform's native glyph. Animation respects the
 * Appearance, Animations, Emoji preference. The attempt/fallback logic lives as pure
 * helpers in @/utils/emoji so it can be unit-tested without a DOM.
 */
const props = withDefaults(defineProps<{ emoji: string; animated?: boolean }>(), { animated: true });

const { animEmoji } = useAnimationPrefs();

// 0 = full codepoint sequence, 1 = retry without the FE0F variation selector,
// EMOJI_ATTEMPT_NATIVE = give up and render the native glyph (Noto has no asset for it).
const attempt = ref(0);
const nativeFallback = computed(() => attempt.value >= EMOJI_ATTEMPT_NATIVE);
// When emoji animation is off, render the static native glyph instead of the
// (looping) Noto WebP.
const useImage = computed(() => animEmoji.value && !nativeFallback.value);

const src = computed(() => {
  const cp = emojiCodepoints(props.emoji, attempt.value === 1);
  // Self-hosted: proxied + cached by our own server (never a third-party CDN).
  return `/v1/emoji/${cp}/512.webp`;
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
