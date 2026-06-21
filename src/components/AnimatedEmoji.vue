<template>
  <span ref="rootEl" class="aemoji" :class="{ large }">
    <span ref="anchor" class="aemoji-anim" aria-hidden="true" />
    <span v-if="showNative" class="aemoji-native">{{ emoji }}</span>
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * An emoji that plays its Noto Lottie animation in a continuous loop WHILE it is
 * visible on screen, and PAUSES the moment it scrolls off — so a long feed full of
 * animated emoji only ever animates the handful actually in view (bounded CPU). The
 * Lottie is served from our own server's cached proxy (/v1/emoji/...), never a
 * third-party CDN. Falls back to the native glyph when animation is off, the emoji has
 * no Noto Lottie, or the server can't reach it.
 *
 * (`plays` is accepted but ignored — playback is now visibility-driven, not count-
 * capped — so existing callers don't break.)
 */
const props = withDefaults(
  defineProps<{ emoji: string; animate?: boolean; large?: boolean; plays?: number }>(),
  { animate: true, large: false, plays: 3 },
);

const rootEl = ref<HTMLElement>();
const anchor = ref<HTMLElement>();
const showNative = ref(true); // native glyph shows until (and unless) Lottie loads

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let anim: any = null;
let observer: IntersectionObserver | null = null;
let loading = false;
let visible = false;

function codepoints(): string {
  return [...props.emoji].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join('_');
}

// Lazily load the Lottie on first visibility, then loop it. Subsequent visibility
// changes just resume/pause the already-loaded animation.
async function ensureLoaded(): Promise<void> {
  if (anim || loading || !props.animate || !anchor.value) return;
  loading = true;
  try {
    // Self-hosted: proxied + cached by our own server (never a third-party CDN).
    const res = await fetch(`/v1/emoji/${codepoints()}/lottie.json`);
    if (!res.ok) return; // no Noto animation → keep the native glyph
    const data = await res.json();
    // lottie_light has no expression engine (no eval, smaller), fine for Noto.
    const lottie = (await import('lottie-web/build/player/lottie_light')).default;
    anim = lottie.loadAnimation({
      container: anchor.value,
      renderer: 'svg',
      loop: true,
      autoplay: false,
      animationData: data,
    });
    showNative.value = false;
    if (visible) anim.play(); // it became (or stayed) visible while loading
  } catch {
    /* keep the native glyph */
  } finally {
    loading = false;
  }
}

function setVisible(on: boolean): void {
  visible = on;
  if (on) {
    void ensureLoaded();
    anim?.play();
  } else {
    anim?.pause();
  }
}

onMounted(() => {
  if (!props.animate) return;
  if (!('IntersectionObserver' in window)) {
    setVisible(true); // no IO → just play (rare/legacy)
    return;
  }
  // Keep observing (don't disconnect) so the emoji pauses/resumes as it scrolls in
  // and out of view, not just on the first appearance.
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) setVisible(e.isIntersecting);
    },
    { threshold: 0.1 },
  );
  if (rootEl.value) observer.observe(rootEl.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  anim?.destroy?.();
});
</script>

<style scoped>
.aemoji {
  position: relative;
  display: inline-block;
  width: 1.3em;
  height: 1.3em;
  vertical-align: -0.25em;
}
.aemoji.large {
  width: 2.6em;
  height: 2.6em;
  vertical-align: -0.4em;
}
.aemoji-anim {
  position: absolute;
  inset: 0;
}
.aemoji-anim :deep(svg) {
  width: 100% !important;
  height: 100% !important;
}
.aemoji-native {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-style: normal;
  line-height: 1;
}
.aemoji.large .aemoji-native {
  font-size: 2em;
}
</style>
