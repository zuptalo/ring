/**
 * Reactive, on-device badge counts for each tab, plus syncing the accumulated
 * total to the home-screen app icon via the Badging API (installed PWAs).
 *
 * Sources:
 *  - Chats    → total unread messages
 *  - Calls    → missed calls not yet seen
 *  - Contacts → pending friend requests
 *  - You      → unresolved "needs attention" alerts
 */
import { computed, watch } from 'vue';
import { useLiveQuery } from './useLiveQuery';
import {
  countMissedUnseen,
  countPendingRequests,
  countUnread,
  countUnresolvedAlerts,
  wallUnreadCount,
} from '@/db/queries';
import { incomingRequests } from '@/services/connections';

function setAppBadge(total: number): void {
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (total > 0) void nav.setAppBadge?.(total);
    else void nav.clearAppBadge?.();
  } catch {
    /* unsupported, ignore */
  }
}

export function useBadges() {
  const chats = useLiveQuery(() => countUnread(), ['chats'], 0);
  const calls = useLiveQuery(() => countMissedUnseen(), ['calls'], 0);
  // Contacts badge = group invites + legacy db requests (countPendingRequests) PLUS
  // incoming friend requests, which live in the connections store (server-driven,
  // reconciled on connect by useSync). Persists until the request is answered
  // (accept/decline refresh the store). Spec 0002 FR-010.
  const pendingDb = useLiveQuery(() => countPendingRequests(), ['requests'], 0);
  const contacts = computed(() => pendingDb.value + incomingRequests.value.length);
  const you = useLiveQuery(() => countUnresolvedAlerts(), ['alerts'], 0);
  // Wall = unseen received posts (cleared when the Wall tab is open). Depends on both
  // the posts store and settings (the last-seen marker + hidden-user ledger).
  const wall = useLiveQuery(() => wallUnreadCount(), ['posts', 'settings'], 0);

  const total = computed(
    () => chats.value + calls.value + contacts.value + you.value + wall.value,
  );

  watch(total, (n) => setAppBadge(n), { immediate: true });

  return { chats, calls, contacts, you, wall, total };
}
