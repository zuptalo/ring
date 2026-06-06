<template>
  <span ref="rootEl" class="aemoji" :class="{ large }">
    <span ref="anchor" class="aemoji-anim" aria-hidden="true" />
    <span v-if="showNative" class="aemoji-native">{{ emoji }}</span>
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * An emoji that plays its Noto Lottie animation a few times when it scrolls into
 * view, then freezes. The Lottie is served from our own server's cached proxy
 * (/v1/emoji/...), never a third-party CDN. Falls back to the native glyph when
 * animation is off, the emoji has no Noto Lottie, or the server can't reach it.
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
let started = false;

function codepoints(): string {
  return [...props.emoji].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join('_');
}

async function play(): Promise<void> {
  if (started || !props.animate || !anchor.value) return;
  started = true;
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
      autoplay: true,
      animationData: data,
    });
    showNative.value = false;
    let loops = 0;
    anim.addEventListener('loopComplete', () => {
      loops += 1;
      if (loops >= props.plays) anim.pause(); // freeze on the final frame
    });
  } catch {
    /* keep the native glyph */
  }
}

onMounted(() => {
  if (!props.animate) return;
  if (!('IntersectionObserver' in window)) {
    void play();
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          void play();
          observer?.disconnect();
          observer = null;
        }
      }
    },
    { threshold: 0.5 },
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
