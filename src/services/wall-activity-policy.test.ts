import { describe, expect, it } from 'vitest';
import { wallActivityAlert, WALL_ACTIVITY_FRESH_MS, type WallActivityInput } from './wall-activity-policy';

// Baseline: a fresh comment by a friend on MY post, everything enabled — the one
// case that must alert. Each test flips exactly one input off this baseline, so a
// failure names the rule that broke (spec 1031 FR-001..004, FR-007, FR-011).
const NOW = 1_750_000_000_000;
const base: WallActivityInput = {
  isOwnPost: true,
  actor: 'friend-1',
  self: 'me',
  type: 'comment',
  deleted: false,
  at: NOW - 10_000,
  now: NOW,
  activityEnabled: true,
  tempMuted: false,
  alreadyNotified: false,
};

describe('wallActivityAlert', () => {
  it('alerts for a fresh comment on my own post', () => {
    expect(wallActivityAlert(base)).toBe('alert');
  });

  it('alerts for a fresh reaction on my own post', () => {
    expect(wallActivityAlert({ ...base, type: 'reaction' })).toBe('alert');
  });

  it("never alerts for engagement on someone else's post (owner-only, FR-003)", () => {
    expect(wallActivityAlert({ ...base, isOwnPost: false })).toBe('skip');
    expect(wallActivityAlert({ ...base, isOwnPost: false, type: 'reaction' })).toBe('skip');
  });

  it("alerts when engagement addresses my comment on someone else's post", () => {
    expect(wallActivityAlert({ ...base, isOwnPost: false, answersMe: true })).toBe('alert');
    expect(wallActivityAlert({ ...base, isOwnPost: false, answersMe: true, type: 'reaction' })).toBe('alert');
  });

  it('never alerts for my own actions on my own post (FR-004)', () => {
    expect(wallActivityAlert({ ...base, actor: 'me' })).toBe('skip');
    expect(wallActivityAlert({ ...base, actor: 'me', type: 'reaction' })).toBe('skip');
  });

  it('never alerts for view receipts (FR-011)', () => {
    expect(wallActivityAlert({ ...base, type: 'view' })).toBe('skip');
  });

  it('never alerts for a reaction removal (FR-002)', () => {
    expect(wallActivityAlert({ ...base, type: 'reaction', deleted: true })).toBe('skip');
  });

  it('never alerts for a deleted/tombstoned comment (FR-011)', () => {
    expect(wallActivityAlert({ ...base, deleted: true })).toBe('skip');
  });

  it('skips stale engagement (reconnect backlog must not flood)', () => {
    expect(wallActivityAlert({ ...base, at: NOW - WALL_ACTIVITY_FRESH_MS - 1 })).toBe('skip');
  });

  it('still alerts exactly at the freshness boundary', () => {
    expect(wallActivityAlert({ ...base, at: NOW - WALL_ACTIVITY_FRESH_MS })).toBe('alert');
  });

  it('respects the "Activity on your posts" setting (FR-007)', () => {
    expect(wallActivityAlert({ ...base, activityEnabled: false })).toBe('skip');
  });

  it('respects the temporary Wall mute (FR-007)', () => {
    expect(wallActivityAlert({ ...base, tempMuted: true })).toBe('skip');
  });

  it('dedupes: an already-notified item never re-alerts', () => {
    expect(wallActivityAlert({ ...base, alreadyNotified: true })).toBe('skip');
  });

  it('an emoji change yields at most one alert: the removal row skips, the add row alerts', () => {
    // Changing 👍 → ❤️ lands as two engagement rows: the old emoji flagged deleted
    // and the new one fresh. Only the add may alert (FR-002 "at most one").
    const removal = wallActivityAlert({ ...base, type: 'reaction', deleted: true });
    const add = wallActivityAlert({ ...base, type: 'reaction' });
    expect([removal, add]).toEqual(['skip', 'alert']);
  });

  // Per clarification (spec 1031): per-person Wall mute/hide governs NEW-POST alerts
  // only and is deliberately NOT an input here — engagement with YOUR OWN post always
  // alerts regardless of those ledgers, so the predicate cannot even consult them.
  it('has no per-user mute input: a muted friend engaging with my post still alerts', () => {
    expect(wallActivityAlert({ ...base, actor: 'muted-friend' })).toBe('alert');
  });
});
