// Spec 1025 (US2): with the global "Show preview" off, a message notification must hide WHO it's
// from too (a generic title), not just the body — in both a 1:1 and a group. Hidden-chat precedence
// (covered in sw-inbox.hidden.test.ts) still wins regardless of this setting.
import { describe, it, expect } from 'vitest';
import { noteForPayload } from './sw-inbox';
import type { Chat } from '@/db/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const frame = { id: 'm1', from: 'peer-1', t: 'msg', ciphertext: '' } as any;
const dm = { text: 'secret plans' } as any;
const groupMsg = (gid: string) => ({ text: 'secret plans', groupId: gid }) as any;
const contacts = [{ id: 'peer-1', name: 'Peer One' }] as any;
const oneToOne = (id: string): Chat =>
  ({ id, name: 'Peer', isGroup: false, participantIds: ['peer-1'] }) as unknown as Chat;
const group = (id: string): Chat =>
  ({ id, name: 'Secret Team', isGroup: true, participantIds: ['peer-1', 'me'] }) as unknown as Chat;

describe('noteForPayload — Show preview off (spec 1025 US2)', () => {
  it('1:1: preview off → generic title AND body, no sender leak', () => {
    const { note } = noteForPayload(frame, dm, [oneToOne('chat-1')], contacts, true, /* showPreview */ false);
    expect(note!.title).toBe('Ring'); // sender hidden
    expect(note!.body).toBe('New message'); // content hidden
    expect(JSON.stringify(note)).not.toContain('Peer One');
    expect(JSON.stringify(note)).not.toContain('secret plans');
  });

  it('group: preview off → generic title, does not reveal the group name', () => {
    const { note } = noteForPayload(frame, groupMsg('chat-2'), [group('chat-2')], contacts, true, false);
    expect(note!.title).toBe('Ring');
    expect(JSON.stringify(note)).not.toContain('Secret Team');
  });

  it('preview on → sender / group name still shown (unchanged behaviour)', () => {
    expect(noteForPayload(frame, dm, [oneToOne('c3')], contacts, true, true).note!.title).toBe('Peer One');
    expect(noteForPayload(frame, groupMsg('c4'), [group('c4')], contacts, true, true).note!.title).toBe('Secret Team');
  });
});
