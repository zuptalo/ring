/**
 * Spec 2040: refreshConnections rebuilds the device-local connected-peers
 * ledger from the server's accepted-friends list, so a recovered install
 * (contacts restored via own-sync, ledger empty) heals on first connect
 * instead of showing an empty close-friends picker and posting to nobody.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const marked: string[] = [];
let friendsFromServer: string[] | undefined;

vi.mock('@/services/api', () => ({
  listConnections: vi.fn(async (includeFriends?: boolean) => ({
    incoming: [],
    outgoing: [],
    ...(includeFriends && friendsFromServer ? { friends: friendsFromServer } : {}),
  })),
  connectRequest: vi.fn(),
  connectAccept: vi.fn(),
  connectReject: vi.fn(),
  connectWithdraw: vi.fn(),
  connectLink: vi.fn(),
  fetchDirectoryUser: vi.fn(async () => null),
}));
vi.mock('@/services/directory', () => ({ importDirectoryUser: vi.fn() }));
vi.mock('@/db/queries', () => ({
  getContact: vi.fn(async () => undefined),
  markContactConnected: vi.fn(async (id: string) => {
    if (id === 'boom') throw new Error('bad row');
    marked.push(id);
  }),
}));

import { refreshConnections } from './connections';
import { listConnections } from '@/services/api';

describe('refreshConnections friends-ledger reconcile (spec 2040)', () => {
  beforeEach(() => {
    marked.length = 0;
    friendsFromServer = undefined;
    vi.mocked(listConnections).mockClear();
  });

  it('asks the server for the accepted-friends list and marks every peer connected', async () => {
    friendsFromServer = ['friend-a', 'friend-b', 'friend-c'];
    await refreshConnections();
    expect(listConnections).toHaveBeenCalledWith(true);
    expect(marked).toEqual(['friend-a', 'friend-b', 'friend-c']);
  });

  it('tolerates old servers that omit the friends field', async () => {
    friendsFromServer = undefined;
    await expect(refreshConnections()).resolves.toBeUndefined();
    expect(marked).toEqual([]);
  });

  it('a failing row does not stop the rest of the ledger from healing', async () => {
    friendsFromServer = ['friend-a', 'boom', 'friend-b'];
    await refreshConnections();
    expect(marked).toEqual(['friend-a', 'friend-b']);
  });
});
