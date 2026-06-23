import { describe, it, expect } from 'vitest';
import { nextTier, initialController, clampForPin, type StatsSnapshot, type ControllerState, type Tier } from './quality';

// A healthy sample with plenty of headroom (enough for HD).
const healthy: StatsSnapshot = { qualityLimited: false, availableOutgoingBitrate: 5_000_000, fractionLost: 0 };
// A healthy sample on a browser that doesn't report bitrate/limitation (Safari-style).
const healthyNoBw: StatsSnapshot = { qualityLimited: false, fractionLost: 0 };

function run(start: ControllerState, snap: StatsSnapshot, clamp: Tier = 'hd', n = 1): ControllerState {
  let s = start;
  for (let i = 0; i < n; i++) s = nextTier(s, snap, clamp);
  return s;
}

describe('nextTier (adaptive quality controller)', () => {
  it('starts at low (never the maximum)', () => {
    expect(initialController().tier).toBe('low');
  });

  it('climbs one step only after K consecutive healthy samples', () => {
    let s = initialController(); // low
    s = nextTier(s, healthy, 'hd');
    expect(s.tier).toBe('low'); // 1 healthy sample — not yet
    s = nextTier(s, healthy, 'hd');
    expect(s.tier).toBe('low'); // 2 — still
    s = nextTier(s, healthy, 'hd');
    expect(s.tier).toBe('medium'); // 3 → climb one step
  });

  it('only reaches HD with demonstrated bandwidth headroom; never blind-climbs to HD on Safari', () => {
    // Plenty of bandwidth → eventually reaches hd.
    let s: ControllerState = { tier: 'high', healthyStreak: 0 };
    s = run(s, healthy, 'hd', 3);
    expect(s.tier).toBe('hd');
    // No bitrate info (Safari): climb tops out at 'high', never 'hd'.
    let safari: ControllerState = { tier: 'high', healthyStreak: 0 };
    safari = run(safari, healthyNoBw, 'hd', 9);
    expect(safari.tier).toBe('high');
  });

  it('does not climb to a tier the available bitrate cannot sustain', () => {
    // Healthy but only ~600kbps available: can sit at medium, must not climb to high (1.2M).
    const tight: StatsSnapshot = { qualityLimited: false, availableOutgoingBitrate: 600_000, fractionLost: 0 };
    let s: ControllerState = { tier: 'medium', healthyStreak: 0 };
    s = run(s, tight, 'hd', 5);
    expect(s.tier).toBe('medium');
  });

  it('backs off immediately when the browser reports a bandwidth limitation', () => {
    const limited: StatsSnapshot = { qualityLimited: true, availableOutgoingBitrate: 5_000_000, fractionLost: 0 };
    const s = nextTier({ tier: 'high', healthyStreak: 2 }, limited, 'hd');
    expect(s.tier).toBe('medium');
    expect(s.healthyStreak).toBe(0);
  });

  it('backs off on sustained receiver-reported packet loss (the remote downlink signal)', () => {
    const lossy: StatsSnapshot = { qualityLimited: false, availableOutgoingBitrate: 5_000_000, fractionLost: 0.1 };
    const s = nextTier({ tier: 'high', healthyStreak: 0 }, lossy, 'hd');
    expect(s.tier).toBe('medium');
  });

  it('backs off when available send bitrate drops below the current tier target', () => {
    const starved: StatsSnapshot = { qualityLimited: false, availableOutgoingBitrate: 100_000, fractionLost: 0 };
    const s = nextTier({ tier: 'medium', healthyStreak: 0 }, starved, 'hd');
    expect(s.tier).toBe('low');
  });

  it('reaches the floor (off → suspend video) under severe sustained congestion', () => {
    const dead: StatsSnapshot = { qualityLimited: true, fractionLost: 0.5 };
    let s: ControllerState = { tier: 'low', healthyStreak: 0 };
    s = nextTier(s, dead, 'hd');
    expect(s.tier).toBe('off');
  });

  it('treats the clamp as an upper bound for climbing', () => {
    let s = initialController(); // low
    s = run(s, healthy, 'medium', 9); // many healthy samples, clamp at medium
    expect(s.tier).toBe('medium'); // never climbs past the clamp
  });

  it('lets congestion drop BELOW the clamp to keep the call alive', () => {
    const lossy: StatsSnapshot = { qualityLimited: true, fractionLost: 0.2 };
    // Clamp pinned high, but a dying link still drops us down toward off.
    let s: ControllerState = { tier: 'medium', healthyStreak: 0 };
    s = nextTier(s, lossy, 'high');
    expect(s.tier).toBe('low'); // below where a 'high' clamp would hold it
  });

  it('comes down to a lowered clamp on the next healthy sample (pin changed mid-call)', () => {
    const s = nextTier({ tier: 'hd', healthyStreak: 0 }, healthy, 'medium');
    expect(s.tier).toBe('medium');
  });
});

describe('clampForPin', () => {
  it('maps the manual pin + data-saver to an upper-bound tier', () => {
    expect(clampForPin('auto', false)).toBe('hd');
    expect(clampForPin('auto', true)).toBe('medium'); // data-saver caps at medium
    expect(clampForPin('medium', false)).toBe('medium');
    expect(clampForPin('low', false)).toBe('low');
    expect(clampForPin('low', true)).toBe('low');
  });
});
