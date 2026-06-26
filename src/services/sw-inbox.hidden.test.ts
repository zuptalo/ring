// Spec 1019 (US4): a message into a HIDDEN chat must produce a generic,
// content-free notification (no sender, avatar, or body) whose tap lands on the
// Chats tab — never the hidden chat. A non-hidden chat is unaffected.
import { describe, it, expect } from 'vitest';
import { noteForPayload } from './sw-inbox';
import type { Chat } from '@/db/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const frame = { id: 'm1', from: 'peer-1', t: 'msg', ciphertext: '' } as any;
const payload = { text: 'secret plans' } as any;

const oneToOne = (id: string): Chat =>
  ({ id, name: 'Peer', isGroup: false, participantIds: ['peer-1'] }) as unknown as Chat;
const contacts = [{ id: 'peer-1', name: 'Peer One' }] as any;

describe('noteForPayload — hidden chats', () => {
  it('renders a generic, content-free note for a hidden chat (FR-007/FR-008)', () => {
    const chat = oneToOne('chat-1');
    const { note } = noteForPayload(frame, payload, [chat], contacts, true, true, new Set(['chat-1']));
    expect(note).toBeTruthy();
    expect(note!.title).toBe('Ring'); // no sender name
    expect(note!.body).toBe('New message'); // no message content
    expect(note!.url).toBe('/tabs/chats'); // tap never opens the hidden chat
    // No plaintext leaks into the note at all.
    expect(JSON.stringify(note)).not.toContain('secret plans');
    expect(JSON.stringify(note)).not.toContain('Peer One');
  });

  it('a non-hidden chat still shows the sender and a real preview', () => {
    const chat = oneToOne('chat-2');
    const { note } = noteForPayload(frame, payload, [chat], contacts, true, true, new Set(['chat-1']));
    expect(note!.title).toBe('Peer One'); // sender shown
    expect(note!.url).toBe('/chat/chat-2'); // deep-links into the chat
  });

  it('fails safe: with no hidden set provided, behaves normally (default empty)', () => {
    const chat = oneToOne('chat-3');
    const { note } = noteForPayload(frame, payload, [chat], contacts, true, true);
    expect(note!.title).toBe('Peer One');
  });
});
