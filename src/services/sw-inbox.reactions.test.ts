// Spec 1048 (US1/US3): the SW builds a notification for a reaction to MY message —
// and ONLY then. These tests pin contract Table 1
// (specs/1048-notify-reactions-messages/contracts/notification-decisions.md): who
// gets a note, how it masks, and — critically for push health (FR-013) — that every
// suppressed outcome keeps the exact pre-1048 shape `{note:null, wasMessage:false}`,
// so the established visible-wake fallback (specs 2016/2017/2023) applies unchanged.
import { describe, it, expect } from 'vitest';
import { noteForPayload } from './sw-inbox';
import type { Chat, Contact, Message } from '@/db/types';
import type { MessagePayload } from './crypto/message';

const SELF = 'self-1';
const PEER = 'peer-1';

const contacts = [{ id: PEER, name: 'Alice Smith' }] as unknown as Contact[];

const dmChat = { id: 'c1', isGroup: false, participantIds: [PEER], name: 'Alice Smith' } as unknown as Chat;
const groupChat = { id: 'g1', isGroup: true, participantIds: [PEER, 'peer-2'], name: 'Team' } as unknown as Chat;

/** My own stored message (the reaction target). */
const myMsg = (over: Partial<Message> = {}): Message =>
  ({ id: 'm1', chatId: 'c1', senderId: 'me', outgoing: true, body: 'hi there', timestamp: 1, updatedAt: 1, ...over }) as Message;

const frame = { t: 'msg', id: 'f1', from: PEER };

const reaction = (over: Record<string, unknown> = {}): MessagePayload =>
  ({ body: '', kind: 'reaction', timestamp: 2, reaction: { messageId: 'm1', emoji: '❤️', remove: false, at: 2 }, ...over }) as MessagePayload;

type Ctx = { row?: Message; prefs?: { dm: boolean; group: boolean; tone: string } };
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ row: myMsg(), prefs: { dm: true, group: true, tone: 'pop' }, ...over });

/** The pre-1048 outcome for every reaction frame — suppressed cases must keep it EXACTLY. */
const SILENT_SIDE_EFFECT = { note: null, wasMessage: false };

function run(
  payload: MessagePayload,
  chats: Chat[],
  rc: Ctx | undefined,
  opts: { showMessages?: boolean; showPreview?: boolean; hidden?: Set<string>; selfId?: string } = {},
) {
  return noteForPayload(
    frame,
    payload,
    chats,
    contacts,
    opts.showMessages ?? true,
    opts.showPreview ?? true,
    opts.hidden ?? new Set(),
    opts.selfId ?? SELF,
    undefined,
    rc,
  );
}

describe('spec 1048 US1 — reaction notes (SW path, contract Table 1)', () => {
  it('1:1 reaction to my message → note under the chat tag, reactor tone not silent', () => {
    const r = run(reaction(), [dmChat], ctx());
    expect(r.wasMessage).toBe(false);
    expect(r.note).toMatchObject({
      title: 'Alice Smith',
      body: 'Reacted ❤️ to: hi there',
      url: '/chat/c1',
      tag: 'ring:c1',
    });
    expect(r.note?.silent).toBeFalsy();
  });

  it('group reaction names the reactor in the body, group name in the title', () => {
    const r = run(reaction({ groupId: 'g1' }), [groupChat], ctx({ row: myMsg({ chatId: 'g1' }) }));
    expect(r.note).toMatchObject({
      title: 'Team',
      body: 'Alice reacted ❤️ to: hi there',
      tag: 'ring:g1',
      url: '/chat/g1',
    });
  });

  it("tone 'none' → the note shows but is silent (visible wake, no sound)", () => {
    const r = run(reaction(), [dmChat], ctx({ prefs: { dm: true, group: true, tone: 'none' } }));
    expect(r.note).not.toBeNull();
    expect(r.note?.silent).toBe(true);
  });

  it('a media target (no body text) still reads naturally', () => {
    const r = run(reaction(), [dmChat], ctx({ row: myMsg({ body: '' }) }));
    expect(r.note?.body).toBe('Reacted ❤️ to your message');
  });

  it('long target text is truncated to a short snippet', () => {
    const long = 'x'.repeat(200);
    const r = run(reaction(), [dmChat], ctx({ row: myMsg({ body: long }) }));
    expect((r.note?.body ?? '').length).toBeLessThan(120);
  });
});

describe('spec 1048 US1 — never-notify set (FR-006): silent side effects keep the pre-1048 shape', () => {
  it('reaction REMOVAL stays silent', () => {
    const p = reaction();
    (p.reaction as { remove?: boolean }).remove = true;
    expect(run(p, [dmChat], ctx())).toEqual(SILENT_SIDE_EFFECT);
  });

  it("a reaction to someone ELSE's message stays silent", () => {
    expect(run(reaction(), [dmChat], ctx({ row: myMsg({ senderId: PEER, outgoing: false }) }))).toEqual(SILENT_SIDE_EFFECT);
  });

  it('my own reaction echoed from my other device stays silent', () => {
    const r = noteForPayload(
      { ...frame, from: SELF },
      reaction(),
      [dmChat],
      contacts,
      true,
      true,
      new Set(),
      SELF,
      undefined,
      ctx(),
    );
    expect(r).toEqual(SILENT_SIDE_EFFECT);
  });

  it('an unresolvable target (deleted / not yet arrived) stays silent — no orphan note', () => {
    expect(run(reaction(), [dmChat], ctx({ row: undefined }))).toEqual(SILENT_SIDE_EFFECT);
  });

  it('no prefetched context at all (e.g. a deferring drain path) stays silent', () => {
    expect(run(reaction(), [dmChat], undefined)).toEqual(SILENT_SIDE_EFFECT);
  });
});

describe('spec 1048 US1/US3 — suppression layers (FR-005): reactions NEVER escalate', () => {
  it('1:1 toggle off → silent, exact pre-1048 shape', () => {
    expect(run(reaction(), [dmChat], ctx({ prefs: { dm: false, group: true, tone: 'pop' } }))).toEqual(SILENT_SIDE_EFFECT);
  });

  it('group toggle off → silent for the group reaction', () => {
    const r = run(reaction({ groupId: 'g1' }), [groupChat], ctx({ row: myMsg({ chatId: 'g1' }), prefs: { dm: true, group: false, tone: 'pop' } }));
    expect(r).toEqual(SILENT_SIDE_EFFECT);
  });

  it('the toggles are independent: 1:1 off leaves group reactions alerting (and vice versa)', () => {
    const dmOff = { dm: false, group: true, tone: 'pop' };
    expect(run(reaction({ groupId: 'g1' }), [groupChat], ctx({ row: myMsg({ chatId: 'g1' }), prefs: dmOff })).note).not.toBeNull();
    const groupOff = { dm: true, group: false, tone: 'pop' };
    expect(run(reaction(), [dmChat], ctx({ prefs: groupOff })).note).not.toBeNull();
  });

  it('muted chat → silent (a reaction never pierces mute, unlike a mention)', () => {
    const muted = { ...dmChat, mutedUntil: Date.now() + 60_000 } as Chat;
    expect(run(reaction(), [muted], ctx())).toEqual(SILENT_SIDE_EFFECT);
  });

  it('per-chat web push off → silent', () => {
    const off = { ...dmChat, notifyWebPush: false } as Chat;
    expect(run(reaction(), [off], ctx())).toEqual(SILENT_SIDE_EFFECT);
  });

  it("content 'none' (badge-only chat) → silent", () => {
    const none = { ...dmChat, notifyContent: 'none' } as Chat;
    expect(run(reaction(), [none], ctx())).toEqual(SILENT_SIDE_EFFECT);
  });

  it('hidden chat → traceless, exactly as today', () => {
    expect(run(reaction(), [dmChat], ctx(), { hidden: new Set(['c1']) })).toEqual(SILENT_SIDE_EFFECT);
  });

  it('global "Show notifications" off → silent', () => {
    expect(run(reaction(), [dmChat], ctx(), { showMessages: false })).toEqual(SILENT_SIDE_EFFECT);
  });
});

describe('spec 1048 US1 — content masking (FR-002/SC-006)', () => {
  it("per-chat content 'generic' → generic body, chat still named", () => {
    const generic = { ...dmChat, notifyContent: 'generic' } as Chat;
    const r = run(reaction(), [generic], ctx());
    expect(r.note?.body).toBe('New message');
    expect(r.note?.title).toBe('Alice Smith');
  });

  it('global preview off → fully generic (no reactor, no text)', () => {
    const r = run(reaction(), [dmChat], ctx(), { showPreview: false });
    expect(r.note?.title).toBe('Ring');
    expect(r.note?.body).toBe('New message');
  });
});

describe('spec 1048 — the OTHER side-effect signals stay silent (regression guard)', () => {
  it('poll votes / edits / erases are untouched by the reaction branch', () => {
    for (const extra of [{ pollVote: { messageId: 'm1', option: 0 } }, { edit: { messageId: 'm1', body: 'x' } }, { erase: { messageId: 'm1' } }]) {
      const p = { body: '', kind: 'text', timestamp: 2, ...extra } as unknown as MessagePayload;
      expect(run(p, [dmChat], ctx())).toEqual(SILENT_SIDE_EFFECT);
    }
  });
});
