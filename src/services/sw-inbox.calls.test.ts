// Spec 1040: the closed-app (service worker) side of call + friend-request
// notifications. These tests pin the pure cores: the callEvent branch of
// noteForPayload (missed-call replacement note, hidden-chat silence) and
// classifyConnEvents (truthful friend-request outcome copy + at-most-once
// dedup). The IO wrappers (previewPending / previewCallRing /
// previewConnections) only feed them fetch/IDB/ledger state.
import { describe, it, expect } from 'vitest';
import { noteForPayload, classifyConnEvents } from './sw-inbox';
import type { MessagePayload, CallEventSignal } from './crypto/message';
import type { Chat, Contact } from '@/db/types';

const NOW = 1_800_000_000_000;

const chat = (over: Partial<Chat>): Chat =>
  ({
    id: 'chat-1',
    name: 'Kamran',
    avatar: '',
    isGroup: false,
    participantIds: ['kamran'],
    lastMessage: '',
    lastMessageTime: NOW,
    unread: 0,
    updatedAt: NOW,
    ...over,
  }) as Chat;

const contact = (id: string, name: string): Contact => ({ id, name, avatar: '' }) as Contact;

const frame = { t: 'msg', id: 'f1', from: 'kamran', ciphertext: 'SEALED' } as Parameters<typeof noteForPayload>[0];

const payloadWith = (ev: CallEventSignal): MessagePayload =>
  ({ body: '', kind: 'callevent', timestamp: NOW, callEvent: ev }) as MessagePayload;

const ended = (over: Partial<CallEventSignal> = {}): CallEventSignal => ({
  phase: 'ended',
  callId: 'c1',
  kind: 'audio',
  outcome: 'missed',
  at: NOW,
  ...over,
});

const run = (
  ev: CallEventSignal,
  opts: { chats?: Chat[]; contacts?: Contact[]; hidden?: Set<string> } = {},
): ReturnType<typeof noteForPayload> =>
  noteForPayload(
    frame,
    payloadWith(ev),
    opts.chats ?? [chat({})],
    opts.contacts ?? [contact('kamran', 'Kamran')],
    true,
    true,
    opts.hidden ?? new Set(),
  );

describe('noteForPayload — missed-call replacement (US2, FR-012/FR-012a)', () => {
  it('a missed 1:1 audio call names the caller and deep-links the chat', () => {
    const { note, wasMessage } = run(ended());
    expect(wasMessage).toBe(false);
    expect(note).toMatchObject({
      title: 'Kamran',
      body: 'Missed call ☎️',
      url: '/chat/chat-1',
      tag: 'ring-call', // replaces the "Incoming call" alert in place
    });
  });

  it('a missed video call says so', () => {
    expect(run(ended({ kind: 'video' }))?.note?.body).toBe('Missed video call ☎️');
  });

  it('cancelled (caller hung up before answer) reads as a missed call too', () => {
    expect(run(ended({ outcome: 'cancelled' }))?.note?.body).toBe('Missed call ☎️');
  });

  it('a group call names the group and the caller, deep-linking the group chat', () => {
    const g = chat({ id: 'room-1', name: 'Weekend Trip', isGroup: true, participantIds: ['kamran', 'sara'] });
    const { note } = run(ended({ roomId: 'room-1' }), { chats: [g] });
    expect(note).toMatchObject({
      title: 'Weekend Trip',
      body: 'Missed call from Kamran ☎️',
      url: '/chat/room-1',
    });
  });

  it('an ad-hoc group call (no group chat) falls back to the Calls tab', () => {
    const { note } = run(ended({ roomId: 'room-x' }), { chats: [] });
    expect(note).toMatchObject({ title: 'Kamran', url: '/tabs/calls' });
  });

  it('an unknown caller never shows a raw id (FR-006)', () => {
    const { note } = run(ended(), { chats: [], contacts: [] });
    expect(note?.title).toBe('Someone');
    expect(JSON.stringify(note)).not.toContain('kamran');
  });

  it('a hidden chat shows NOTHING — even a nameless alert would leak hidden activity (FR-005)', () => {
    expect(run(ended(), { hidden: new Set(['chat-1']) }).note).toBeNull();
  });

  it('ring markers are silent here (the call tickle owns the ring alert)', () => {
    expect(run({ phase: 'ring', callId: 'c1', kind: 'audio', at: NOW }).note).toBeNull();
  });

  it('an answered outcome is silent (sw.ts closes the ring alert instead)', () => {
    expect(run(ended({ outcome: 'answered' })).note).toBeNull();
  });
});

describe('classifyConnEvents — truthful friend-request outcomes (US3)', () => {
  it('an accepted outgoing request announces the acceptance, never "new friend request" (FR-019)', () => {
    const { events } = classifyConnEvents({ outgoing: [{ target: 'kamran', state: 'accepted' }] }, new Set());
    expect(events).toEqual([
      { key: 'acc:kamran', userId: 'kamran', body: 'accepted your friend request', tag: 'ring:conn:acc:kamran' },
    ]);
  });

  it('a declined outgoing request announces the decline (FR-020)', () => {
    const { events } = classifyConnEvents({ outgoing: [{ target: 'kamran', state: 'rejected' }] }, new Set());
    expect(events[0]?.body).toBe('declined your friend request');
  });

  it('an incoming pending request keeps the existing copy and count', () => {
    const { events, pendingIncoming } = classifyConnEvents(
      { incoming: [{ requester: 'sara', state: 'pending' }] },
      new Set(),
    );
    expect(pendingIncoming).toBe(1);
    expect(events[0]?.body).toBe('wants to be friends');
  });

  it('the dedup ledger announces each outcome at most once (FR-022)', () => {
    const { events } = classifyConnEvents(
      { outgoing: [{ target: 'kamran', state: 'accepted' }] },
      new Set(['acc:kamran']),
    );
    expect(events).toEqual([]);
  });

  it('a pending outgoing request announces nothing', () => {
    expect(classifyConnEvents({ outgoing: [{ target: 'k', state: 'pending' }] }, new Set()).events).toEqual([]);
  });
});
