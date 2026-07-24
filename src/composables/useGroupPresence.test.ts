// spec 1062 — the pure group-online derivation (zero-knowledge honest count).
import { describe, it, expect } from 'vitest';
import { groupOnline } from './group-online';

const onlineOf = (ids: string[]) => (id: string) => ids.includes(id);

describe('spec 1062: groupOnline', () => {
  it('counts only members who are contacts AND online', () => {
    const r = groupOnline(['a', 'b', 'c'], new Set(['a', 'b', 'c']), onlineOf(['a', 'b']));
    expect(r.count).toBe(2);
    expect(r.onlineIds).toEqual(['a', 'b']);
  });

  it('all-contact group is labelled "N online"', () => {
    const r = groupOnline(['a', 'b'], new Set(['a', 'b']), onlineOf(['a']));
    expect(r.allContacts).toBe(true);
    expect(r.label).toBe('1 online');
  });

  it('mixed group (a non-contact member) is labelled "N online contacts"', () => {
    const r = groupOnline(['a', 'stranger'], new Set(['a']), onlineOf(['a']));
    expect(r.allContacts).toBe(false);
    expect(r.label).toBe('1 online contacts');
  });

  it('a non-contact member is NEVER counted, even if reported online (zero-knowledge)', () => {
    const r = groupOnline(['a', 'stranger'], new Set(['a']), onlineOf(['a', 'stranger']));
    expect(r.count).toBe(1);
    expect(r.onlineIds).toEqual(['a']);
  });

  it('zero visible-online → empty label (render nothing)', () => {
    const r = groupOnline(['a', 'b'], new Set(['a', 'b']), onlineOf([]));
    expect(r.count).toBe(0);
    expect(r.label).toBe('');
  });

  it('empty roster → empty, all-contacts vacuously true', () => {
    const r = groupOnline([], new Set<string>(), onlineOf([]));
    expect(r).toEqual({ count: 0, onlineIds: [], allContacts: true, label: '' });
  });
});
