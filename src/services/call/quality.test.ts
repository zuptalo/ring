import { describe, it, expect } from 'vitest';
import {
  nextTier,
  initialController,
  clampForPin,
  clampForPeers,
  tierMin,
  tierEncoding,
  type StatsSnapshot,
  type ControllerState,
  type Tier,
} from './quality';

// A healthy sample with plenty of headroom.
const healthy: StatsSnapshot = { qualityLimited: false, availableOutgoingBitrate: 5_000_000, fractionLost: 0 };
// Healthy on a browser that doesn't report bitrate/limitation (Safari-style).
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
    expect(s.tier).toBe('low'); // 1 healthy — not yet
    s = nextTier(s, healthy, 'hd');
    expect(s.tier).toBe('low'); // 2 — still
    s = nextTier(s, healthy, 'hd');
    expect(s.tier).toBe('medium'); // 3 → climb one step
  });

  it('climbs toward the ceiling on sustained health (no per-leg bandwidth gate)', () => {
    // A healthy link with headroom reaches HD, without needing the noisy per-leg estimate to
    // clear each tier's target (the old gate stranded mesh video at the bottom).
    let s: ControllerState = { tier: 'low', healthyStreak: 0 };
    s = run(s, healthy, 'hd', 9);
    expect(s.tier).toBe('hd');
  });

  it('never blind-climbs past high without a known bandwidth estimate (Safari)', () => {
    let s: ControllerState = { tier: 'high', healthyStreak: 0 };
    s = run(s, healthyNoBw, 'hd', 9);
    expect(s.tier).toBe('high');
  });

  it('backs off immediately when the browser reports a BANDWIDTH limitation', () => {
    const limited: StatsSnapshot = { qualityLimited: true, availableOutgoingBitrate: 5_000_000, fractionLost: 0 };
    const s = nextTier({ tier: 'high', healthyStreak: 2 }, limited, 'hd');
    expect(s.tier).toBe('medium');
    expect(s.healthyStreak).toBe(0);
  });

  it('backs off on a CPU limitation too (mesh: N parallel encoders saturate weak devices)', () => {
    // snapshotFromReport collapses bandwidth|cpu into qualityLimited; here we assert the
    // controller reacts to that flag (the cpu case used to be ignored).
    const cpuLimited: StatsSnapshot = { qualityLimited: true, availableOutgoingBitrate: 5_000_000, fractionLost: 0 };
    const s = nextTier({ tier: 'high', healthyStreak: 0 }, cpuLimited, 'hd');
    expect(s.tier).toBe('medium');
  });

  it('backs off on sustained receiver-reported packet loss (the remote downlink signal)', () => {
    const lossy: StatsSnapshot = { qualityLimited: false, availableOutgoingBitrate: 5_000_000, fractionLost: 0.1 };
    const s = nextTier({ tier: 'high', healthyStreak: 0 }, lossy, 'hd');
    expect(s.tier).toBe('medium');
  });

  it('backs off when available send bitrate collapses well below the current tier', () => {
    const starved: StatsSnapshot = { qualityLimited: false, availableOutgoingBitrate: 100_000, fractionLost: 0 };
    const s = nextTier({ tier: 'medium', healthyStreak: 0 }, starved, 'hd');
    expect(s.tier).toBe('low');
  });

  it('reaches the floor (off → suspend video) under severe sustained congestion', () => {
    const dead: StatsSnapshot = { qualityLimited: true, fractionLost: 0.5 };
    const s = nextTier({ tier: 'low', healthyStreak: 0 }, dead, 'hd');
    expect(s.tier).toBe('off');
  });

  it('treats the clamp as an upper bound for climbing', () => {
    let s = initialController(); // low
    s = run(s, healthy, 'medium', 9); // many healthy samples, clamp at medium
    expect(s.tier).toBe('medium'); // never climbs past the clamp
  });

  it('lets congestion drop BELOW the clamp to keep the call alive', () => {
    const lossy: StatsSnapshot = { qualityLimited: true, fractionLost: 0.2 };
    const s = nextTier({ tier: 'medium', healthyStreak: 0 }, lossy, 'high');
    expect(s.tier).toBe('low');
  });

  it('comes down to a lowered clamp (pin lowered, or more peers joined)', () => {
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

describe('clampForPeers (mesh per-peer ceiling)', () => {
  it('lowers the ceiling as more peers (parallel encoders) are added', () => {
    expect(clampForPeers(1)).toBe('hd'); // 1:1 / 2-person (a single cheap encode)
    expect(clampForPeers(2)).toBe('high'); // 3-person — full resolution
    expect(clampForPeers(3)).toBe('high'); // 4-person (video cap) — full resolution
    expect(clampForPeers(4)).toBe('medium'); // beyond the video cap
  });
});

describe('tierMin', () => {
  it('returns the more conservative of two tiers', () => {
    expect(tierMin('hd', 'medium')).toBe('medium');
    expect(tierMin('low', 'high')).toBe('low');
    expect(tierMin('high', 'high')).toBe('high');
  });
});

describe('tierEncoding (iOS-safe encoder params)', () => {
  it('passes the full per-tier encoding through on non-WebKit', () => {
    const low = tierEncoding('low', false);
    expect(low.scaleResolutionDownBy).toBe(4);
    expect(low.maxFramerate).toBe(15);
    expect(low.maxBitrate).toBe(150_000);
  });

  it('drops scaleResolutionDownBy/maxFramerate on WebKit/iOS but keeps the bitrate cap', () => {
    // These stall the iPhone 8 H.264 encoder (no frames out) — tier by bitrate only there.
    for (const tier of ['low', 'medium', 'high'] as Tier[]) {
      const enc = tierEncoding(tier, true);
      expect(enc.scaleResolutionDownBy).toBe(1);
      expect(enc.maxFramerate).toBeUndefined();
      expect(enc.maxBitrate).toBe(tierEncoding(tier, false).maxBitrate);
    }
  });
});
