// Spec 1048 (US2): a group message that directly REPLIES to one of my messages is
// personally directed — the SW escalates it exactly like an @mention (spec 1020):
// same notifyMentions gate, same silencer set, "replied to you" wording. These pin
// contract Table 2 (specs/1048-notify-reactions-messages/contracts/).
import { describe, it, expect } from 'vitest';
import { noteForPayload } from './sw-inbox';
import type { Chat, Contact } from '@/db/types';
import type { MessagePayload } from './crypto/message';

const SELF = 'self-1';
const PEER = 'peer-1';

const contacts = [{ id: PEER, name: 'Alice Smith' }] as unknown as Contact[];
const frame = { t: 'msg', id: 'f1', from: PEER };

const mutedGroup = (over: Partial<Chat> = {}): Chat =>
  ({
    id: 'g1',
    isGroup: true,
    participantIds: [PEER, 'peer-2'],
    name: 'Team',
    mutedUntil: Date.now() + 60_000,
    ...over,
  }) as unknown as Chat;

/** A plain group text that replies to the quoted message's author `senderId`. */
const replyMsg = (senderId: string, over: Record<string, unknown> = {}): MessagePayload =>
  ({
    body: 'sure, tomorrow works',
    kind: 'text',
    timestamp: 2,
    groupId: 'g1',
    reply: { id: 'm1', senderId, preview: 'hi there' },
    ...over,
  }) as unknown as MessagePayload;

function run(payload: MessagePayload, chat: Chat, opts: { showPreview?: boolean } = {}) {
  return noteForPayload(frame, payload, [chat], contacts, true, opts.showPreview ?? true, new Set(), SELF);
}

describe('spec 1048 US2 — replies-to-me escalate in the SW like mentions', () => {
  it('a reply to MY message pierces a muted group, naming the replier', () => {
    const r = run(replyMsg(SELF), mutedGroup());
    expect(r.note).toMatchObject({
      title: 'Team',
      body: 'Alice Smith replied to you: sure, tomorrow works',
      url: '/chat/g1',
      tag: 'ring:g1',
    });
    expect(r.wasMessage).toBe(true);
  });

  it('masked content still names the replier without the text', () => {
    const chat = mutedGroup({ notifyContent: 'generic' } as Partial<Chat>);
    const r = run(replyMsg(SELF), chat);
    expect(r.note?.body).toBe('Alice Smith replied to you');
  });

  it('the notifyMentions pref gates it: off → ordinary muted handling (silenced)', () => {
    const chat = mutedGroup({ notifyMentions: false } as Partial<Chat>);
    const r = run(replyMsg(SELF), chat);
    expect(r.note).toBeNull();
    expect(r.silenced).toBe(true);
  });

  it("a reply to someone ELSE's message stays an ordinary muted message", () => {
    const r = run(replyMsg('peer-2'), mutedGroup());
    expect(r.note).toBeNull();
    expect(r.silenced).toBe(true);
  });

  it('1:1 replies never escalate (no groupId → ordinary handling)', () => {
    const dm = { id: 'c1', isGroup: false, participantIds: [PEER], name: 'Alice Smith', mutedUntil: Date.now() + 60_000 } as unknown as Chat;
    const p = replyMsg(SELF, { groupId: undefined });
    const r = noteForPayload(frame, p, [dm], contacts, true, true, new Set(), SELF);
    expect(r.note).toBeNull();
    expect(r.silenced).toBe(true);
  });

  it('a reply that ALSO mentions me renders the mention wording, once', () => {
    const r = run(replyMsg(SELF, { mentions: [SELF] }), mutedGroup());
    expect(r.note?.body).toBe('Alice Smith mentioned you: sure, tomorrow works');
  });

  it('hidden still wins: a hidden muted group reply shows only the traceless generic', () => {
    const r = noteForPayload(frame, replyMsg(SELF), [mutedGroup()], contacts, true, true, new Set(['g1']), SELF);
    expect(r.note).toMatchObject({ title: 'Ring', body: 'New message', url: '/tabs/chats' });
  });

  it('an unmuted group reply produces ONE note (the escalation wording, never a duplicate)', () => {
    const chat = mutedGroup({ mutedUntil: undefined } as Partial<Chat>);
    const r = run(replyMsg(SELF), chat);
    expect(r.note?.body).toBe('Alice Smith replied to you: sure, tomorrow works');
    expect(r.wasMessage).toBe(true);
  });
});
