import { describe, it, expect } from 'vitest';
import {
  callSize, allowedKinds, upsertEntry, removeEntry, entryVerdict, parseQuickCalls,
  QUICK_CALLS_MAX, type QuickCallEntry,
} from './quick-calls';
import { VIDEO_MAX, AUDIO_MAX } from '@/services/call/types';

const contactEntry: QuickCallEntry = { t: 'contact', id: 'anna', kind: 'video' };
const groupEntry: QuickCallEntry = { t: 'group', id: 'fam', kind: 'audio' };

const contact = (over: Record<string, unknown> = {}) => ({ id: 'anna', ghosted: false, blocked: false, ...over });
const group = (members: number, over: Record<string, unknown> = {}) => ({
  id: 'fam',
  isGroup: true,
  participantIds: Array.from({ length: members }, (_, i) => `m${i}`),
  ...over,
});

describe('callSize (spec 1046 — the call includes me)', () => {
  it('a contact call is 2 people; a group call is members + me', () => {
    expect(callSize(contactEntry, contact())).toBe(2);
    expect(callSize(groupEntry, group(3))).toBe(4);
    expect(callSize(groupEntry, group(8))).toBe(9);
  });
});

describe('allowedKinds (FR-004 — the 4-video/8-audio caps)', () => {
  it('both kinds within the video cap', () => {
    expect(allowedKinds(2)).toEqual(['audio', 'video']);
    expect(allowedKinds(VIDEO_MAX)).toEqual(['audio', 'video']);
  });
  it('audio only between the caps', () => {
    expect(allowedKinds(VIDEO_MAX + 1)).toEqual(['audio']);
    expect(allowedKinds(AUDIO_MAX)).toEqual(['audio']);
  });
  it('nothing past the audio cap', () => {
    expect(allowedKinds(AUDIO_MAX + 1)).toEqual([]);
  });
});

describe('upsertEntry (FR-007 — one entry per target)', () => {
  it('appends a new target in insertion order', () => {
    const list = upsertEntry([contactEntry], groupEntry);
    expect(list.map((e) => e.id)).toEqual(['anna', 'fam']);
  });
  it('re-adding the same target updates the method in place', () => {
    const list = upsertEntry([contactEntry, groupEntry], { t: 'contact', id: 'anna', kind: 'audio' });
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ t: 'contact', id: 'anna', kind: 'audio' });
  });
  it('a contact and a group may share an id without colliding', () => {
    const list = upsertEntry([{ t: 'contact', id: 'x', kind: 'audio' }], { t: 'group', id: 'x', kind: 'audio' });
    expect(list).toHaveLength(2);
  });
  it('refuses to grow past the soft cap (but still updates existing)', () => {
    const full = Array.from({ length: QUICK_CALLS_MAX }, (_, i) => ({ t: 'contact' as const, id: `c${i}`, kind: 'audio' as const }));
    expect(upsertEntry(full, { t: 'contact', id: 'new', kind: 'audio' })).toHaveLength(QUICK_CALLS_MAX);
    const updated = upsertEntry(full, { t: 'contact', id: 'c0', kind: 'video' });
    expect(updated[0].kind).toBe('video');
  });
});

describe('removeEntry', () => {
  it('removes by target and leaves the rest', () => {
    const list = removeEntry([contactEntry, groupEntry], groupEntry);
    expect(list).toEqual([contactEntry]);
  });
});

describe('entryVerdict (FR-004/FR-005 — re-checked at render and at tap)', () => {
  it('ok for a healthy contact and a fitting group', () => {
    expect(entryVerdict(contactEntry, contact()).ok).toBe(true);
    expect(entryVerdict({ ...groupEntry, kind: 'video' }, group(VIDEO_MAX - 1)).ok).toBe(true);
  });
  it('missing target', () => {
    const v = entryVerdict(contactEntry, undefined);
    expect(v).toMatchObject({ ok: false, code: 'missing' });
  });
  it('ghosted / blocked contact', () => {
    expect(entryVerdict(contactEntry, contact({ ghosted: true }))).toMatchObject({ ok: false, code: 'ghosted' });
    expect(entryVerdict(contactEntry, contact({ blocked: true }))).toMatchObject({ ok: false, code: 'blocked' });
  });
  it('a group grown past the entry kind cap', () => {
    const v = entryVerdict({ ...groupEntry, kind: 'video' }, group(VIDEO_MAX)); // 4 members + me = 5
    expect(v).toMatchObject({ ok: false, code: 'over-cap' });
    if (!v.ok) expect(v.reason).toMatch(/Video calls are limited to 4/);
  });
  it('a group grown past even the audio cap', () => {
    const v = entryVerdict(groupEntry, group(AUDIO_MAX)); // 8 + me = 9
    expect(v).toMatchObject({ ok: false, code: 'over-cap' });
    if (!v.ok) expect(v.reason).toMatch(/Audio calls are limited to 8/);
  });
});

describe('parseQuickCalls (synced value may be from a newer/older build)', () => {
  it('accepts a valid list and drops garbage rows', () => {
    const raw = [
      contactEntry,
      { t: 'group', id: 'g1', kind: 'audio' },
      { t: 'nope', id: 'x', kind: 'audio' },
      { t: 'contact', id: 42, kind: 'audio' },
      { t: 'contact', id: 'y', kind: 'hologram' },
      'junk',
    ];
    expect(parseQuickCalls(raw)).toEqual([contactEntry, { t: 'group', id: 'g1', kind: 'audio' }]);
  });
  it('non-arrays parse to empty', () => {
    expect(parseQuickCalls(undefined)).toEqual([]);
    expect(parseQuickCalls({ not: 'a list' })).toEqual([]);
    expect(parseQuickCalls('[]')).toEqual([]);
  });
  it('dedupes by target keeping the first occurrence', () => {
    expect(parseQuickCalls([contactEntry, { t: 'contact', id: 'anna', kind: 'audio' }])).toEqual([contactEntry]);
  });
});
