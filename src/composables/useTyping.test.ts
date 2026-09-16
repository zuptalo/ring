import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computed } from 'vue';
import {
  applyActivity,
  clearTyping,
  activityFor,
  activityKindFor,
  activityKindLabel,
  coalescedActivityLabel,
  hasActivity,
  setActivityIndicatorsEnabled,
} from './useTyping';

// useTyping is pure in-memory ephemeral state with self-expiring timers, so we
// drive it under fake timers (which also fake Date.now used for expiry).
describe('useTyping (spec 1009 activity indicators)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivityIndicatorsEnabled(true);
    clearTyping();
  });
  afterEach(() => {
    clearTyping();
    vi.useRealTimers();
  });

  it('records an active signal and exposes its kind', () => {
    applyActivity({ conversationId: 'c1', senderId: 'alice', kind: 'typing', state: 'active' });
    const list = activityFor('c1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ senderId: 'alice', kind: 'typing' });
    expect(activityKindFor('c1').value).toBe('typing');
  });

  it('distinguishes recording-audio and recording-video kinds', () => {
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'recording-audio', state: 'active' });
    expect(activityKindFor('c1').value).toBe('recording-audio');
    // Switching kind replaces (same sender), never stacks.
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'recording-video', state: 'active' });
    expect(activityFor('c1')).toHaveLength(1);
    expect(activityKindFor('c1').value).toBe('recording-video');
  });

  it('clears immediately on a stopped signal', () => {
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'typing', state: 'active' });
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'typing', state: 'stopped' });
    expect(activityFor('c1')).toHaveLength(0);
  });

  it('auto-expires ~6s after the last signal (no stuck indicator)', () => {
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'typing', state: 'active' });
    vi.advanceTimersByTime(5000);
    expect(activityFor('c1')).toHaveLength(1); // still alive before expiry
    vi.advanceTimersByTime(2000); // total 7s > 6s expiry
    expect(activityFor('c1')).toHaveLength(0);
  });

  it('keepalive refreshes the expiry window', () => {
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'typing', state: 'active' });
    vi.advanceTimersByTime(4000);
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'typing', state: 'active' }); // keepalive
    vi.advanceTimersByTime(4000); // 8s since first, but only 4s since keepalive
    expect(activityFor('c1')).toHaveLength(1);
  });

  it('coalesces multiple devices of one sender into a single entry (FR-011)', () => {
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'typing', state: 'active' });
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'typing', state: 'active' }); // 2nd device
    expect(activityFor('c1')).toHaveLength(1);
  });

  it('does nothing while indicators are disabled (reciprocity)', () => {
    setActivityIndicatorsEnabled(false);
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'typing', state: 'active' });
    expect(activityFor('c1')).toHaveLength(0);
  });

  it('clears already-shown activity when indicators are turned off', () => {
    applyActivity({ conversationId: 'c1', senderId: 'a', kind: 'typing', state: 'active' });
    expect(activityFor('c1')).toHaveLength(1);
    setActivityIndicatorsEnabled(false);
    expect(activityFor('c1')).toHaveLength(0);
  });

  it('coalesces group activity: up to two names, then "several people"', () => {
    const name = (id: string) => ({ a: 'Alice', b: 'Bob', c: 'Cara' })[id] ?? id;
    applyActivity({ conversationId: 'g', senderId: 'a', kind: 'typing', state: 'active' });
    expect(coalescedActivityLabel('g', name)).toBe('Alice is typing…');
    applyActivity({ conversationId: 'g', senderId: 'b', kind: 'typing', state: 'active' });
    expect(coalescedActivityLabel('g', name)).toBe('Alice, Bob are typing…');
    applyActivity({ conversationId: 'g', senderId: 'c', kind: 'typing', state: 'active' });
    expect(coalescedActivityLabel('g', name)).toBe('several people are typing…');
  });

  // spec 1066 FR-007: activityFor must depend on ONE conversation's key, not on the
  // whole store. Before this, it iterated a flat reactive Map, so iterating registered
  // a dependency on the entire collection and any signal anywhere re-ran every reader
  // — including memberOnline() once per rendered message row, on a 3 s keepalive.
  it('a signal in one conversation does not invalidate readers of another (FR-007)', () => {
    let reads = 0;
    const otherChat = computed(() => {
      reads++;
      return activityFor('c2').length;
    });
    expect(otherChat.value).toBe(0); // prime the computed
    const baseline = reads;

    applyActivity({ conversationId: 'c1', senderId: 'alice', kind: 'typing', state: 'active' });
    expect(otherChat.value).toBe(0);
    expect(reads).toBe(baseline); // c1's signal must not have dirtied c2's reader

    // ...but its OWN conversation's signal still invalidates it.
    applyActivity({ conversationId: 'c2', senderId: 'bob', kind: 'typing', state: 'active' });
    expect(otherChat.value).toBe(1);
    expect(reads).toBeGreaterThan(baseline);
  });

  it('returns a stable empty result when nobody is composing', () => {
    expect(activityFor('quiet')).toHaveLength(0);
    expect(activityFor('quiet')).toBe(activityFor('other-quiet')); // no per-call allocation
  });

  it('hasActivity matches sender and kind, and expires with the entry', () => {
    applyActivity({ conversationId: 'c1', senderId: 'alice', kind: 'recording-audio', state: 'active' });
    expect(hasActivity('c1', 'alice', 'recording-audio')).toBe(true);
    expect(hasActivity('c1', 'alice', 'typing')).toBe(false);
    expect(hasActivity('c1', 'bob', 'recording-audio')).toBe(false);
    expect(hasActivity('c2', 'alice', 'recording-audio')).toBe(false);
    vi.advanceTimersByTime(7000);
    expect(hasActivity('c1', 'alice', 'recording-audio')).toBe(false);
  });

  // An emptied conversation must not leave a husk behind, or activityFor's fast path
  // degrades to walking an empty inner map for every reader, forever.
  it('drops a conversation once its last sender stops', () => {
    applyActivity({ conversationId: 'c1', senderId: 'alice', kind: 'typing', state: 'active' });
    applyActivity({ conversationId: 'c1', senderId: 'bob', kind: 'typing', state: 'active' });
    expect(activityFor('c1')).toHaveLength(2);
    applyActivity({ conversationId: 'c1', senderId: 'alice', kind: 'typing', state: 'stopped' });
    expect(activityFor('c1')).toHaveLength(1);
    applyActivity({ conversationId: 'c1', senderId: 'bob', kind: 'typing', state: 'stopped' });
    expect(activityFor('c1')).toBe(activityFor('never-used')); // back to the shared empty
  });

  it('labels each activity kind', () => {
    expect(activityKindLabel('typing')).toBe('typing…');
    expect(activityKindLabel('recording-audio')).toBe('recording audio…');
    expect(activityKindLabel('recording-video')).toBe('recording video…');
  });
});
