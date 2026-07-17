/**
 * Hidden Chats PIN reset (spec 1019, US7 / FR-016 / FR-024).
 *
 * Destructive: permanently deletes every hidden conversation's local data on THIS
 * device AND records a device-local "do-not-resync" block so the server can never
 * re-download them, without propagating the deletion to the user's other devices.
 *
 * Ordering matters for atomicity-with-respect-to-exposure (FR-024): the re-sync
 * BLOCK is recorded before the data is deleted, and the hidden set is cleared
 * LAST. So if the wipe is interrupted, the conversations are still hidden (in the
 * set) and still blocked from re-sync — they can never flip to visible mid-reset.
 */
import { get, getByIndex, remove } from '@/db/idb';
import { recordTombstone, recordHiddenPeerBlock } from '@/db/tombstones';
import { getHiddenSet, clearHiddenStorage } from '@/services/hidden-chats';
import { clearHiddenState } from '@/services/hidden-state';
import type { Chat, Message } from '@/db/types';

// A far-future cover so the block is permanent on this device — even if the
// server later holds a newer `updatedAt` for the conversation, the ingest check
// (deletedAt >= updatedAt) still drops it.
const PERMANENT = Number.MAX_SAFE_INTEGER;

export async function resetHiddenChats(): Promise<{ wiped: string[] }> {
  const ids = [...(await getHiddenSet())];

  // 1) Block re-sync FIRST (local-only tombstone, never uploaded). Two kinds
  //    (spec 1027 FR-018): the chat-id tombstone blocks the own-data sync path,
  //    and — for plain 1:1s — a PEER-keyed block covers the live relay path,
  //    because a new inbound message would otherwise just mint a fresh chat id
  //    and sail past any id-keyed tombstone (bug B3). Group/pair threads keep
  //    id-keyed blocking (their ids are stable and shared), consulted by the
  //    group-card / group-message ingest.
  for (const id of ids) {
    await recordTombstone('chats', id, PERMANENT, true);
    const chat = await get<Chat>('chats', id);
    if (chat && !chat.isGroup && chat.participantIds.length === 1) {
      await recordHiddenPeerBlock(chat.participantIds[0]);
    }
  }
  // 2) Delete local data for each hidden conversation.
  for (const id of ids) {
    const msgs = await getByIndex<Message>('messages', 'chatId', id);
    for (const m of msgs) await remove('messages', m.id);
    await remove('sessions', id); // 1:1 ratchet session (no-op for a group)
    await remove('senderkeys', id); // group sender-key state (no-op for a 1:1)
    await remove('chats', id);
  }
  // 3) Clear the set + PIN material + in-memory state LAST.
  await clearHiddenStorage();
  clearHiddenState();
  return { wiped: ids };
}
