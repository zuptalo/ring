<template>
  <!-- Drop-in replacement for an avatar <img> (spec 0008 FR-027): when the
       source is an emoji profile picture (emojiAvatar's SVG with the emoji
       embedded), render the SAME coloured disc with the LIVE emoji on top —
       animated twice, then at rest — instead of the static picture. Any other
       source (photos, initials, groups) renders exactly as before. Sized by
       the parent (ion-avatar or a styled container), like the <img> it
       replaces; surfaces not yet swept keep showing the static disc. -->
  <span v-if="emoji" class="ua" :style="{ background: disc }" role="img" :aria-label="alt">
    <!-- :key remounts on emoji change — AnimatedEmoji renders a stale glyph if
         its emoji prop swaps in place (e.g. a contact photo override → reset). -->
    <animated-emoji :key="emoji" :emoji="emoji" :animate="anim.animate" :plays="anim.plays" class="ua-glyph" />
  </span>
  <img v-else :src="src" :alt="alt" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';
import { emojiOfAvatar, emojiDiscColor } from '@/db/avatars';
import { useAnimationPrefs, resolveAvatarAnimation } from '@/composables/useAnimationPrefs';

const props = withDefaults(
  defineProps<{
    src: string;
    alt?: string;
    /** The surface demands attention (an unread chat row): while the user's
     *  keep-animating-for-unread preference allows it, the loop cap lifts. */
    attention?: boolean;
  }>(),
  { alt: '', attention: false },
);

const { animEmoji, avatarLoops, avatarUnreadLoop } = useAnimationPrefs();
const emoji = computed(() => emojiOfAvatar(props.src));
const disc = computed(() => (emoji.value ? emojiDiscColor(emoji.value) : 'transparent'));
// FR-028: one pure resolver so every avatar surface animates identically.
const anim = computed(() =>
  resolveAvatarAnimation(animEmoji.value, avatarLoops.value, avatarUnreadLoop.value, props.attention),
);
</script>

<style scoped>
.ua {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  /* Avatars are circular on every Ring surface; the replaced <img> often got its
     rounding from per-site scoped CSS that can't reach into this component. */
  border-radius: 50%;
  /* Size the glyph from the disc itself (container query units), so the same
     component fits a 28px stack avatar and a 120px profile hero alike. */
  container-type: size;
}
.ua-glyph {
  /* AnimatedEmoji's box is 1.3em → ~68% of the disc height. */
  font-size: 52cqh;
  line-height: 1;
}
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* Same circular cutout as the emoji disc above: a PHOTO avatar must never
     render square just because a call site (a game seat chip, a new surface)
     didn't add its own rounding. Sites inside ion-avatar already clip round;
     doubling the radius is harmless. */
  border-radius: 50%;
}
</style>
