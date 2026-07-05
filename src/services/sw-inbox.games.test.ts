// Spec 0008 (US3): a game MOVE is the one side-effect signal that notifies —
// "Your move" demands the opponent's attention — but it must sit behind exactly
// the same privacy gates as an ordinary message: global master, per-chat mute,
// per-chat web-push, content prefs, global "Show preview", and hidden chats
// (SC-007: game activity never leaks more than a plain message would).
import { describe, it, expect } from 'vitest';
import { noteForPayload } from './sw-inbox';
import type { Chat } from '@/db/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const frame = { id: 'f1', from: 'peer-1', t: 'msg', ciphertext: '' } as any;
const move = { gameMove: { messageId: 'g1', seq: 2, action: 'move', move: { cell: 4 }, at: 1 } } as any;
const resign = { gameMove: { messageId: 'g1', seq: 3, action: 'resign', at: 2 } } as any;
const contacts = [{ id: 'peer-1', name: 'Peer One' }] as any;
const chat = (over: Partial<Chat> = {}): Chat =>
  ({ id: 'chat-1', name: 'Peer', isGroup: false, participantIds: ['peer-1'], ...over }) as unknown as Chat;

describe('noteForPayload — game moves (spec 0008 US3/T041)', () => {
  it('an incoming move names the mover: "X made a move, your turn 😏"', () => {
    const { note } = noteForPayload(frame, move, [chat()], contacts, true, true);
    expect(note!.title).toBe('Peer One');
    expect(note!.body).toBe('Peer One made a move, your turn 😏');
    expect(note!.url).toBe('/chat/chat-1');
  });

  it('a resign names the winner (you): the resigner always loses', () => {
    const { note } = noteForPayload(frame, resign, [chat()], contacts, true, true);
    expect(note!.body).toBe('Peer One gave up. You win! 🏆');
  });

  it('a game-ending move names the WINNER, derived from the stored session (web push)', () => {
    // The stored bubble (received, so we are player 1) one move from the
    // sender's win: applying seq 5 cell 2 completes 0-1-2 for player 0.
    const gameRow = {
      id: 'g1',
      outgoing: false,
      game: {
        gameType: 'tictactoe',
        moves: [
          { seq: 1, player: 0, move: { cell: 0 }, at: 1 },
          { seq: 2, player: 1, move: { cell: 4 }, at: 2 },
          { seq: 3, player: 0, move: { cell: 1 }, at: 3 },
          { seq: 4, player: 1, move: { cell: 5 }, at: 4 },
        ],
      },
    } as any;
    const winning = { gameMove: { messageId: 'g1', seq: 5, action: 'move', move: { cell: 2 }, at: 5 } } as any;
    const { note } = noteForPayload(frame, winning, [chat()], contacts, true, true, new Set(), '', gameRow);
    expect(note!.body).toBe('Peer One won the game 🏆');
  });

  it('muted chat → silenced, no notification (matches ordinary messages)', () => {
    const r = noteForPayload(frame, move, [chat({ mutedUntil: Date.now() + 60_000 })], contacts, true, true);
    expect(r.note).toBeNull();
  });

  it('per-chat web push off → silenced', () => {
    const r = noteForPayload(frame, move, [chat({ notifyWebPush: false })], contacts, true, true);
    expect(r.note).toBeNull();
  });

  it("content 'none' → badge-only, no notification", () => {
    const r = noteForPayload(frame, move, [chat({ notifyContent: 'none' })], contacts, true, true);
    expect(r.note).toBeNull();
  });

  it("content 'generic' → content-free body, nothing game-shaped leaks", () => {
    const { note } = noteForPayload(frame, move, [chat({ notifyContent: 'generic' })], contacts, true, true);
    expect(note!.body).toBe('New message');
    expect(JSON.stringify(note)).not.toContain('move');
  });

  it('global "Show preview" off → generic title AND body', () => {
    const { note } = noteForPayload(frame, move, [chat()], contacts, true, false);
    expect(note!.title).toBe('Ring');
    expect(note!.body).toBe('New message');
  });

  it('hidden chat → the exact content-free note an ordinary message gets', () => {
    const { note } = noteForPayload(frame, move, [chat()], contacts, true, true, new Set(['chat-1']));
    expect(note!.title).toBe('Ring');
    expect(note!.body).toBe('New message');
    expect(note!.url).toBe('/tabs/chats'); // never deep-links into the hidden chat
  });

  it('global "Show notifications" off → nothing', () => {
    const r = noteForPayload(frame, move, [chat()], contacts, false, true);
    expect(r.note).toBeNull();
  });
});
