// Spec 2045 — the pure dark/light resolver shared between useTheme (runtime, class toggle)
// and the index.html pre-paint inline script (first frame on a cold relaunch). Pinning it
// here guards against the two drifting: whatever this asserts is what index.html must do.
import { describe, it, expect } from 'vitest';
import { resolveDark, DEFAULT_PREF, THEME_MIRROR_KEY, THEME_RESOLVED_KEY } from './useTheme';

describe('spec 2045: resolveDark', () => {
  it('explicit dark is always dark, regardless of OS', () => {
    expect(resolveDark('dark', false)).toBe(true);
    expect(resolveDark('dark', true)).toBe(true);
  });
  it('explicit light is always light, regardless of OS', () => {
    expect(resolveDark('light', true)).toBe(false);
    expect(resolveDark('light', false)).toBe(false);
  });
  it('system follows the OS color scheme', () => {
    expect(resolveDark('system', true)).toBe(true);
    expect(resolveDark('system', false)).toBe(false);
  });
});

describe('spec 2049: dark is the default theme', () => {
  // When the user has never chosen a theme, Ring defaults to dark — the schema
  // default for `appearance.theme`, useTheme's DEFAULT_PREF, and the index.html
  // pre-paint fallback (`|| 'dark'`) must all agree, or a fresh install flashes.
  it('DEFAULT_PREF is dark', () => {
    expect(DEFAULT_PREF).toBe('dark');
  });
  it('the default resolves to dark even on a light-OS device (no white first frame)', () => {
    expect(resolveDark(DEFAULT_PREF, false)).toBe(true);
    expect(resolveDark(DEFAULT_PREF, true)).toBe(true);
  });
});

describe('spec 2045: the mirror key matches the settings key the pre-paint script reads', () => {
  it('is exactly appearance.theme', () => {
    expect(THEME_MIRROR_KEY).toBe('appearance.theme');
  });
});

describe('follow-system flash fix: the resolved-dark mirror the pre-paint trusts first', () => {
  // index.html reads localStorage['appearance.theme.dark'] ('1'/'0') BEFORE consulting
  // matchMedia, so a system-mode cold relaunch never flashes the light palette while iOS's
  // cold-start prefers-color-scheme is still settling. If this key drifts, the pre-paint
  // silently falls back to the flaky matchMedia path — keep them identical.
  it('is exactly appearance.theme.dark', () => {
    expect(THEME_RESOLVED_KEY).toBe('appearance.theme.dark');
  });
});
