import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  applyActivity,
  clearTyping,
  activityFor,
  activityKindFor,
  activityKindLabel,
  coalescedActivityLabel,
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

  it('labels each activity kind', () => {
    expect(activityKindLabel('typing')).toBe('typing…');
    expect(activityKindLabel('recording-audio')).toBe('recording audio…');
    expect(activityKindLabel('recording-video')).toBe('recording video…');
  });
});
