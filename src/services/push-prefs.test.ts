// Spec 1050: deriving the device's push routing prefs from the EXISTING
// controls — pure snapshots in, server blob out. The hidden-chat exclusion here
// is SC-011: hidden conversations must be structurally absent from anything
// that leaves the device.
import { describe, it, expect } from 'vitest';
import { derivePushPrefs, type PrefsInput } from './push-prefs';

const NOW = 1_000_000;

function input(over: Partial<PrefsInput> = {}): PrefsInput {
  return {
    settings: {},
    chats: [],
    hiddenIds: new Set<string>(),
    wall: { muted: [], always: [] },
    now: NOW,
    ...over,
  };
}

describe('spec 1050 — class opt-outs from existing toggles', () => {
  it('defaults (everything on) → no opt-outs, push everything', () => {
    expect(derivePushPrefs(input())).toEqual({
      classesOff: [],
      mutedPrids: [],
      postSenders: { muted: [], always: [] },
    });
  });

  it('reaction class opts out only when BOTH reaction toggles are off', () => {
    const both = input({ settings: { 'notifications.message.reactions': false, 'notifications.group.reactions': false } });
    expect(derivePushPrefs(both).classesOff).toContain('reaction');
    const mixed = input({ settings: { 'notifications.message.reactions': false } });
    expect(derivePushPrefs(mixed).classesOff).not.toContain('reaction');
  });

  it('game class opts out only when ALL four game alert toggles are off', () => {
    const all = input({
      settings: {
        'notifications.games.turn': false,
        'notifications.games.challenges': false,
        'notifications.games.followMoves': false,
        'notifications.games.followResults': false,
      },
    });
    expect(derivePushPrefs(all).classesOff).toContain('game');
    const partial = input({ settings: { 'notifications.games.turn': false } });
    expect(derivePushPrefs(partial).classesOff).not.toContain('game');
  });

  it('wall toggles map to post/activity; the global master maps to message+mention', () => {
    const p = derivePushPrefs(
      input({ settings: { 'notifications.wall.show': false, 'notifications.wall.activity': false, 'notifications.message.show': false } }),
    );
    expect(p.classesOff).toEqual(expect.arrayContaining(['post', 'activity', 'message', 'mention']));
  });
});

describe('spec 1050 — muted conversations (prids)', () => {
  const chats = [
    { id: 'c1', prid: 'p1', mutedUntil: NOW + 60_000 },
    { id: 'c2', prid: 'p2', notifyWebPush: false },
    { id: 'c3', prid: 'p3' }, // not muted
    { id: 'c4', prid: 'p4', mutedUntil: NOW - 1 }, // mute expired
    { id: 'c5', mutedUntil: NOW + 60_000 }, // muted but no prid yet
  ];

  it('collects prids for active mutes and per-chat web-push-off; expiry drops out', () => {
    expect(derivePushPrefs(input({ chats })).mutedPrids.sort()).toEqual(['p1', 'p2']);
  });

  it('SC-011: a hidden chat NEVER contributes its prid, muted or not', () => {
    const p = derivePushPrefs(input({ chats, hiddenIds: new Set(['c1', 'c2']) }));
    expect(p.mutedPrids).toEqual([]);
  });
});

describe('spec 1050 — per-sender post overrides', () => {
  it('wall per-person mutes and the per-friend always-alert flags pass through', () => {
    const p = derivePushPrefs(input({ wall: { muted: ['u1'], always: ['u2'] } }));
    expect(p.postSenders).toEqual({ muted: ['u1'], always: ['u2'] });
  });
});
