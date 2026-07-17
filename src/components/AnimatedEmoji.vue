<template>
  <span ref="rootEl" class="aemoji" :class="{ large }">
    <span ref="anchor" class="aemoji-anim" v-show="!atRest" aria-hidden="true" />
    <span v-if="showNative || atRest" class="aemoji-native">{{ emoji }}</span>
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { loadEmojiLottie } from '@/services/emoji-cache';

/**
 * An emoji that plays its Noto Lottie animation in a continuous loop WHILE it is
 * visible on screen, and PAUSES the moment it scrolls off — so a long feed full of
 * animated emoji only ever animates the handful actually in view (bounded CPU). The
 * Lottie is served from our own server's cached proxy (/v1/emoji/...), never a
 * third-party CDN. Falls back to the native glyph when animation is off, the emoji has
 * no Noto Lottie, or the server can't reach it.
 *
 * `plays` caps how many loops run (spec 0008 FR-027/FR-028: emoji avatars play
 * a configured number of times). Unset = loop forever while visible (the
 * pre-existing behaviour for every caller that doesn't pass it). Once the cap
 * is reached the animation RESTS ON THE NATIVE GLYPH — the fully-formed emoji.
 * (It used to park on the Lottie's first frame, but many Noto emoji fly their
 * art IN and OUT of the canvas — the running-shoe's first AND last frames sit
 * off-screen — so no single Lottie frame is a safe resting pose; parking there
 * left a blank disc. The native glyph always shows the emoji.) Raising/clearing
 * `plays` later (an unread chat re-demanding attention) resumes the loop.
 */
const props = withDefaults(
  defineProps<{ emoji: string; animate?: boolean; large?: boolean; plays?: number }>(),
  { animate: true, large: false, plays: undefined },
);

const rootEl = ref<HTMLElement>();
const anchor = ref<HTMLElement>();
const showNative = ref(true); // native glyph shows until (and unless) Lottie loads
const atRest = ref(false); // play cap reached → rest on the native glyph (see loopComplete)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let anim: any = null;
let observer: IntersectionObserver | null = null;
let loading = false;
let visible = false;
let loopsDone = 0;
let finished = false; // plays cap reached → rest on the native glyph

function codepoints(): string {
  return [...props.emoji].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join('_');
}

// Lazily load the Lottie on first visibility, then loop it. Subsequent visibility
// changes just resume/pause the already-loaded animation.
async function ensureLoaded(): Promise<void> {
  if (anim || loading || finished || !props.animate || !anchor.value) return;
  loading = true;
  try {
    // Self-hosted proxy, cached in-memory per session (spec 1017) + persistently by the service
    // worker — so a repeat view of the same emoji never refetches. null = no Noto animation.
    const data = await loadEmojiLottie(codepoints());
    if (!data) return; // no Noto animation (or fetch failed) → keep the native glyph
    // lottie_light has no expression engine (no eval, smaller), fine for Noto.
    const lottie = (await import('lottie-web/build/player/lottie_light')).default;
    anim = lottie.loadAnimation({
      container: anchor.value,
      renderer: 'svg',
      loop: true,
      autoplay: false,
      animationData: data,
    });
    // Bounded playback (spec 0008 FR-027/FR-028): after `plays` full loops,
    // rest on the native glyph. The Lottie stays loaded (so raising `plays`
    // resumes instantly) but is hidden via `atRest`, because its frames are not
    // a reliable resting pose — a fly-in/out emoji is off-canvas at both ends.
    // Registered unconditionally: `plays` can appear/clear later (an unread
    // chat re-demanding attention), and the counter must not miss loops.
    anim.addEventListener('loopComplete', () => {
      loopsDone += 1;
      if (props.plays !== undefined && loopsDone >= props.plays) {
        finished = true;
        atRest.value = true;
        anim?.pause?.();
      }
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
    if (!finished) anim?.play(); // at rest → stay parked on the native glyph
  } else {
    anim?.pause();
  }
}

// A raised/cleared cap re-earns playback: an unread chat flips `plays` to
// unlimited and the resting avatar starts moving again (FR-028); read → the
// cap returns and the NEXT loopComplete parks it back on the native glyph.
watch(
  () => props.plays,
  (next) => {
    if (!finished) return;
    if (next === undefined || loopsDone < next) {
      finished = false;
      atRest.value = false; // un-hide the Lottie; it takes over from the native glyph again
      if (visible) {
        void ensureLoaded();
        anim?.play();
      }
    }
  },
);

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
