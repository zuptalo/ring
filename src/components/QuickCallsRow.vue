<template>
  <!-- Quick Calls (spec 1046): one-tap call tiles above the Recent list. Tap rings
       the target with the tile's method immediately; long-press / right-click opens
       the manage sheet (switch method, remove). Unknown targets are HIDDEN (a sync
       snapshot can outrun this device's data); known-but-uncallable ones (ghosted,
       blocked, group grown past the method's cap) render dimmed with a warning
       badge, and tapping them explains instead of ringing. -->
  <div v-if="resolved.length || canAdd" class="qc-row" role="list" aria-label="Quick calls">
    <button
      v-for="r in resolved"
      :key="r.key"
      type="button"
      class="qc-tile"
      :class="{ dim: !r.verdict.ok }"
      role="listitem"
      :aria-label="`${r.entry.kind === 'video' ? 'Video' : 'Audio'} call ${r.name}`"
      :data-qc="r.key"
      @click="onTap(r)"
      @pointerdown="pressStart(r)"
      @pointerup="pressEnd"
      @pointercancel="pressEnd"
      @contextmenu.prevent="$emit('manage', r.entry)"
    >
      <div class="qc-avatar">
        <user-avatar :src="r.avatar" :alt="r.name" />
        <span class="qc-badge" :class="{ warn: !r.verdict.ok }" aria-hidden="true">
          <ion-icon :icon="badgeIcon(r)" />
        </span>
      </div>
      <span class="qc-name" dir="auto">{{ r.name }}</span>
    </button>
    <button v-if="canAdd" type="button" class="qc-tile" aria-label="Add quick call" @click="$emit('add')">
      <div class="qc-avatar qc-plus"><ion-icon :icon="addOutline" /></div>
      <span class="qc-name qc-add-label">Add</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { addOutline, callOutline, videocamOutline, alertCircleOutline } from 'ionicons/icons';
import UserAvatar from '@/components/UserAvatar.vue';
import {
  entryVerdict, QUICK_CALLS_MAX,
  type QuickCallEntry, type QuickCallVerdict,
} from '@/utils/quick-calls';
import type { Chat, Contact } from '@/db/types';

interface ResolvedEntry {
  key: string;
  entry: QuickCallEntry;
  name: string;
  avatar: string;
  verdict: QuickCallVerdict;
}

const props = defineProps<{
  entries: QuickCallEntry[];
  contacts: Contact[];
  /** Group chats visible to this user (already hidden/locked/archived-filtered). */
  groups: Chat[];
}>();
const emit = defineEmits<{
  (e: 'call', entry: QuickCallEntry): void;
  (e: 'manage', entry: QuickCallEntry): void;
  (e: 'add'): void;
}>();

const contactById = computed(() => new Map(props.contacts.map((c) => [c.id, c])));
const groupById = computed(() => new Map(props.groups.map((g) => [g.id, g])));

const resolved = computed<ResolvedEntry[]>(() => {
  const out: ResolvedEntry[] = [];
  for (const entry of props.entries) {
    const target = entry.t === 'contact' ? contactById.value.get(entry.id) : groupById.value.get(entry.id);
    // Unknown target: hidden, not broken — sync may deliver the entry before
    // this device has the record (it appears once the record lands).
    if (!target) continue;
    out.push({
      key: `${entry.t}:${entry.id}`,
      entry,
      name: target.name,
      avatar: target.avatar,
      verdict: entryVerdict(entry, target),
    });
  }
  return out;
});
const canAdd = computed(() => props.entries.length < QUICK_CALLS_MAX);

function badgeIcon(r: ResolvedEntry): string {
  if (!r.verdict.ok) return alertCircleOutline;
  return r.entry.kind === 'video' ? videocamOutline : callOutline;
}

// Long-press → the manage sheet; a completed long-press swallows the click that
// follows so the tap doesn't ALSO start a call under it (the pre-1045 grid
// pattern — quick calls have no drag/peek, a timer is all this needs).
const LONG_PRESS_MS = 500;
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressed = false;
function pressStart(r: ResolvedEntry): void {
  longPressed = false;
  pressTimer = setTimeout(() => {
    longPressed = true;
    emit('manage', r.entry);
  }, LONG_PRESS_MS);
}
function pressEnd(): void {
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = null;
}
function onTap(r: ResolvedEntry): void {
  if (longPressed) {
    longPressed = false;
    return;
  }
  emit('call', r.entry);
}
</script>

<style scoped>
.qc-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  row-gap: 10px;
  padding: 10px 8px 2px;
}
.qc-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  min-width: 0;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
.qc-tile.dim .qc-avatar {
  opacity: 0.45;
}
.qc-avatar {
  position: relative;
  width: 64px;
  height: 64px;
}
/* Method glyph on the avatar corner: what one tap will do. */
.qc-badge {
  position: absolute;
  bottom: -2px;
  inset-inline-end: -4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--ion-color-primary, #10b981);
  color: var(--ion-color-primary-contrast, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border: 2px solid var(--ion-background-color, #fff);
}
.qc-badge.warn {
  background: var(--ion-color-warning, #ffc409);
  color: var(--ion-color-warning-contrast, #000);
}
.qc-plus {
  border-radius: 50%;
  border: 2px dashed color-mix(in srgb, var(--app-text, #000) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  color: var(--app-text-muted, var(--ion-color-medium));
}
.qc-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--ion-text-color);
}
.qc-add-label {
  color: var(--app-text-muted, var(--ion-color-medium));
}
</style>
