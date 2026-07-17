import { describe, it, expect } from 'vitest';
import {
  nextTier,
  initialController,
  clampForPin,
  clampForPeers,
  tierMin,
  tierEncoding,
  downlinkClassFrom,
  tileTarget,
  requestedTierOf,
  type StatsSnapshot,
  type ControllerState,
  type Tier,
} from './quality';

// A healthy sample with plenty of headroom.
const healthy: StatsSnapshot = { limitedBy: null, availableOutgoingBitrate: 5_000_000, fractionLost: 0 };
// Healthy on a browser that doesn't report bitrate/limitation (Safari-style).
const healthyNoBw: StatsSnapshot = { limitedBy: null, fractionLost: 0 };

function run(start: ControllerState, snap: StatsSnapshot, clamp: Tier = 'hd', n = 1): ControllerState {
  let s = start;
  for (let i = 0; i < n; i++) s = nextTier(s, snap, clamp);
  return s;
}

// Same, but with a peer-requested ceiling (spec 0007 US2).
function run4(start: ControllerState, snap: StatsSnapshot, clamp: Tier, requested: Tier, n = 1): ControllerState {
  let s = start;
  for (let i = 0; i < n; i++) s = nextTier(s, snap, clamp, requested);
  return s;
}

describe('nextTier (adaptive quality controller) — spec 0007', () => {
  it('starts at a sensible mid tier (fast to a good picture, not stuck at the bottom)', () => {
    expect(initialController().tier).toBe('medium');
  });

  it('converges to a good tier quickly on a healthy link (≈5s = a couple of 2s samples)', () => {
    // medium → high after CLIMB_AFTER healthy samples; "high" is the clearly-good target reached
    // within ~5s. (Regression: it used to start at low and crawl one step every 3 samples.)
    let s = initialController(); // medium
    s = run(s, healthy, 'hd', 2);
    expect(s.tier).toBe('high');
  });

  it('reaches HD on a healthy 1:1 EVEN without a candidate-pair bandwidth estimate (Safari)', () => {
    // Regression fix: the old controller hard-capped the climb at "high" whenever
    // availableOutgoingBitrate was absent (common on WebKit), so 1:1 never reached HD.
    let s = initialController();
    s = run(s, healthyNoBw, 'hd', 6);
    expect(s.tier).toBe('hd');
  });

  it('does NOT back off on a single mild-congestion sample (no flap)', () => {
    // Regression fix: one noisy bad sample used to drop a tier. Mild congestion must be SUSTAINED.
    const lossy: StatsSnapshot = { limitedBy: null, availableOutgoingBitrate: 5_000_000, fractionLost: 0.1 };
    const s = nextTier({ tier: 'high', healthyStreak: 0, unhealthyStreak: 0 }, lossy, 'hd');
    expect(s.tier).toBe('high'); // held after one mild sample
  });

  it('backs off after SUSTAINED mild congestion (two consecutive bad samples)', () => {
    const lossy: StatsSnapshot = { limitedBy: null, availableOutgoingBitrate: 5_000_000, fractionLost: 0.1 };
    let s: ControllerState = { tier: 'high', healthyStreak: 0, unhealthyStreak: 0 };
    s = nextTier(s, lossy, 'hd'); // 1st bad — hold
    s = nextTier(s, lossy, 'hd'); // 2nd bad — back off
    expect(s.tier).toBe('medium');
  });

  it('backs off IMMEDIATELY on a severe loss spike (no waiting for sustained)', () => {
    const severe: StatsSnapshot = { limitedBy: null, availableOutgoingBitrate: 5_000_000, fractionLost: 0.3 };
    const s = nextTier({ tier: 'high', healthyStreak: 0, unhealthyStreak: 0 }, severe, 'hd');
    expect(s.tier).toBe('medium');
  });

  it('backs off after sustained CPU limitation (mesh: N parallel encoders)', () => {
    const limited: StatsSnapshot = { limitedBy: 'cpu', availableOutgoingBitrate: 5_000_000, fractionLost: 0 };
    let s: ControllerState = { tier: 'high', healthyStreak: 0, unhealthyStreak: 0 };
    s = nextTier(s, limited, 'hd');
    s = nextTier(s, limited, 'hd');
    expect(s.tier).toBe('medium');
  });

  it('reaches the floor (off → suspend video) under severe congestion, protecting audio', () => {
    const dead: StatsSnapshot = { limitedBy: 'bandwidth', fractionLost: 0.5 };
    const s = nextTier({ tier: 'low', healthyStreak: 0, unhealthyStreak: 0 }, dead, 'hd');
    expect(s.tier).toBe('off');
  });

  it('treats the clamp as an upper bound for climbing', () => {
    let s = initialController(); // medium
    s = run(s, healthy, 'medium', 9); // many healthy samples, clamp at medium
    expect(s.tier).toBe('medium'); // never climbs past the clamp
  });

  it('lets congestion drop BELOW the clamp to keep the call alive', () => {
    const severe: StatsSnapshot = { limitedBy: 'cpu', fractionLost: 0.3 };
    const s = nextTier({ tier: 'medium', healthyStreak: 0, unhealthyStreak: 0 }, severe, 'high');
    expect(s.tier).toBe('low');
  });

  it('comes down to a lowered clamp (pin lowered, or more peers joined)', () => {
    const s = nextTier({ tier: 'hd', healthyStreak: 0, unhealthyStreak: 0 }, healthy, 'medium');
    expect(s.tier).toBe('medium');
  });
});

describe('nextTier with a peer-requested ceiling (spec 0007 US2)', () => {
  it('caps the climb at the receiver-requested tier (effective = min(clamp, requested))', () => {
    // Healthy link, auto clamp (hd), but the receiver asked for medium → never climb past medium.
    let s = initialController(); // medium
    s = run4(s, healthy, 'hd', 'medium', 9);
    expect(s.tier).toBe('medium');
  });

  it('comes DOWN to the receiver-requested tier when already above it', () => {
    const s = nextTier({ tier: 'hd', healthyStreak: 0, unhealthyStreak: 0 }, healthy, 'hd', 'high');
    expect(s.tier).toBe('high');
  });

  it('ignores the requested ceiling when omitted (stale/absent report → send-side fallback)', () => {
    // No peerRequestedTier → behaves exactly like the 3-arg call (climbs to the clamp).
    let s = initialController();
    s = run(s, healthyNoBw, 'hd', 6); // 4-arg run defaults requested to undefined
    expect(s.tier).toBe('hd');
  });

  it('still backs off BELOW the requested ceiling to keep the call alive', () => {
    // A requested ceiling is an UPPER bound, not a floor: severe congestion still drops below it.
    const severe: StatsSnapshot = { limitedBy: 'cpu', fractionLost: 0.3 };
    const s2 = nextTier({ tier: 'high', healthyStreak: 0, unhealthyStreak: 0 }, severe, 'hd', 'high');
    expect(s2.tier).toBe('medium');
  });
});

describe('downlinkClassFrom (receiver self-assessed downlink, spec 0007 US2)', () => {
  it('reports a healthy downlink as hd when loss is negligible', () => {
    expect(downlinkClassFrom({ fractionLost: 0 }, 'hd')).toBe('hd');
  });

  it('keys off LOSS, not low received bitrate (a quiet sender is not a bad downlink)', () => {
    // No loss at all → downlink is fine even if the sender happens to send little: it climbs back up
    // toward hd (one hysteresis step per sample) and holds there.
    expect(downlinkClassFrom({ fractionLost: 0.0 }, 'high')).toBe('hd');
    expect(downlinkClassFrom({ fractionLost: 0.0 }, 'hd')).toBe('hd');
  });

  it('steps the class DOWN under sustained loss (one step per sample = hysteresis)', () => {
    const lossy = { fractionLost: 0.3 }; // target low (spec 2025: low needs > 0.25)
    let c: Tier = 'hd';
    c = downlinkClassFrom(lossy, c); // hd → high
    expect(c).toBe('high');
    c = downlinkClassFrom(lossy, c); // high → medium
    expect(c).toBe('medium');
    c = downlinkClassFrom(lossy, c); // medium → low
    expect(c).toBe('low');
  });

  it('trims an extra step when many frames are dropped (render/decode behind)', () => {
    // ~6% loss alone → high; heavy frame drops (50%) pull it one more step to medium.
    expect(downlinkClassFrom({ fractionLost: 0.06, framesReceived: 50, framesDropped: 50 }, 'medium')).toBe('medium');
  });
});

describe('quality regressions (spec 2025): truthful congestion, recoverable floor, de-noised downlink', () => {
  // The encoder saying "bandwidth limited" while LOSS IS ZERO and the send estimate is
  // healthy is the signature of our OWN maxBitrate cap (or a post-reconfigure blip) — the
  // old controller counted it as congestion and rode the ladder down (the reported
  // sharp→blocky pumping). It must hold, and keep climbing.
  it('uncorroborated bandwidth limitation is NOT congestion: holds at hd', () => {
    const capLimited: StatsSnapshot = { limitedBy: 'bandwidth', availableOutgoingBitrate: 5_000_000, fractionLost: 0 };
    let s: ControllerState = { tier: 'hd', healthyStreak: 0, unhealthyStreak: 0 };
    for (let i = 0; i < 10; i++) s = nextTier(s, capLimited, 'hd');
    expect(s.tier).toBe('hd'); // never stepped down by its own cap
  });

  it('uncorroborated bandwidth limitation still CLIMBS toward the clamp', () => {
    const capLimited: StatsSnapshot = { limitedBy: 'bandwidth', availableOutgoingBitrate: 5_000_000, fractionLost: 0 };
    let s = initialController(); // medium
    for (let i = 0; i < 6; i++) s = nextTier(s, capLimited, 'hd');
    expect(s.tier).toBe('hd');
  });

  it('bandwidth limitation CORROBORATED by receiver loss is congestion (sustained back-off kept)', () => {
    const genuine: StatsSnapshot = { limitedBy: 'bandwidth', availableOutgoingBitrate: 5_000_000, fractionLost: 0.03 };
    let s: ControllerState = { tier: 'hd', healthyStreak: 0, unhealthyStreak: 0 };
    s = nextTier(s, genuine, 'hd'); // 1st — hold (no flap)
    expect(s.tier).toBe('hd');
    s = nextTier(s, genuine, 'hd'); // 2nd — back off
    expect(s.tier).toBe('high');
  });

  it('bandwidth limitation corroborated by a collapsed send estimate is congestion', () => {
    // hd wants 4 Mbps; a 1 Mbps estimate is well under the margin → genuine pressure.
    const collapsed: StatsSnapshot = { limitedBy: 'bandwidth', availableOutgoingBitrate: 1_000_000, fractionLost: 0 };
    let s: ControllerState = { tier: 'hd', healthyStreak: 0, unhealthyStreak: 0 };
    s = nextTier(s, collapsed, 'hd');
    s = nextTier(s, collapsed, 'hd');
    expect(s.tier).toBe('high');
  });

  // The floor trap: `off` used to strangle the encoder to 1 bps (still "sending"), which
  // itself kept the bandwidth-limited reading on → congested forever → video never came
  // back. With `off` as a REAL pause the sender emits nothing, samples read healthy, and
  // the ladder must climb back out.
  it('recovers from the floor: healthy samples climb off → low (video comes back)', () => {
    let s: ControllerState = { tier: 'off', healthyStreak: 0, unhealthyStreak: 0 };
    s = nextTier(s, healthyNoBw, 'hd');
    s = nextTier(s, healthyNoBw, 'hd');
    expect(s.tier).toBe('low');
  });

  it('a paused sender that still reads bandwidth-limited with zero loss must ALSO escape the floor', () => {
    // Belt-and-braces for browsers that keep reporting the stale limitation reason on a
    // track-less sender: uncorroborated bandwidth limitation is not congestion, so the
    // climb happens regardless.
    const stale: StatsSnapshot = { limitedBy: 'bandwidth', fractionLost: 0 };
    let s: ControllerState = { tier: 'off', healthyStreak: 0, unhealthyStreak: 0 };
    for (let i = 0; i < 4; i++) s = nextTier(s, stale, 'hd');
    expect(s.tier).not.toBe('off');
  });

  it('the 1:1 entry point starts high (sharp within one climb of the top); default stays medium', () => {
    expect(initialController('high').tier).toBe('high');
    expect(initialController().tier).toBe('medium'); // mesh legs keep the N-encoders start
  });

  it('the top tier is worth a good link: hd carries at least 4 Mbps', () => {
    expect(tierEncoding('hd', false).maxBitrate).toBeGreaterThanOrEqual(4_000_000);
    expect(tierEncoding('hd', true).maxBitrate).toBeGreaterThanOrEqual(4_000_000); // iOS too
  });

  // Downlink classifier de-noising (FR-006): a statistically meaningless window must not
  // move the class, and the dropped-frame trim needs real starvation, not UI jitter.
  it('keeps the previous class when the window has too few packets to mean anything', () => {
    // 1 lost of 3 packets is 33% "loss" — but 3 packets is noise, not evidence.
    expect(downlinkClassFrom({ fractionLost: 0.33, packets: 3 }, 'hd')).toBe('hd');
    // The same ratio over a real window IS evidence and steps down.
    expect(downlinkClassFrom({ fractionLost: 0.33, packets: 200 }, 'hd')).toBe('high');
  });

  it('ignores a moderate dropped-frame ratio (UI jitter) but trims on real starvation', () => {
    // 15% dropped with zero loss: no trim (was trimming at >10%).
    expect(downlinkClassFrom({ fractionLost: 0, framesReceived: 85, framesDropped: 15, packets: 500 }, 'hd')).toBe('hd');
    // 40% dropped: genuine starvation → one-step trim below the loss target.
    expect(downlinkClassFrom({ fractionLost: 0, framesReceived: 60, framesDropped: 40, packets: 500 }, 'hd')).toBe('high');
  });

  it('a small isolated loss blip no longer caps the sender below the top tier', () => {
    // 3% in one window used to map below hd; the relaxed thresholds keep hd (> 0.05 → high).
    expect(downlinkClassFrom({ fractionLost: 0.03, packets: 500 }, 'hd')).toBe('hd');
    expect(downlinkClassFrom({ fractionLost: 0.06, packets: 500 }, 'hd')).toBe('high');
  });
});

describe('tileTarget (screen-size ceiling, spec 0007 US4)', () => {
  it('asks for nothing when not rendered, more as the tile grows', () => {
    expect(tileTarget(0)).toBe('off');
    expect(tileTarget(120)).toBe('low');
    expect(tileTarget(240)).toBe('medium');
    expect(tileTarget(480)).toBe('high');
    expect(tileTarget(900)).toBe('hd');
  });
});

describe('requestedTierOf (the single ceiling a receiver asks for)', () => {
  it('is the most conservative of downlink, manual pin, and tile target', () => {
    expect(requestedTierOf('hd', 'hd', 'hd')).toBe('hd');
    expect(requestedTierOf('hd', 'medium', 'hd')).toBe('medium'); // pin wins
    expect(requestedTierOf('low', 'hd', 'high')).toBe('low'); // downlink wins
    expect(requestedTierOf('hd', 'hd', 'medium')).toBe('medium'); // tile wins
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
