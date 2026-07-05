// Spec 0008 T049 (FR-028) — how an emoji profile picture animates, as a pure
// decision so every avatar surface behaves identically: the master emoji
// toggle wins, unread attention keeps it looping (when allowed), otherwise
// the configured loop count applies ('forever' = never stop).
import { describe, it, expect } from 'vitest';
import { resolveAvatarAnimation } from './useAnimationPrefs';

describe('resolveAvatarAnimation (spec 0008 FR-028)', () => {
  it('defaults: two loops, then rest', () => {
    expect(resolveAvatarAnimation(true, 'twice', true, false)).toEqual({ animate: true, plays: 2 });
  });

  it('honors the configured loop count', () => {
    expect(resolveAvatarAnimation(true, 'once', true, false)).toEqual({ animate: true, plays: 1 });
    expect(resolveAvatarAnimation(true, 'thrice', true, false)).toEqual({ animate: true, plays: 3 });
    expect(resolveAvatarAnimation(true, 'forever', true, false)).toEqual({ animate: true });
  });

  it('unread attention keeps it looping while the toggle allows it', () => {
    expect(resolveAvatarAnimation(true, 'twice', true, true)).toEqual({ animate: true });
    // toggle off → attention changes nothing, the loop count still applies
    expect(resolveAvatarAnimation(true, 'twice', false, true)).toEqual({ animate: true, plays: 2 });
  });

  it('the master emoji-animation switch wins over everything', () => {
    expect(resolveAvatarAnimation(false, 'forever', true, true)).toEqual({ animate: false });
  });

  it('an unknown stored value falls back to the default (twice)', () => {
    expect(resolveAvatarAnimation(true, 'sometimes', true, false)).toEqual({ animate: true, plays: 2 });
  });
});
