// Spec 1032 (T013/T014, extended by T019/T022) — the SW authoritative drain.
// Same harness style as messaging-preview.test.ts: mock idb with in-memory Maps
// (plus a transact fake honoring throw→nothing-lands), run the REAL X3DH + Double
// Ratchet, stub navigator.locks and fetch. Covers:
//   - the pure eligibility classifier over every payload type (FR-004)
//   - apply = row + chat RMW + ledger + session in ONE commit, id queued for ack
//   - replay of an applied frame = re-ack only (unread stays 1, single row)
//   - transaction abort → no ledger mark, no ack id
//   - media-by-reference persists pendingMedia without fetching bytes
//   - the drain itself never acks (caller's job, strictly after commit+notify)
//   - gate degrades: flag-off, no-locks, locked (nothing fetched when locked)
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/* ---- in-memory idb with an abortable transact ---- */
const stores: Record<string, Map<string, unknown>> = {};
function storeOf(name: string): Map<string, unknown> {
  return (stores[name] ??= new Map());
}
let failNextTransact = false;
vi.mock('@/db/idb', () => ({
  get: vi.fn(async (store: string, key: string) => storeOf(store).get(key)),
  getAll: vi.fn(async (store: string) => [...storeOf(store).values()]),
  put: vi.fn(async (store: string, value: { id?: string; key?: string }) => {
    storeOf(store).set((value.id ?? value.key) as string, structuredClone(value));
  }),
  remove: vi.fn(async (store: string, key: string) => {
    storeOf(store).delete(key);
  }),
  transact: vi.fn(async (_names: string[], fn: (tx: unknown) => Promise<void> | void) => {
    if (failNextTransact) {
      failNextTransact = false;
      throw new Error('simulated quota/abort');
    }
    // Stage writes; apply only if fn completes (all-or-nothing, like the real helper).
    const staged: Array<{ store: string; value?: { id?: string; key?: string }; del?: string }> = [];
    const tx = {
      get: async (store: string, key: string) => structuredClone(storeOf(store).get(key)),
      put: (store: string, value: { id?: string; key?: string }) => staged.push({ store, value }),
      delete: (store: string, key: string) => staged.push({ store, del: key }),
    };
    await fn(tx);
    for (const w of staged) {
      if (w.del !== undefined) storeOf(w.store).delete(w.del);
      else storeOf(w.store).set((w.value!.id ?? w.value!.key) as string, structuredClone(w.value));
    }
  }),
}));
vi.mock('./api', () => ({
  publishPreKeys: vi.fn(),
  preKeyCount: vi.fn(),
  addOneTimeKeys: vi.fn(),
  fetchPeerBundle: vi.fn(),
}));
vi.mock('./posts', () => ({ openPostEngagement: vi.fn() }));
vi.mock('./session', () => ({
  readSessionToken: vi.fn(async () => 'test-token'),
  readSessionUserId: vi.fn(async () => 'bob-self'),
}));
let hiddenSet: Set<string> | null = new Set<string>();
vi.mock('./hidden-chats', () => ({
  readHiddenSet: vi.fn(async () => hiddenSet ?? new Set<string>()),
  readHiddenSetOrNull: vi.fn(async () => hiddenSet),
}));

import { ready } from './crypto/primitives';
import {
  x3dhInitiator,
  x3dhResponder,
  ratchetInitAlice,
  ratchetInitBob,
  saveSession,
  type RatchetState,
} from './crypto/ratchet';
import { sealMessage, type MessagePayload } from './crypto/message';
import { generateIdentityMaterial, type SecretBundle } from './crypto/identity';
import * as identity from './crypto/identity';
import type { WirePacket } from './messaging';
import type { Chat, Contact, Message, Setting } from '@/db/types';

let bob: SecretBundle;
let alice: RatchetState;

vi.spyOn(identity, 'getIdentityKeys').mockImplementation(() => ({ ed: bob.ed, x: bob.x }));
vi.spyOn(identity, 'getSignedPreKey').mockImplementation(() => ({
  id: bob.signedPreKey.id,
  keypair: bob.signedPreKey.keypair,
}));
vi.spyOn(identity, 'getOneTimePreKeyById').mockImplementation(
  (id: string) => bob.oneTimePreKeys.find((p) => p.id === id)?.keypair ?? null,
);
const unlockSpy = vi.spyOn(identity, 'attemptDeviceUnlock').mockResolvedValue(true);

import { drainPersistPending, ackFrames, classifyPayload, directChatFor, SW_FULL_PERSIST_KEY } from './sw-drain';

beforeAll(async () => {
  await ready();
});

const CHAT = 'chat-with-alice';
const PEER = 'alice';
const pay = (over: Partial<MessagePayload> = {}): MessagePayload => ({
  body: 'hi there',
  kind: 'text',
  timestamp: 1234,
  ...over,
});
const N = (p: MessagePayload): WirePacket => ({ v: 1, type: 'normal', msg: sealMessage(alice, p) });

/* ---- fetch stub: /relay/pending returns `queued`; /relay/ack records ids ---- */
let queued: Array<{ t: string; id: string; from: string; ciphertext: unknown }> = [];
let ackedIds: string[][] = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init?: { body?: string }) => {
    if (String(url).includes('/relay/pending')) {
      return { ok: true, json: async () => ({ frames: queued }) } as Response;
    }
    if (String(url).includes('/relay/ack')) {
      ackedIds.push((JSON.parse(init?.body ?? '{}') as { ids: string[] }).ids);
      return { ok: true, status: 204, json: async () => ({}) } as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  }),
);

/* ---- a locks fake: always-grant, unless `lockBlocked` matches the name (then it
 *      waits for the caller's AbortSignal — the frozen-page-holds-the-lock case) ---- */
let lockBlocked: ((name: string) => boolean) | null = null;
const locksStub = () => ({
  locks: {
    request: async <T>(name: string, opts: { signal?: AbortSignal }, cb: () => Promise<T>): Promise<T> => {
      if (lockBlocked?.(name)) {
        await new Promise<never>((_, reject) => {
          if (opts.signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
          opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return cb();
    },
  },
});
vi.stubGlobal('navigator', locksStub());

async function setupWorld(): Promise<void> {
  for (const m of Object.values(stores)) m.clear();
  queued = [];
  ackedIds = [];
  hiddenSet = new Set<string>();
  lockBlocked = null;
  unlockSpy.mockResolvedValue(true);

  bob = generateIdentityMaterial(2);
  const a: SecretBundle = generateIdentityMaterial(2);
  const otk = bob.oneTimePreKeys[0];
  const init = x3dhInitiator(a.x.privateKey, {
    identityX: bob.x.publicKey,
    signedPreKey: bob.signedPreKey.keypair.publicKey,
    oneTimePreKey: otk.keypair.publicKey,
  });
  const bobSK = x3dhResponder({
    identityXPriv: bob.x.privateKey,
    signedPreKeyPriv: bob.signedPreKey.keypair.privateKey,
    oneTimePreKeyPriv: otk.keypair.privateKey,
    initiatorIdentityX: a.x.publicKey,
    initiatorEphemeral: init.ephemeral.publicKey,
  });
  alice = ratchetInitAlice(init.sk, bob.signedPreKey.keypair.publicKey);
  await saveSession(CHAT, ratchetInitBob(bobSK, bob.signedPreKey.keypair));

  storeOf('contacts').set(PEER, { id: PEER, name: 'Alice Smith', avatar: '', phone: '', about: '' } as Contact);
  storeOf('chats').set(CHAT, {
    id: CHAT,
    name: 'Alice Smith',
    avatar: '',
    isGroup: false,
    participantIds: [PEER],
    lastMessage: '',
    lastMessageTime: 0,
    unread: 0,
    updatedAt: 0,
  } as Chat);
  storeOf('settings').set(SW_FULL_PERSIST_KEY, { key: SW_FULL_PERSIST_KEY, value: true });
  storeOf('settings').set('connectedPeers', { key: 'connectedPeers', value: { [PEER]: true } });
}

const chatRow = (): Chat => storeOf('chats').get(CHAT) as Chat;
const msgRows = (): Message[] => [...storeOf('messages').values()] as Message[];
const ledger = (): string[] =>
  ((storeOf('settings').get('inboundSeenIds') as Setting<string[]> | undefined)?.value ?? []) as string[];

beforeEach(async () => {
  await setupWorld();
});

describe('classifyPayload: the FR-004 eligibility table (pure)', () => {
  const groupChat: Chat = { id: 'g1', isGroup: true, participantIds: [PEER, 'carol'] } as Chat;
  const table: Array<[string, Partial<MessagePayload>, 'eligible' | 'defer']> = [
    ['plain text', {}, 'eligible'],
    ['media by reference', { kind: 'image', mediaRef: { blobId: 'b', fileKey: 'k', mime: 'image/png', size: 9, name: 'p.png' } }, 'eligible'],
    ['group message into an existing group', { groupId: 'g1' }, 'eligible'],
    ['group message into an UNKNOWN group', { groupId: 'nope' }, 'defer'],
    ['contact card', { card: { t: 'request', name: 'A', avatar: '' } }, 'defer'],
    ['group card', { group: { t: 'invite', groupId: 'g', name: 'G', members: [], at: 1 } }, 'defer'],
    ['reaction', { reaction: { messageId: 'm', emoji: '👍', at: 1 } }, 'defer'],
    ['poll vote', { pollVote: { messageId: 'm', option: 0, at: 1 } }, 'defer'],
    ['edit', { edit: { messageId: 'm', body: 'x', at: 1 } }, 'defer'],
    ['erase', { erase: { messageId: 'm', at: 1 } }, 'defer'],
    ['link-preview attach', { linkPreviewSig: { messageId: 'm', preview: { url: 'u', domain: 'd' }, at: 1 } }, 'defer'],
    ['call signal', { call: { callId: 'c', type: 'offer' } }, 'defer'],
    ['rekey control', { rekey: true }, 'defer'],
    ['ttl control', { ttl: 60_000 }, 'defer'],
    ['ttl-off control (ttl: null)', { ttl: null }, 'defer'],
  ];
  for (const [name, over, want] of table) {
    it(`${name} → ${want}`, () => {
      expect(classifyPayload(pay(over), [groupChat]).verdict).toBe(want);
    });
  }

  it('directChatFor: unknown sender has no chat → null (defer); prefers the visible 1:1', () => {
    const none = new Set<string>();
    const visible = { id: 'v', isGroup: false, participantIds: [PEER] } as Chat;
    const pending = { id: 'p', isGroup: false, participantIds: [PEER], pending: true } as Chat;
    expect(directChatFor([pending, visible], none, PEER)?.id).toBe('v');
    expect(directChatFor([visible], none, 'stranger')).toBeNull();
  });

  it('directChatFor: routes like the page (F3) — visible PENDING beats hidden non-pending', () => {
    // The exact split-conversation hazard: a pending visible 1:1 plus a non-pending
    // hidden 1:1. The page routes to the visible one; the SW must match, or it
    // commits + acks into the PIN-locked hidden chat and the page never sees it.
    const visiblePending = { id: 'vp', isGroup: false, participantIds: [PEER], pending: true } as Chat;
    const hiddenChat = { id: 'h', isGroup: false, participantIds: [PEER] } as Chat;
    expect(directChatFor([hiddenChat, visiblePending], new Set(['h']), PEER)?.id).toBe('vp');
    // Only a hidden chat exists → content still lands there (spec 1027 rule R).
    expect(directChatFor([hiddenChat], new Set(['h']), PEER)?.id).toBe('h');
  });
});

describe('drain: atomic apply + exactly-once + ack discipline (T014)', () => {
  it('applies a plain message: row + unread + lastMessage + ledger in the store, id queued for ack', async () => {
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay()) }];
    const r = await drainPersistPending();
    expect(r.mode).toBe('applied');
    expect(r.applied).toBe(1);
    expect(r.ackIds).toEqual(['m1']);
    expect(r.deferred).toBe(0);

    const rows = msgRows();
    expect(rows.length).toBe(1);
    expect(rows[0].body).toBe('hi there');
    expect(rows[0].id).toBe('m1');
    expect(rows[0].status).toBe('delivered');
    expect(chatRow().unread).toBe(1);
    expect(chatRow().lastMessage).toBe('hi there');
    expect(chatRow().lastMessageTime).toBe(1234);
    expect(ledger()).toContain('m1');
    // The drain itself never acks — the caller does, after notifications.
    expect(ackedIds).toEqual([]);
    // The advanced session was committed (a second message still opens).
  });

  it('a burst applies in order and counts unread per frame', async () => {
    queued = [
      { t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay({ body: 'one' })) },
      { t: 'msg', id: 'm2', from: PEER, ciphertext: N(pay({ body: 'two' })) },
    ];
    const r = await drainPersistPending();
    expect(r.applied).toBe(2);
    expect(chatRow().unread).toBe(2);
    expect(chatRow().lastMessage).toBe('two');
    expect(msgRows().map((m) => m.body).sort()).toEqual(['one', 'two']);
  });

  it('replay of an applied frame = re-ack only: no duplicate row, unread stays 1', async () => {
    const wire = N(pay());
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: wire }];
    await drainPersistPending();
    expect(chatRow().unread).toBe(1);
    // Same frame redelivered (e.g. we were killed before the ack landed):
    const r2 = await drainPersistPending();
    expect(r2.applied).toBe(0);
    expect(r2.ackIds).toEqual(['m1']); // bare re-ack
    expect(msgRows().length).toBe(1);
    expect(chatRow().unread).toBe(1);
  });

  it('transaction abort → no row, no ledger mark, NO ack id (frame stays queued)', async () => {
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay()) }];
    failNextTransact = true;
    const r = await drainPersistPending();
    expect(r.applied).toBe(0);
    expect(r.deferred).toBe(1);
    expect(r.ackIds).toEqual([]);
    expect(msgRows().length).toBe(0);
    expect(ledger()).toEqual([]);
    expect(chatRow().unread).toBe(0);
  });

  it('media-by-reference: pendingMedia persisted, bytes NEVER fetched', async () => {
    const mediaRef = { blobId: 'blob-9', fileKey: 'k', mime: 'image/jpeg', size: 1000, name: 'p.jpg', width: 10, height: 10 };
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay({ body: '', kind: 'image', mediaRef })) }];
    const r = await drainPersistPending();
    expect(r.applied).toBe(1);
    const m = msgRows()[0];
    expect(m.pendingMedia?.blobId).toBe('blob-9');
    expect(m.mediaId).toBeUndefined();
    expect(chatRow().lastMessage).toBe('Photo');
    expect(chatRow().lastKind).toBe('image');
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('/blob'))).toBe(false);
  });

  it('deferred frame types are NOT applied and NOT acked (stranger / reaction)', async () => {
    queued = [
      { t: 'msg', id: 's1', from: 'stranger', ciphertext: N(pay()) },
      { t: 'msg', id: 'r1', from: PEER, ciphertext: N(pay({ reaction: { messageId: 'x', emoji: '❤️', at: 1 } })) },
    ];
    const r = await drainPersistPending();
    expect(r.applied).toBe(0);
    expect(r.deferred).toBe(2);
    expect(r.ackIds).toEqual([]);
    expect(msgRows().length).toBe(0);
    expect(chatRow().unread).toBe(0);
    // The deferred reaction's staged decrypt was discarded — a later drain of a
    // subsequent plain message must still work (session on disk untouched by it).
    queued = [{ t: 'msg', id: 'm2', from: PEER, ciphertext: N(pay({ body: 'after' })) }];
    const r2 = await drainPersistPending();
    expect(r2.applied).toBe(1);
  });

  it('ackFrames posts exactly the committed ids to /relay/ack', async () => {
    expect(await ackFrames(['a', 'b'])).toBe(true);
    expect(ackedIds).toEqual([['a', 'b']]);
    expect(await ackFrames([])).toBe(true); // no-op, no request
    expect(ackedIds.length).toBe(1);
  });
});

describe('drain: gate degrades (T019/T022 core)', () => {
  it('explicit flag=false → degrade flag-off, nothing touched (the kill-switch control)', async () => {
    // The default is now ON for everyone (SW_FULL_PERSIST_DEFAULT = true); an explicitly
    // stored `false` is the per-device kill switch and must ALWAYS win over that default,
    // which is how this pins the exact pre-1032 behavior.
    storeOf('settings').set(SW_FULL_PERSIST_KEY, { key: SW_FULL_PERSIST_KEY, value: false });
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay()) }];
    const r = await drainPersistPending();
    expect(r).toMatchObject({ mode: 'degrade', reason: 'flag-off', applied: 0, ackIds: [] });
    expect(msgRows().length).toBe(0);
  });

  it('no stored value → the default (ON for everyone) turns the drain ON', async () => {
    storeOf('settings').delete(SW_FULL_PERSIST_KEY);
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay()) }];
    const r = await drainPersistPending();
    expect(r.mode).toBe('applied');
    expect(r.applied).toBe(1);
  });

  it('no Web Locks → degrade no-locks', async () => {
    vi.stubGlobal('navigator', {});
    const r = await drainPersistPending();
    expect(r).toMatchObject({ mode: 'degrade', reason: 'no-locks' });
    vi.stubGlobal('navigator', locksStub());
  });

  it('locked device → degrade locked BEFORE any fetch/decrypt/write (FR-006)', async () => {
    unlockSpy.mockResolvedValue(false);
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay()) }];
    const before = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const r = await drainPersistPending();
    expect(r).toMatchObject({ mode: 'degrade', reason: 'locked', applied: 0, ackIds: [] });
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before); // no fetch at all
    expect(msgRows().length).toBe(0);
    expect(ledger()).toEqual([]);
  });

  it('empty queue → degrade no-frames (caller runs the preview path / nothing-new logic)', async () => {
    queued = [];
    const r = await drainPersistPending();
    expect(r).toMatchObject({ mode: 'degrade', reason: 'no-frames' });
  });

  it('hidden set unreadable → degrade hidden-unknown (fail closed, like the page)', async () => {
    hiddenSet = null;
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay()) }];
    const r = await drainPersistPending();
    expect(r).toMatchObject({ mode: 'degrade', reason: 'hidden-unknown', applied: 0 });
    expect(msgRows().length).toBe(0);
  });
});

describe('privacy posture parity (T019): applied frames use the SAME note rules as the preview', () => {
  it('a hidden chat is APPLIED (content lands silently) but its note is generic', async () => {
    hiddenSet = new Set([CHAT]);
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay({ body: 'secret hello' })) }];
    const r = await drainPersistPending();
    expect(r.applied).toBe(1); // spec 1027 routing: the hidden 1:1 still receives content
    expect(msgRows()[0].body).toBe('secret hello');
    // ...but the notification is the spec-1019 content-free shape: no sender, no body.
    expect(r.notes.length).toBe(1);
    expect(r.notes[0].title).toBe('Ring');
    expect(r.notes[0].body).toBe('New message');
    expect(r.notes[0].url).toBe('/tabs/chats'); // never deep-links the hidden chat
  });

  it('a muted chat is applied with NO note (badge-only), never a content leak', async () => {
    const c = chatRow();
    c.mutedUntil = Date.now() + 60_000;
    storeOf('chats').set(CHAT, c);
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay({ body: 'muted content' })) }];
    const r = await drainPersistPending();
    expect(r.applied).toBe(1);
    expect(chatRow().unread).toBe(1); // stored + counted...
    expect(r.notes.length).toBe(0); // ...but silent, exactly like the preview path
  });
});

describe('degrade ladder (T022): lock timeout + per-frame failures', () => {
  it('a held inbound lock times out → wake degrades, remaining frames deferred, nothing acked', { timeout: 15_000 }, async () => {
    lockBlocked = (name) => name === 'ring:inbound'; // a frozen page holds it
    queued = [
      { t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay({ body: 'one' })) },
      { t: 'msg', id: 'm2', from: PEER, ciphertext: N(pay({ body: 'two' })) },
    ];
    const r = await drainPersistPending();
    expect(r.mode).toBe('applied');
    expect(r.reason).toBe('lock-timeout');
    expect(r.applied).toBe(0);
    expect(r.deferred).toBe(2);
    expect(r.ackIds).toEqual([]);
    expect(msgRows().length).toBe(0);
    expect(ledger()).toEqual([]);
  });

  it('F7: applied 1:1 content un-pends a pending chat (mirrors the page path)', async () => {
    const c = chatRow();
    c.pending = true;
    storeOf('chats').set(CHAT, c);
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay()) }];
    const r = await drainPersistPending();
    expect(r.applied).toBe(1);
    expect(chatRow().pending).toBeUndefined();
  });

  it('F4: a committed-but-never-shown frame re-acks WITH a rebuilt notification', async () => {
    queued = [{ t: 'msg', id: 'm1', from: PEER, ciphertext: N(pay({ body: 'nearly lost' })) }];
    // Wake 1 commits (row + ledger); the SW dies before showNotes/markShown/ack —
    // i.e. nothing lands in swNotifiedIds. Simulated by just... not marking shown.
    await drainPersistPending();
    // Wake 2: redelivery. The frame is in the seen ledger → ack-only, but the note
    // must be REBUILT from the stored row (never a silent consume).
    const r2 = await drainPersistPending();
    expect(r2.applied).toBe(0);
    expect(r2.ackIds).toEqual(['m1']);
    expect(r2.notes.length).toBe(1);
    expect(r2.notes[0].body).toBe('nearly lost');
    // Once shown (markShown ran), a further redelivery is a bare, silent re-ack.
    storeOf('settings').set('swNotifiedIds', { key: 'swNotifiedIds', value: [{ id: 'm1', ts: Date.now() }] });
    const r3 = await drainPersistPending();
    expect(r3.ackIds).toEqual(['m1']);
    expect(r3.notes.length).toBe(0);
  });

  it('F1: previewPacket under a held session lock falls back to a READ-ONLY decrypt', async () => {
    const { previewPacket } = await import('./messaging');
    const wire = N(pay({ body: 'previewed under contention' }));
    lockBlocked = (name) => name.startsWith('ring:session:');
    const before = structuredClone(storeOf('sessions').get(CHAT));
    const p = await previewPacket(CHAT, wire);
    expect(p.body).toBe('previewed under contention');
    // No lock → no writes: the persisted session is byte-identical.
    expect(storeOf('sessions').get(CHAT)).toEqual(before);
    lockBlocked = null;
    // The page's later authoritative open still decrypts the same frame.
    const { openPacket } = await import('./messaging');
    expect((await openPacket(CHAT, wire)).body).toBe('previewed under contention');
  }, 15_000);

  it('one undecryptable frame defers WITHOUT stopping the rest of the wake', async () => {
    const good = N(pay({ body: 'fine' }));
    const forged = structuredClone(N(pay({ body: 'broken' }))) as WirePacket & { msg: { env: { ct: string } } };
    forged.msg.env.ct = forged.msg.env.ct.slice(0, -4) + 'AAAA';
    queued = [
      { t: 'msg', id: 'bad1', from: PEER, ciphertext: forged },
      { t: 'msg', id: 'ok1', from: PEER, ciphertext: good },
    ];
    const r = await drainPersistPending();
    expect(r.applied).toBe(1);
    expect(r.deferred).toBe(1);
    expect(r.ackIds).toEqual(['ok1']);
    expect(msgRows().map((m) => m.body)).toEqual(['fine']);
  });
});
