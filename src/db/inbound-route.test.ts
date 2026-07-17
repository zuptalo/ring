// Unit tests for rule R stage 1 — the pre-decrypt inbound session resolution
// (spec 1027 T005/T031, fixes bug B1). The full receive pipeline lives in
// queries.ts (untestable under node vitest — it drags in .vue components), so
// the DECISION layer is extracted here and the queries.ts wiring is covered by
// the Playwright e2e (hidden-coexist.spec.ts / hidden-reset.spec.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Chat } from '@/db/types';

const h = vi.hoisted(() => ({
  rows: new Map<string, Map<string, unknown>>(), // store -> id -> row
}));
function store(name: string): Map<string, unknown> {
  let s = h.rows.get(name);
  if (!s) {
    s = new Map();
    h.rows.set(name, s);
  }
  return s;
}

vi.mock('@/db/idb', () => ({
  get: async (s: string, id: string) => store(s).get(id),
  getAll: async (s: string) => [...store(s).values()],
  getByIndex: async () => [],
  put: async (s: string, row: { id?: string; key?: string }) => {
    store(s).set((row.id ?? row.key) as string, row);
  },
  remove: async (s: string, id: string) => {
    store(s).delete(id);
  },
  touch: () => {},
}));

import { routeInboundFrom } from './inbound-route';
import { recordHiddenPeerBlock, clearHiddenPeerBlock } from './tombstones';
import {
  registerHiddenLoader,
  setHiddenIdsCache,
  clearHiddenState,
} from '@/services/hidden-state';

const P = 'peer-1';
let seq = 0;
function putChat(over: Partial<Chat>): Chat {
  seq += 1;
  const c: Chat = {
    id: over.id ?? `c${seq}`,
    name: 'x',
    avatar: '',
    isGroup: false,
    participantIds: [P],
    lastMessage: '',
    lastMessageTime: 0,
    unread: 0,
    updatedAt: 0,
    ...over,
  };
  store('chats').set(c.id, c);
  return c;
}

beforeEach(() => {
  h.rows.clear();
  clearHiddenState();
  // Deterministic loader: the cache is driven directly via setHiddenIdsCache.
  registerHiddenLoader(async () => new Set<string>());
});

describe('routeInboundFrom (rule R stage 1)', () => {
  it('resolves to the visible plain 1:1 when one exists', async () => {
    putChat({ id: 'v' });
    setHiddenIdsCache([]);
    expect(await routeInboundFrom(P)).toEqual({ kind: 'chat', chatId: 'v' });
  });

  it('resolves to the hidden plain 1:1 when it is the only one (bug B1 core)', async () => {
    putChat({ id: 'hid' });
    setHiddenIdsCache(['hid']);
    expect(await routeInboundFrom(P)).toEqual({ kind: 'chat', chatId: 'hid' });
  });

  it('prefers the visible 1:1 over the hidden one (legacy B1 residue state)', async () => {
    putChat({ id: 'hid' });
    putChat({ id: 'v' });
    setHiddenIdsCache(['hid']);
    expect(await routeInboundFrom(P)).toEqual({ kind: 'chat', chatId: 'v' });
  });

  it('ignores pair conversations (group-modeled threads route by groupId)', async () => {
    putChat({ id: 'pair', isGroup: true });
    setHiddenIdsCache([]);
    expect(await routeInboundFrom(P)).toEqual({ kind: 'create' });
  });

  it('returns blocked for a hiddenPeer-reset peer, and create after the block lifts', async () => {
    setHiddenIdsCache([]);
    await recordHiddenPeerBlock(P);
    expect(await routeInboundFrom(P)).toEqual({ kind: 'blocked' });
    await clearHiddenPeerBlock(P);
    expect(await routeInboundFrom(P)).toEqual({ kind: 'create' });
  });

  it('an existing chat wins over a stale peer block (block only guards creation)', async () => {
    // A block can only coexist with a chat if the user re-engaged; never drop
    // frames for a conversation that exists again.
    putChat({ id: 'v' });
    setHiddenIdsCache([]);
    await recordHiddenPeerBlock(P);
    expect(await routeInboundFrom(P)).toEqual({ kind: 'chat', chatId: 'v' });
  });

  it('defers (fail closed) while the hidden set is unknown', async () => {
    putChat({ id: 'hid' });
    clearHiddenState();
    registerHiddenLoader(async () => {
      throw new Error('keystore locked');
    });
    expect(await routeInboundFrom(P)).toEqual({ kind: 'defer' });
  });

  it('creates for a genuinely new peer', async () => {
    setHiddenIdsCache([]);
    expect(await routeInboundFrom('someone-new')).toEqual({ kind: 'create' });
  });
});
