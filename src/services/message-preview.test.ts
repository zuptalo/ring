// Spec 0008 (US3): chats-list preview for game bubbles — the icon category and
// the text line, shared verbatim by the page receive path and the SW apply path.
import { describe, it, expect } from 'vitest';
import { previewKind, chatListPreview } from './message-preview';
import type { MessagePayload } from './crypto/message';

const p = (over: Partial<MessagePayload>): MessagePayload => ({ kind: 'text', body: '', ...over }) as MessagePayload;

describe('game previews (spec 0008 US3)', () => {
  it("previewKind maps kind 'game' to the game icon category", () => {
    expect(previewKind('game')).toBe('game');
  });

  it('chatListPreview names the game, with a generic fallback for unknown games', () => {
    expect(chatListPreview(p({ kind: 'game', game: { gameType: 'tictactoe' } }), 'game')).toBe('Tic-tac-toe');
    expect(chatListPreview(p({ kind: 'game', game: { gameType: 'from-the-future' } }), 'game')).toBe('Game');
  });
});
