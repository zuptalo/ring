// Spec 1038 T022 — the active-game suppression primitive (FR-007), the exact
// mirror of the active-chat rule: while a game's overlay is open, THAT game's
// notes are suppressed; other games and chats are not. The queries-level
// branches consuming this are exercised end-to-end in e2e/games-armada.spec.ts
// (own-game move shows no banner; another chat's message does).
import { afterEach, describe, expect, it } from 'vitest';
import { isGameActive, setActiveGame } from './game-active';

afterEach(() => setActiveGame(null));

describe('setActiveGame / isGameActive', () => {
  it('only the exact session key reads active', () => {
    setActiveGame('msg-1');
    expect(isGameActive('msg-1')).toBe(true);
    expect(isGameActive('msg-2')).toBe(false);
    expect(isGameActive('post-1')).toBe(false);
  });

  it('clearing (minimize/close) deactivates', () => {
    setActiveGame('msg-1');
    setActiveGame(null);
    expect(isGameActive('msg-1')).toBe(false);
  });

  it('nothing is active by default', () => {
    expect(isGameActive('msg-1')).toBe(false);
  });

  it('requires the app to be visible (a hidden tab is not "watching")', () => {
    setActiveGame('msg-1');
    const g = globalThis as { document?: { visibilityState: string } };
    g.document = { visibilityState: 'hidden' };
    expect(isGameActive('msg-1')).toBe(false);
    g.document = { visibilityState: 'visible' };
    expect(isGameActive('msg-1')).toBe(true);
    delete g.document;
  });
});
