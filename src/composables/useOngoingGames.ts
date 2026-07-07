// The reactive ongoing-games set (spec 1038 FR-008): feeds the floating
// return button's visibility, badge, and tap target, and the duty officer's
// session walk. Derived entirely from stored session state via useLiveQuery,
// so it survives reloads and self-clears when games finish — there is no
// imperative unread counter to drift.

import { computed, type ComputedRef } from 'vue';
import { ongoingOverlayGames } from '@/db/queries';
import type { OngoingOverlayGame } from '@/games/overlay-games';
import { useLiveQuery, type LiveRef } from './useLiveQuery';

export interface OngoingGamesView {
  /** Most urgent first (awaiting-me, then newest activity) — index 0 is what
   *  a pill tap opens. */
  games: LiveRef<OngoingOverlayGame[]>;
  /** The badge: how many games await the local player's action. */
  awaitingCount: ComputedRef<number>;
}

export function useOngoingGames(): OngoingGamesView {
  const games = useLiveQuery<OngoingOverlayGame[]>(
    () => ongoingOverlayGames(),
    // Chat sessions live on message rows; wall sessions derive from the post +
    // its engagement rows. Any of the three changing can flip an entry.
    ['messages', 'posts', 'postEngagement'],
    [],
  );
  const awaitingCount = computed(() => games.value.filter((g) => g.awaitingMe).length);
  return { games, awaitingCount };
}
