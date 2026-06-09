<template>
  <!-- Horizontal, scrollable row of filter chips (All / Unread / Favorites / Groups +
       lists) with a trailing button that opens the lists "More" sheet. -->
  <div class="filter-bar">
    <!-- TransitionGroup so a chip that bubbles up on a new unread badge (and slides
         back when cleared) animates to its new position instead of jumping. -->
    <TransitionGroup name="chip" tag="div" class="chips">
      <button
        v-for="chip in chips"
        :key="chip.id"
        class="chip"
        :class="{ active: chip.id === active }"
        @click="$emit('select', chip.id)"
      >
        {{ chip.label }}
        <span v-if="chip.unread > 0" class="chip-badge">{{ chip.unread }}</span>
      </button>
    </TransitionGroup>
    <button class="more-btn" aria-label="Edit filters" @click="$emit('openMore')">
      <ion-icon :icon="optionsOutline" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { optionsOutline } from 'ionicons/icons';
import type { Chip, FilterId } from '@/services/chat-filters';

defineProps<{ chips: Chip[]; active: FilterId }>();
defineEmits<{ (e: 'select', id: FilterId): void; (e: 'openMore'): void }>();
</script>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 8px;
}
.chips {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.chips::-webkit-scrollbar {
  display: none;
}
.chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: 17px;
  border: 1px solid var(--ion-color-step-200, rgba(120, 120, 128, 0.2));
  background: transparent;
  color: var(--ion-text-color);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.chip.active {
  background: var(--ion-color-primary, #10b981);
  border-color: var(--ion-color-primary, #10b981);
  color: var(--ion-color-primary-contrast, #fff);
}
.chip-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--ion-color-primary, #10b981);
  color: var(--ion-color-primary-contrast, #fff);
  font-size: 11px;
  font-weight: 700;
}
.chip.active .chip-badge {
  background: rgba(255, 255, 255, 0.25);
}
/* Smoothly slide chips to their new position when the unread-bubbling reorders them. */
.chip-move {
  transition: transform 0.3s ease;
}
.more-btn {
  flex: 0 0 auto;
  width: 38px;
  height: 34px;
  border-radius: 17px;
  border: 1px solid var(--ion-color-step-200, rgba(120, 120, 128, 0.2));
  background: transparent;
  color: var(--ion-text-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
}
</style>
