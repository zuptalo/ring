<template>
  <!-- Renders a run of text with inline animated Noto emoji, the same way chat message
       bodies do: split into plain-text + emoji segments and render each emoji with
       <AnimatedEmoji>. Used for Wall post bodies and comments so their emoji match the
       rest of the app (animated, self-hosted, animation-pref aware). Detected phone
       numbers / email addresses render as tappable entities (spec 1029). -->
  <span class="emoji-text" dir="auto" :class="{ 'emoji-only': isBig }"><template
    v-for="(p, i) in parts"
    :key="i"
  ><a
      v-if="p.contact"
      class="entity-link"
      role="button"
      :href="p.contact.kind === 'phone' ? telHref(p.contact.raw) : mailtoHref(p.contact.raw)"
      @click.stop.prevent="presentEntityActions(p.contact)"
    >{{ p.contact.raw }}</a><animated-emoji
      v-else-if="p.emoji"
      :emoji="p.emoji"
      :animate="animEmoji"
      :large="isBig"
    /><template v-else>{{ p.text }}</template></template></span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';
import { segmentEmoji, emojiOnlyCount } from '@/utils/emoji';
import { segmentContacts, telHref, mailtoHref } from '@/utils/linkify';
import { presentEntityActions, type ContactEntity } from '@/services/entity-actions';
import { useAnimationPrefs } from '@/composables/useAnimationPrefs';

// `big`: when set, a text that is ONLY emoji (≤3) renders enlarged, matching how chat
// renders short emoji-only messages. Off for compact contexts (feed rows, comments).
const props = withDefaults(defineProps<{ text: string; big?: boolean }>(), { big: false });

const { animEmoji } = useAnimationPrefs();

interface Part {
  text?: string;
  emoji?: string;
  contact?: ContactEntity;
}
// Detect phone/email first (spec 1029), then emoji-segment the plain runs between
// them. Token-based like the chat renderer, so it stays injection-safe.
const parts = computed<Part[]>(() => {
  const out: Part[] = [];
  for (const cs of segmentContacts(props.text)) {
    if ('kind' in cs) {
      out.push({ contact: cs });
      continue;
    }
    for (const seg of segmentEmoji(cs.text)) {
      if (seg.emoji) out.push({ emoji: seg.emoji });
      else if (seg.text) out.push({ text: seg.text });
    }
  }
  return out;
});
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
/* Tappable phone/email (spec 1029) — matches the app's link accent. */
.entity-link {
  color: var(--ring-accent, var(--ion-color-primary));
  cursor: pointer;
}
</style>
