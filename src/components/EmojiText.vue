<template>
  <!-- Renders a run of text with inline animated Noto emoji, the same way chat message
       bodies do: split into plain-text + emoji segments and render each emoji with
       <AnimatedEmoji>. Used for Wall post bodies and comments so their emoji match the
       rest of the app (animated, self-hosted, animation-pref aware). -->
  <span class="emoji-text" dir="auto" :class="{ 'emoji-only': isBig }"><template
    v-for="(p, i) in parts"
    :key="i"
  ><animated-emoji
      v-if="p.emoji"
      :emoji="p.emoji"
      :animate="animEmoji"
      :large="isBig"
    /><template v-else>{{ p.text }}</template></template></span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';
import { segmentEmoji, emojiOnlyCount } from '@/utils/emoji';
import { useAnimationPrefs } from '@/composables/useAnimationPrefs';

// `big`: when set, a text that is ONLY emoji (≤3) renders enlarged, matching how chat
// renders short emoji-only messages. Off for compact contexts (feed rows, comments).
const props = withDefaults(defineProps<{ text: string; big?: boolean }>(), { big: false });

const { animEmoji } = useAnimationPrefs();
const parts = computed(() => segmentEmoji(props.text));
const isBig = computed(() => {
  if (!props.big) return false;
  const n = emojiOnlyCount(props.text);
  return n > 0 && n <= 3;
});
</script>

<style scoped>
.emoji-text {
  white-space: pre-wrap;
}
.emoji-text.emoji-only {
  font-size: 2em;
}
</style>
