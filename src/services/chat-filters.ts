/**
 * Chats-tab filter chips (All / Unread / Favorites / Groups + user lists). Pure
 * predicates plus two composables: `useTabFilters` (which chips are pinned to the tab,
 * and their order — a synced preference) and `useChatFilters` (the live, filtered chat
 * list + per-chip unread badges for the Chats page). Filtering is done client-side over
 * the already-reactive chat list so search and chips compose naturally.
 */
import { computed, ref, watch, type Ref, type ComputedRef } from 'vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { warmChats, warmChatsLoaded, warmWhenIdle } from '@/composables/warmStores';
import { listChats, listChatLists, getSetting, setSetting, chatIsUnread } from '@/db/queries';
import type { Chat, ChatList } from '@/db/types';

// A chip id: a built-in filter or a custom list (`list:<id>`).
export type FilterId = 'all' | 'unread' | 'favorites' | 'groups' | `list:${string}`;

export const DEFAULT_FILTERS: FilterId[] = ['all', 'unread', 'favorites', 'groups'];
export const MAX_TAB_FILTERS = 10; // including the always-present "All"
const TAB_FILTERS_KEY = 'chats.tabFilters';

const BUILTIN_LABELS: Record<'all' | 'unread' | 'favorites' | 'groups', string> = {
  all: 'All',
  unread: 'Unread',
  favorites: 'Favorites',
  groups: 'Groups',
};

export function isListFilter(id: FilterId): id is `list:${string}` {
  return id.startsWith('list:');
}
export function listIdOf(id: FilterId): string | null {
  return isListFilter(id) ? id.slice('list:'.length) : null;
}

/** Does a chat match a single chip? `lists` maps list id → ChatList for membership. */
export function chatMatchesFilter(chat: Chat, id: FilterId, lists: Map<string, ChatList>): boolean {
  switch (id) {
    case 'all':
      return true;
    case 'unread':
      return chatIsUnread(chat);
    case 'favorites':
      return !!chat.favorite;
    case 'groups':
      return chat.isGroup;
    default: {
      const listId = listIdOf(id);
      return !!listId && !!lists.get(listId)?.chatIds.includes(chat.id);
    }
  }
}

/** Normalise a stored tab-filter list: dedupe, force "All" first, cap at MAX. */
function normalizeTabs(ids: FilterId[]): FilterId[] {
  const seen = new Set<FilterId>();
  const out: FilterId[] = ['all'];
  seen.add('all');
  for (const id of ids) {
    if (id === 'all' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(0, MAX_TAB_FILTERS);
}

/** The chips pinned to the tab (ordered), and a setter. Synced via SYNCED_PREF_KEYS. */
export function useTabFilters(): { tabFilters: Ref<FilterId[]>; save: (ids: FilterId[]) => Promise<void> } {
  const raw = useLiveQuery(
    () => getSetting<FilterId[]>(TAB_FILTERS_KEY, DEFAULT_FILTERS),
    ['settings'],
    DEFAULT_FILTERS,
  );
  const tabFilters = computed(() => normalizeTabs(raw.value));
  async function save(ids: FilterId[]): Promise<void> {
    await setSetting(TAB_FILTERS_KEY, normalizeTabs(ids));
  }
  return { tabFilters, save };
}

export interface Chip {
  id: FilterId;
  label: string;
  unread: number; // count of unread chats matching this chip (0 = no badge); 'all' = 0
}

/** The Chats page's filter state: the filtered list, the active chip, the chips to show
 *  (label + unread badge), and the lists (for the More sheet). */
export function useChatFilters(search: Ref<string>): {
  chats: ComputedRef<Chat[]>;
  activeFilter: Ref<FilterId>;
  setActive: (id: FilterId) => void;
  chips: ComputedRef<Chip[]>;
  lists: Ref<ChatList[]>;
  allChats: Ref<Chat[]>;
  loaded: Ref<boolean>;
  tabFilters: Ref<FilterId[]>;
} {
  // When the search box is empty, seed first paint from the warm chats store so
  // the list is already populated on tab entry; a typed term falls back to the
  // live `listChats(term)` query (filtering stays in the data layer). See the
  // "Search contract" in spec 1001's data-model.
  const allChats = useLiveQuery(
    () => listChats(search.value),
    ['chats', 'messages', 'chatlists'],
    [] as Chat[],
    () => search.value,
    warmWhenIdle(warmChats, warmChatsLoaded, search),
  );
  const lists = useLiveQuery(() => listChatLists(), ['chatlists'], [] as ChatList[]);
  const listsMap = computed(() => new Map(lists.value.map((l) => [l.id, l])));
  const { tabFilters } = useTabFilters();

  const activeFilter = ref<FilterId>('all');
  function setActive(id: FilterId): void {
    activeFilter.value = id;
  }

  // If the active chip is a list that no longer exists (deleted), fall back to All.
  watch([activeFilter, listsMap], () => {
    const lid = listIdOf(activeFilter.value);
    if (lid && !listsMap.value.has(lid)) activeFilter.value = 'all';
  });

  const chats = computed(() =>
    allChats.value.filter((c) => chatMatchesFilter(c, activeFilter.value, listsMap.value)),
  );

  const chips = computed<Chip[]>(() => {
    const objs = tabFilters.value
      // Drop any tab entry whose custom list was deleted.
      .filter((id) => !isListFilter(id) || listsMap.value.has(listIdOf(id) as string))
      .map((id) => {
        const lid = listIdOf(id);
        const label = lid ? (listsMap.value.get(lid)?.name ?? '') : BUILTIN_LABELS[id as 'all'];
        const unread =
          id === 'all'
            ? 0
            : allChats.value.filter((c) => chatIsUnread(c) && chatMatchesFilter(c, id, listsMap.value)).length;
        return { id, label, unread };
      });
    // "All" is pinned first and the built-in chips (Unread/Favorites/Groups) keep their
    // saved positions. Only a custom LIST chip bubbles: when it gains an unread badge it
    // moves up to the front (after All) so it's seen, keeping list relative order, then
    // drops back to its saved place once the unread clears. Stable: each group keeps the
    // saved order.
    const all = objs.filter((c) => c.id === 'all');
    const rest = objs.filter((c) => c.id !== 'all');
    const bubbled = rest.filter((c) => isListFilter(c.id) && c.unread > 0);
    const settled = rest.filter((c) => !(isListFilter(c.id) && c.unread > 0));
    return [...all, ...bubbled, ...settled];
  });

  return { chats, activeFilter, setActive, chips, lists, allChats, loaded: allChats.loaded, tabFilters };
}
