/**
 * Starting a distinct, coexisting hidden conversation (spec 1019, US2).
 *
 * Split out from `hidden-chats.ts` because it depends on `queries.ts`
 * (`createGroup`), which the service worker must not pull in. UI/test callers
 * import from here; the SW imports only the queries-free `hidden-chats.ts`.
 */
import { createGroup } from '@/db/queries';
import { addHidden } from '@/services/hidden-chats';

/**
 * Start a NEW hidden conversation with a contact, modeled on the group mechanism
 * so it coexists with any normal 1:1 with the same person (a distinct id, its own
 * history). Reuses the existing sender-key crypto — no new scheme. Returns the new
 * conversation id, already added to the hidden set.
 */
export async function startHiddenChat(contactId: string): Promise<string> {
  const groupId = await createGroup('', [contactId]);
  await addHidden(groupId);
  return groupId;
}
