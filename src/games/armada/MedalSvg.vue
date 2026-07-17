<template>
  <!-- The war medal (spec 1038; port of the handoff's medalSVG): gold with red
       ribbons and a shine sweep for victory, muted iron for defeat. -->
  <div class="medal" :class="{ small }" aria-hidden="true">
    <svg viewBox="0 0 120 148" class="medal-base">
      <path d="M40 8 L60 78 L44 74 L34 92 L24 20 Z" :fill="won ? '#c33646' : '#4a4f58'" />
      <path d="M80 8 L60 78 L76 74 L86 92 L96 20 Z" :fill="won ? '#e0455a' : '#5a6069'" />
      <circle cx="60" cy="96" r="42" :fill="c3" />
      <circle cx="60" cy="96" r="42" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="2" />
    </svg>
    <div class="medal-disc" :style="{ background: `radial-gradient(circle at 38% 32%, ${c1}, ${c2} 62%, ${c3})` }">
      <svg viewBox="0 0 24 24" class="medal-star">
        <path
          d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.1 6.1 20.3l1.3-6.5L2.5 9.3l6.6-.8z"
          :fill="star"
          :opacity="won ? 1 : 0.55"
          :transform="won ? undefined : 'rotate(8 12 12)'"
        />
      </svg>
      <div v-if="won" class="medal-shine" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ won: boolean; small?: boolean }>(), { small: false });

const c1 = computed(() => (props.won ? '#ffd76b' : '#8a9099'));
const c2 = computed(() => (props.won ? '#e0a327' : '#565c66'));
const c3 = computed(() => (props.won ? '#b8791a' : '#3a3f47'));
const star = computed(() => (props.won ? '#fff4d0' : '#c2c7d0'));
</script>

<style scoped>
.medal {
  position: relative;
  width: 120px;
  height: 148px;
}
.medal.small {
  width: 44px;
  height: 54px;
}
.medal-base {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.medal-disc {
  position: absolute;
  left: 15%;
  top: 36.5%;
  width: 70%;
  height: 56.8%;
  border-radius: 50%;
  box-shadow:
    inset 0 2px 6px rgba(255, 255, 255, 0.4),
    inset 0 -6px 10px rgba(0, 0, 0, 0.35),
    0 6px 18px rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.medal-star {
  width: 55%;
  height: 55%;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
}
.medal-shine {
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.75) 50%, rgba(255, 255, 255, 0) 100%);
  animation: medal-shine 2.6s ease-in-out 0.4s infinite;
}
@keyframes medal-shine {
  0% { transform: translateX(-120%) rotate(20deg); }
  100% { transform: translateX(320%) rotate(20deg); }
}
</style>
