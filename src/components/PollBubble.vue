<template>
  <div class="poll">
    <div class="poll-q">{{ poll.question }}</div>
    <button
      v-for="(opt, i) in poll.options"
      :key="i"
      type="button"
      class="poll-opt"
      :class="{ mine: voted(i) }"
      @click.stop="$emit('vote', i)"
    >
      <span class="poll-bar" :style="{ width: pct(i) + '%' }" />
      <span class="poll-row">
        <ion-icon class="poll-check" :icon="voted(i) ? checkmarkCircle : (poll.multi ? squareOutline : ellipseOutline)" />
        <span class="poll-text">{{ opt }}</span>
        <span class="poll-count">{{ count(i) }}</span>
      </span>
    </button>
    <div class="poll-foot">
      {{ voters }} {{ voters === 1 ? 'vote' : 'votes' }}<template v-if="poll.multi"> · choose multiple</template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { checkmarkCircle, ellipseOutline, squareOutline } from 'ionicons/icons';
import type { Poll } from '@/db/types';

const props = defineProps<{ poll: Poll; me: string }>();
defineEmits<{ (e: 'vote', option: number): void }>();

const votes = computed(() => props.poll.votes ?? []);
const voters = computed(() => new Set(votes.value.map((v) => v.userId)).size);
const count = (i: number) => votes.value.filter((v) => v.option === i).length;
const voted = (i: number) => votes.value.some((v) => v.userId === props.me && v.option === i);
const pct = (i: number) => (voters.value ? Math.round((count(i) / voters.value) * 100) : 0);
</script>

<style scoped>
.poll {
  width: 250px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.poll-q {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
}
.poll-opt {
  position: relative;
  border: none;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  text-align: start;
}
.poll-opt.mine {
  outline: 1.5px solid var(--ion-color-primary);
}
.poll-bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgba(var(--ion-color-primary-rgb), 0.18);
  transition: width 0.25s ease;
}
.poll-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
}
.poll-check {
  flex: none;
  font-size: 18px;
  color: var(--ion-color-primary);
}
.poll-text {
  flex: 1;
  min-width: 0;
  font-size: 15px;
}
.poll-count {
  flex: none;
  font-size: 13px;
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
}
.poll-foot {
  font-size: 12px;
  color: var(--app-text-muted);
}
</style>
