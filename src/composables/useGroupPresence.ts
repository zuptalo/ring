/**
 * (spec 1062) Honest group online presence, composed entirely client-side.
 *
 * Zero-knowledge: the server reveals presence ONLY for the user's contacts, and the
 * client already subscribes to all contacts, so every group member we're permitted to
 * see is already in the presence map. The count is the group roster intersected with
 * "my online contacts" — a non-contact co-member is never counted (we can't and don't
 * infer their presence). Wording stays honest: an all-contact group reads "N online";
 * a mixed group reads "N online contacts" so a partial count is never mistaken for the
 * whole roster. Nothing new crosses the wire; nothing is persisted or synced.
 */
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import type { Chat, Contact } from '@/db/types';
import { peerPresence } from '@/composables/usePresence';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { listAllContacts } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import { groupOnline, EMPTY_GROUP_ONLINE, type GroupOnline } from '@/composables/group-online';

export { groupOnline, type GroupOnline };

/** Reactive `GroupOnline` for a group chat. Non-group (or absent) chats yield the empty
 *  view so callers fall back to the existing 1:1 presence dot / no count. */
export function useGroupPresence(
  chat: MaybeRefOrGetter<Chat | undefined | null>,
): ComputedRef<GroupOnline> {
  const self = getSelfUserId() ?? '';
  // Same contact source as the rest of the app; re-runs when contacts change.
  const contacts = useLiveQuery(() => listAllContacts(), ['contacts', 'chats'], [] as Contact[]);
  return computed(() => {
    const c = toValue(chat);
    if (!c || !c.isGroup) return EMPTY_GROUP_ONLINE;
    const contactIds = new Set(contacts.value.map((x) => x.id));
    const members = c.participantIds.filter((id) => id !== self);
    return groupOnline(members, contactIds, (id) => !!peerPresence(id)?.online);
  });
}
