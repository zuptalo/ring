<template>
  <!-- The one audience surface (spec 1065, FR-001/FR-002). Opened from a group
       message receipt tier, a post's viewer count, a post's reaction pills, or a
       comment's reaction tally. Count first, then the people.

       Bounded by construction: only `visible` rows are rendered and the rest arrive
       on scroll, so a list of three hundred opens as fast as a list of five (FR-004).
       Ionic 8 has no virtual scroll, so this is the ContactsPage idiom. -->
  <ion-modal
    :is-open="isOpen"
    :initial-breakpoint="0.6"
    :breakpoints="[0, 0.6, 1]"
    @did-dismiss="$emit('dismiss')"
  >
    <ion-content class="sheet">
      <div class="sheet-head">
        <h2>{{ title }}</h2>
        <span v-if="rows.length" class="count">{{ rows.length }}</span>
      </div>

      <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>

      <!-- Grouped mode (reactions by emoji, most-used first) or one flat list. -->
      <template v-if="groups.length">
        <div v-for="g in groups" :key="g.key" class="group">
          <div class="group-head">
            <span class="group-emoji"><emoji :emoji="g.key" /></span>
            <span class="group-count">{{ g.count }}</span>
          </div>
          <ion-list :inset="true">
            <audience-row v-for="r in g.rows" :key="r.id" :row="r" />
          </ion-list>
        </div>
      </template>

      <ion-list v-else-if="ordered.length" :inset="true">
        <audience-row v-for="r in ordered.slice(0, visible)" :key="r.id" :row="r" />
      </ion-list>

      <p v-else class="empty">{{ emptyText }}</p>

      <ion-infinite-scroll :disabled="!canLoadMore" @ion-infinite="loadMore">
        <ion-infinite-scroll-content />
      </ion-infinite-scroll>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  IonModal,
  IonContent,
  IonList,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  type InfiniteScrollCustomEvent,
} from '@ionic/vue';
import AudienceRow from '@/components/AudienceRow.vue';
import Emoji from '@/components/Emoji.vue';
import { firstPage, growPage, hasMore, sortAudience, type AudienceRow as Row } from '@/utils/audience-page';

type DisplayRow = Row & { when?: string };

const props = withDefaults(
  defineProps<{
    isOpen: boolean;
    title: string;
    rows: DisplayRow[];
    /** Optional honest caveat under the title, e.g. that the count omits people
     *  who do not share seen receipts (FR-016). */
    subtitle?: string;
    emptyText?: string;
    /** Group by emoji, most-used first (FR-022). Ungrouped when false. */
    byEmoji?: boolean;
  }>(),
  { subtitle: '', emptyText: 'No one yet', byEmoji: false },
);

defineEmits<{ (e: 'dismiss'): void }>();

const ordered = computed(() => sortAudience(props.rows) as DisplayRow[]);
const visible = ref(firstPage(props.rows.length));

// Reopening the sheet, or swapping which tier it shows, must start at the top
// again — otherwise a previously-expanded list opens already scrolled long.
watch(
  () => [props.isOpen, props.title] as const,
  () => {
    visible.value = firstPage(props.rows.length);
  },
);

const canLoadMore = computed(
  () => hasMore(visible.value, ordered.value.length),
);

function loadMore(ev: InfiniteScrollCustomEvent): void {
  visible.value = growPage(visible.value, ordered.value.length);
  void ev.target.complete();
}

/** Emoji groups, most-used first, each already in most-recent-first order. The
 *  same bounded visible window applies in grouped mode: distinct emoji may be
 *  few, but a popular post can still have hundreds of people under one emoji. */
const groups = computed(() => {
  if (!props.byEmoji) return [];
  const by = new Map<string, DisplayRow[]>();
  for (const r of ordered.value) {
    if (!r.emoji) continue;
    const list = by.get(r.emoji);
    if (list) list.push(r);
    else by.set(r.emoji, [r]);
  }
  let remaining = visible.value;
  return [...by.entries()]
    .map(([key, rows]) => ({ key, rows, count: rows.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map((group) => {
      const rows = group.rows.slice(0, remaining);
      remaining -= rows.length;
      return { ...group, rows };
    })
    .filter((group) => group.rows.length > 0);
});
</script>

<style scoped>
.sheet-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 16px 16px 4px;
}
.sheet-head h2 {
  flex: 1;
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--app-text);
}
.count {
  font-size: 15px;
  color: var(--app-text-muted);
}
.subtitle {
  margin: 0 16px 8px;
  font-size: 13px;
  color: var(--app-text-muted);
}
.empty {
  margin: 24px 16px;
  text-align: center;
  color: var(--app-text-muted);
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px 0;
}
.group-emoji {
  font-size: 20px;
}
.group-count {
  font-size: 13px;
  color: var(--app-text-muted);
}
</style>
