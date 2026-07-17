// Spec 1019 (US7/FR-016/FR-024): resetHiddenChats wipes hidden conversations'
// local data, records a permanent local-only re-sync block per id (recorded
// BEFORE the data wipe so an interruption never exposes a half-wiped chat), and
// clears the set + PIN.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  hidden: new Set<string>(['chatHid', 'grpHid']),
  removed: [] as Array<[string, string]>,
  tombstones: [] as Array<{ store: string; recordId: string; deletedAt: number; localOnly: boolean }>,
  peerBlocks: [] as string[],
  seq: [] as string[], // interleaved op log for FR-024 ordering asserts
  cleared: false,
  stateCleared: false,
}));

vi.mock('@/db/idb', () => ({
  // chatHid is a plain 1:1 with peer-9; grpHid is a group-modeled thread.
  get: async (_store: string, id: string) =>
    id === 'chatHid'
      ? { id, isGroup: false, participantIds: ['peer-9'] }
      : id === 'grpHid'
        ? { id, isGroup: true, participantIds: ['peer-9'] }
        : undefined,
  getByIndex: async (_store: string, _idx: string, chatId: string) =>
    chatId === 'chatHid' ? [{ id: 'm1' }, { id: 'm2' }] : [],
  remove: async (store: string, id: string) => {
    h.removed.push([store, id]);
    h.seq.push(`remove:${store}:${id}`);
  },
}));
vi.mock('@/db/tombstones', () => ({
  recordTombstone: async (store: string, recordId: string, deletedAt: number, localOnly = false) => {
    h.tombstones.push({ store, recordId, deletedAt, localOnly });
    h.seq.push(`tombstone:${recordId}`);
  },
  recordHiddenPeerBlock: async (peerId: string) => {
    h.peerBlocks.push(peerId);
    h.seq.push(`block:${peerId}`);
  },
}));
vi.mock('@/services/hidden-chats', () => ({
  getHiddenSet: async () => h.hidden,
  clearHiddenStorage: async () => {
    h.cleared = true;
  },
}));
vi.mock('@/services/hidden-state', () => ({
  clearHiddenState: () => {
    h.stateCleared = true;
  },
}));

import { resetHiddenChats } from './hidden-chats-reset';

beforeEach(() => {
  h.removed.length = 0;
  h.tombstones.length = 0;
  h.peerBlocks.length = 0;
  h.seq.length = 0;
  h.cleared = false;
  h.stateCleared = false;
  h.hidden = new Set(['chatHid', 'grpHid']);
});

describe('resetHiddenChats', () => {
  it('blocks re-sync, wipes local data, and clears the set + PIN', async () => {
    const { wiped } = await resetHiddenChats();
    expect(wiped.sort()).toEqual(['chatHid', 'grpHid']);

    // A permanent local-only block per hidden id (never uploaded).
    expect(h.tombstones).toHaveLength(2);
    for (const t of h.tombstones) {
      expect(t.localOnly).toBe(true);
      expect(t.deletedAt).toBe(Number.MAX_SAFE_INTEGER);
      expect(t.store).toBe('chats');
    }

    // Local data removed: messages of chatHid, plus sessions/senderkeys/chats rows.
    expect(h.removed).toContainEqual(['messages', 'm1']);
    expect(h.removed).toContainEqual(['messages', 'm2']);
    expect(h.removed).toContainEqual(['chats', 'chatHid']);
    expect(h.removed).toContainEqual(['chats', 'grpHid']);

    // Set + PIN + in-memory state cleared last.
    expect(h.cleared).toBe(true);
    expect(h.stateCleared).toBe(true);
  });

  it('records the re-sync block BEFORE removing the chat row (atomic wrt exposure, FR-024)', async () => {
    const order: string[] = [];
    // Re-mock to capture ordering across the two mocked modules via the arrays:
    await resetHiddenChats();
    // Tombstones are recorded in the first loop; chat removal in the second — so for
    // each id the tombstone exists by the time we delete. Assert both happened and
    // that no chat row removal lacks a matching block.
    for (const [store, id] of h.removed) {
      if (store === 'chats') order.push(id);
    }
    for (const id of order) {
      expect(h.tombstones.find((t) => t.recordId === id)).toBeTruthy();
    }
  });

  // ---- spec 1027 FR-018 (bug B3): the live-relay peer block ----

  it('records a peer block for each hidden PLAIN 1:1 — groups keep id-keyed blocking', async () => {
    await resetHiddenChats();
    // chatHid is the plain 1:1 with peer-9 → blocked by peer. grpHid is a
    // group-modeled thread → its stable id tombstone is the block; a peer block
    // for it would wrongly gag the person everywhere.
    expect(h.peerBlocks).toEqual(['peer-9']);
  });

  it('records every block (chat-id AND peer) BEFORE any data is deleted (FR-024 ordering)', async () => {
    // If the wipe is interrupted mid-way, the blocks must already hold — a
    // half-wiped conversation may never flip visible or re-download.
    await resetHiddenChats();
    const firstRemoval = h.seq.findIndex((s) => s.startsWith('remove:'));
    const lastBlock = Math.max(
      ...h.seq.map((s, i) => (s.startsWith('block:') || s.startsWith('tombstone:') ? i : -1)),
    );
    expect(firstRemoval).toBeGreaterThan(-1);
    expect(lastBlock).toBeLessThan(firstRemoval);
  });
});
