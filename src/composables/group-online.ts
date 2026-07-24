/**
 * (spec 1062) Pure group-online derivation — kept in its own module (no Vue/IDB/`.vue`
 * imports) so it stays exhaustively unit-testable in the Node test env. `useGroupPresence`
 * wraps this with the reactive contact list + presence map.
 *
 * Zero-knowledge: a member who is not one of my contacts is NEVER counted — the server
 * withholds their presence and the client does not infer it. Wording stays honest: an
 * all-contact group reads "N online"; a mixed group reads "N online contacts".
 */
export interface GroupOnline {
  /** Members who are my contacts AND online AND sharing presence. */
  count: number;
  /** That member set — drives the per-member dots (Story 4). */
  onlineIds: string[];
  /** True when every member is my contact → "N online"; else mixed → "N online contacts". */
  allContacts: boolean;
  /** '' when count is 0/unknown (render nothing); else the labelled count. */
  label: string;
}

export const EMPTY_GROUP_ONLINE: GroupOnline = { count: 0, onlineIds: [], allContacts: true, label: '' };

/** `members` excludes self; `contactIds` is my contact id set; `isOnline` reports visible
 *  online-ness. A member not in `contactIds` is never counted, even if `isOnline` is true. */
export function groupOnline(
  members: string[],
  contactIds: Set<string>,
  isOnline: (id: string) => boolean,
): GroupOnline {
  const onlineIds = members.filter((id) => contactIds.has(id) && isOnline(id));
  const allContacts = members.every((id) => contactIds.has(id));
  const count = onlineIds.length;
  const label = count === 0 ? '' : allContacts ? `${count} online` : `${count} online contacts`;
  return { count, onlineIds, allContacts, label };
}
