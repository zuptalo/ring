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
    const { note } = noteForPayload(frame, winning, [chat()], contacts, true, true, new Set(), '', {
      row: gameRow,
    });
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

// Spec 0009 US2 — group games in the SW: players-only turn alerts, quiet
// observers, follow-gated updates, all decided from the stored session row
// (players + selfId) and the device's own prefs/follow set.
describe('noteForPayload — GROUP game moves (spec 0009 US2)', () => {
  const gframe = { id: 'f2', from: 'peer-1', t: 'msg', ciphertext: '' } as any;
  const gchat = (): Chat =>
    ({ id: 'g1', name: 'Arena', isGroup: true, participantIds: ['peer-1', 'peer-2'] }) as unknown as Chat;
  const gmove = (seq: number, cell: number, opponent?: string) =>
    ({ groupId: 'g1', gameMove: { messageId: 'gc1', seq, action: 'move', move: { cell }, at: seq, opponent } }) as any;
  // A seated group session where I ('me') am player 1 vs peer-1.
  const playerRow = (moves: any[] = []) =>
    ({
      id: 'gc1',
      outgoing: false,
      game: { gameType: 'tictactoe', players: ['peer-1', 'me'], challenge: { accepts: [{ userId: 'me', at: 1 }] }, moves },
    }) as any;
  // A session I merely observe (two other players).
  const observerRow = (moves: any[] = []) =>
    ({
      id: 'gc1',
      outgoing: false,
      game: { gameType: 'tictactoe', players: ['peer-1', 'peer-2'], challenge: { accepts: [{ userId: 'peer-2', at: 1 }] }, moves },
    }) as any;

  it("the seated player gets 'your turn' when the opponent's move lands", () => {
    const { note } = noteForPayload(gframe, gmove(1, 4, 'me'), [gchat()], contacts, true, true, new Set(), 'me', {
      row: playerRow(),
    });
    expect(note!.body).toBe('Peer One made a move, your turn 😏');
    expect(note!.url).toBe('/chat/g1');
  });

  it('observers stay silent by default', () => {
    const r = noteForPayload(gframe, gmove(1, 4, 'peer-2'), [gchat()], contacts, true, true, new Set(), 'me', {
      row: observerRow(),
    });
    expect(r.note).toBeNull();
  });

  it('a FOLLOWED game notifies the observer per move, named', () => {
    const { note } = noteForPayload(gframe, gmove(1, 4, 'peer-2'), [gchat()], contacts, true, true, new Set(), 'me', {
      row: observerRow(),
      follows: { gc1: 123 },
    });
    expect(note!.body).toBe('Peer One made a move 🎲');
  });

  it('a followed game names the winner at the end', () => {
    // peer-1 (cells 0,1) one move from the top-row win; peer-2 on 3,4.
    const moves = [
      { seq: 1, player: 0, move: { cell: 0 }, at: 1 },
      { seq: 2, player: 1, move: { cell: 3 }, at: 2 },
      { seq: 3, player: 0, move: { cell: 1 }, at: 3 },
      { seq: 4, player: 1, move: { cell: 4 }, at: 4 },
    ];
    const { note } = noteForPayload(gframe, gmove(5, 2), [gchat()], contacts, true, true, new Set(), 'me', {
      row: observerRow(moves),
      follows: { gc1: 123 },
    });
    expect(note!.body).toBe('Peer One won the game 🏆');
  });

  it('the games.turn preference silences even the seated player', () => {
    const r = noteForPayload(gframe, gmove(1, 4, 'me'), [gchat()], contacts, true, true, new Set(), 'me', {
      row: playerRow(),
      prefs: { turn: false, challenges: true, followMoves: true, followResults: true },
    });
    expect(r.note).toBeNull();
  });

  it('the followMoves preference silences follower move updates (results still land)', () => {
    const prefs = { turn: true, challenges: true, followMoves: false, followResults: true };
    const mid = noteForPayload(gframe, gmove(1, 4, 'peer-2'), [gchat()], contacts, true, true, new Set(), 'me', {
      row: observerRow(),
      follows: { gc1: 123 },
      prefs,
    });
    expect(mid.note).toBeNull();
  });

  it("an accept tells the CHALLENGER someone is in (behind games.challenges)", () => {
    const acceptPayload = { groupId: 'g1', gameAccept: { messageId: 'gc1', at: 5 } } as any;
    const myChallenge = {
      id: 'gc1',
      outgoing: true,
      game: { gameType: 'tictactoe', players: ['me'], challenge: { accepts: [] }, moves: [] },
    } as any;
    const { note } = noteForPayload(gframe, acceptPayload, [gchat()], contacts, true, true, new Set(), 'me', {
      row: myChallenge,
    });
    expect(note!.body).toBe('Peer One accepted your challenge 💪 Your move!');
    const off = noteForPayload(gframe, acceptPayload, [gchat()], contacts, true, true, new Set(), 'me', {
      row: myChallenge,
      prefs: { turn: true, challenges: false, followMoves: true, followResults: true },
    });
    expect(off.note).toBeNull();
  });
});

// Spec 0009 US3 — wall games in the SW: the audience-wide 'post-activity' push
// wakes a closed app; the pure classifier replays the fetched game rows and
// decides from seats + follow + prefs whether (and what) to notify.
import { classifyWallGameActivity } from './sw-inbox';

describe('classifyWallGameActivity — wall games on push wake (spec 0009 US3)', () => {
  const openGame = (_k: string, payload: string) => JSON.parse(payload);
  const gpost = { id: 'p1', author: 'alice', outgoing: false, postKey: 'K', game: { gameType: 'tictactoe' } };
  const row = (id: string, actor: string, payload: unknown, createdAt = 5) =>
    ({ id, actor, kind: 'game', payload: JSON.stringify(payload), createdAt }) as any;
  const prefs = { turn: true, challenges: true, followMoves: true, followResults: true };
  const names = new Map([['alice', 'Alice'], ['bob', 'Bob']]);

  it("the seated acceptor is told it's their turn when the author's move lands", () => {
    const rows = [
      row('e1', 'me', { t: 'accept', at: 1 }),
      row('e2', 'alice', { t: 'move', seq: 1, action: 'move', move: { cell: 4 }, at: 2, opponent: 'me' }),
    ];
    const r = classifyWallGameActivity({
      post: gpost, self: 'me', rows, seen: new Set(['e1']), prefs, followed: false, openGame, names,
    });
    expect(r?.note?.body).toBe('Alice made a move, your turn 😏');
    expect(r?.keys).toEqual(['e2']);
  });

  it('a quiet observer gets keys ledgered but NO note; a follower gets the named move', () => {
    const rows = [
      row('e1', 'bob', { t: 'accept', at: 1 }),
      row('e2', 'alice', { t: 'move', seq: 1, action: 'move', move: { cell: 4 }, at: 2, opponent: 'bob' }),
    ];
    const quiet = classifyWallGameActivity({
      post: gpost, self: 'me', rows, seen: new Set(['e1']), prefs, followed: false, openGame, names,
    });
    expect(quiet?.note).toBeNull();
    expect(quiet?.keys).toEqual(['e2']);
    const loud = classifyWallGameActivity({
      post: gpost, self: 'me', rows, seen: new Set(['e1']), prefs, followed: true, openGame, names,
    });
    expect(loud?.note?.body).toBe('Alice made a move 🎲');
  });

  it('the challenger hears the accept; the prefs switch silences it', () => {
    const own = { ...gpost, author: 'me', outgoing: true };
    const rows = [row('e1', 'bob', { t: 'accept', at: 1 })];
    const r = classifyWallGameActivity({
      post: own, self: 'me', rows, seen: new Set(), prefs, followed: false, openGame, names,
    });
    expect(r?.note?.body).toBe('Bob accepted your challenge 💪 Your move!');
    const off = classifyWallGameActivity({
      post: own, self: 'me', rows, seen: new Set(),
      prefs: { ...prefs, challenges: false }, followed: false, openGame, names,
    });
    expect(off?.note).toBeNull();
  });

  it('a followed finish names the winner; nothing fresh → null', () => {
    const rows = [
      row('e1', 'bob', { t: 'accept', at: 1 }),
      row('e2', 'alice', { t: 'move', seq: 1, action: 'move', move: { cell: 0 }, at: 2, opponent: 'bob' }),
      row('e3', 'bob', { t: 'move', seq: 2, action: 'move', move: { cell: 3 }, at: 3 }),
      row('e4', 'alice', { t: 'move', seq: 3, action: 'move', move: { cell: 1 }, at: 4 }),
      row('e5', 'bob', { t: 'move', seq: 4, action: 'move', move: { cell: 4 }, at: 5 }),
      row('e6', 'alice', { t: 'move', seq: 5, action: 'move', move: { cell: 2 }, at: 6 }), // 0-1-2 win
    ];
    const r = classifyWallGameActivity({
      post: gpost, self: 'me', rows, seen: new Set(['e1', 'e2', 'e3', 'e4', 'e5']), prefs, followed: true, openGame, names,
    });
    expect(r?.note?.body).toBe('Alice won the game 🏆');
    const nothing = classifyWallGameActivity({
      post: gpost, self: 'me', rows, seen: new Set(rows.map((x) => x.id)), prefs, followed: true, openGame, names,
    });
    expect(nothing).toBeNull();
  });

  it('a non-game post or a missing key stays silent', () => {
    expect(
      classifyWallGameActivity({
        post: { id: 'p2', author: 'alice' } as any, self: 'me', rows: [], seen: new Set(), prefs, followed: true, openGame, names,
      }),
    ).toBeNull();
  });
});
