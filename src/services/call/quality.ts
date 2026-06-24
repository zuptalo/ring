/**
 * Adaptive outgoing-video quality controller (spec 0004 US4) — a PURE function so it is
 * unit-testable without WebRTC. One controller runs per connection (per mesh leg, and for
 * the 1:1 PC), sampling getStats() every couple of seconds and stepping the outgoing video
 * tier up or down.
 *
 * Shape: AIMD. Start LOW; climb ONE step only after K consecutive healthy samples (and only
 * while a known available send-bitrate supports the next tier); back off immediately on
 * congestion — the browser reporting bandwidth as the limiting factor, sustained packet loss
 * reported by the RECEIVER (so we react to *their* bad downlink too), or available send
 * bitrate dropping below the current tier's target. Audio is never tiered here; at the floor
 * the caller suspends video (tier `off`) so audio survives.
 *
 * The manual quality pin and the "use less data" setting are passed in as `clamp` — an UPPER
 * bound only: the controller may still drop below it to keep the call alive.
 */

export type Tier = 'off' | 'low' | 'medium' | 'high' | 'hd';

// Ordered low→high; `off` (index 0) means "don't send video".
export const TIERS: Tier[] = ['off', 'low', 'medium', 'high', 'hd'];

export interface TierEncoding {
  maxBitrate?: number;
  scaleResolutionDownBy: number;
  maxFramerate?: number;
}

// Concrete sender encodings per tier. `off` is handled by suspending the track, not by
// these numbers, but is kept here for completeness.
export const TIER_ENCODING: Record<Tier, TierEncoding> = {
  off: { maxBitrate: 1, scaleResolutionDownBy: 4, maxFramerate: 1 },
  low: { maxBitrate: 150_000, scaleResolutionDownBy: 4, maxFramerate: 15 },
  medium: { maxBitrate: 500_000, scaleResolutionDownBy: 2, maxFramerate: 24 },
  high: { maxBitrate: 1_200_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  hd: { maxBitrate: 2_500_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
};

// The send-bitrate a tier wants; used both to climb (need headroom for the NEXT tier) and to
// detect pressure (available dropped below the CURRENT tier's target).
const TIER_TARGET: Record<Tier, number> = {
  off: 0,
  low: 150_000,
  medium: 500_000,
  high: 1_200_000,
  hd: 2_500_000,
};

const CLIMB_AFTER = 3; // consecutive healthy samples before a one-step climb
const LOSS_HIGH = 0.05; // 5% receiver-reported packet loss → back off
// Only back off on the bandwidth estimate when it's WELL below what the current tier wants
// (a margin), since each mesh leg estimates bandwidth independently and the numbers are noisy.
const BW_BACKOFF_MARGIN = 0.7;

/** A single getStats sample, reduced to the signals the controller needs. Fields are
 *  optional because Safari/WebKit doesn't expose them all (the controller degrades to the
 *  cross-browser receiver-loss/RTT signal when bitrate/limitation info is missing). */
export interface StatsSnapshot {
  // The browser is limited by bandwidth OR cpu (qualityLimitationReason). CPU matters a lot in
  // a mesh: each peer is a separate encoder, so N peers = N parallel encodes — a phone/iPad
  // saturates and silently degrades unless we back off, which is why we treat cpu as congestion.
  qualityLimited: boolean;
  availableOutgoingBitrate?: number; // candidate-pair (often absent on Safari; noisy in a mesh)
  fractionLost: number; // remote-inbound-rtp.fractionLost, 0..1 (the receiver's downlink view)
  rtt?: number; // remote-inbound-rtp.roundTripTime, seconds
}

export interface ControllerState {
  tier: Tier;
  healthyStreak: number;
}

/** Initial state: every connection starts sending LOW (never the maximum). */
export function initialController(): ControllerState {
  return { tier: 'low', healthyStreak: 0 };
}

const idxOf = (t: Tier): number => TIERS.indexOf(t);

/** The lower (more conservative) of two tiers. */
export function tierMin(a: Tier, b: Tier): Tier {
  return idxOf(a) <= idxOf(b) ? a : b;
}

/** Ceiling tier for a mesh by how many peers we're encoding to. Each peer is an independent
 *  encoder + uplink share, so the ceiling drops as peers are added to keep total CPU/uplink
 *  sane — but it stays at full resolution (`high`) for small groups so capable devices look
 *  sharp; only HD (a costly single big encode) is reserved for 1:1 / 2-person. The per-device
 *  `cpu` and bandwidth back-offs then trim weaker hardware/links below this on their own.
 *  1 peer (2-person) → HD; 2–3 peers (3–4-person, up to the video cap) → high; more → medium. */
export function clampForPeers(peers: number): Tier {
  if (peers <= 1) return 'hd';
  if (peers <= 3) return 'high';
  return 'medium';
}

/**
 * Decide the next controller state from the current one, a fresh stats sample, and the
 * upper-bound clamp (manual pin / data-saver, already combined with the peer-count ceiling).
 * Pure: same inputs → same output.
 *
 * Climbs on sustained health up to the ceiling (it does NOT hard-gate the climb on the
 * per-leg bandwidth estimate — that number is unreliable in a mesh and was stranding video at
 * the lowest tier). The per-tier maxBitrate plus the browser's own pacing prevent overshoot,
 * and we back off promptly on a real congestion signal (bandwidth/cpu limitation, packet loss,
 * or the estimate collapsing well under the current tier).
 */
export function nextTier(state: ControllerState, snap: StatsSnapshot, clamp: Tier): ControllerState {
  const idx = idxOf(state.tier);
  const clampIdx = idxOf(clamp);
  const knownBw = typeof snap.availableOutgoingBitrate === 'number';

  // Congestion → back off one step immediately (floor at `off`). Wins over the clamp: call
  // survival beats any pin.
  const congested =
    snap.qualityLimited ||
    snap.fractionLost > LOSS_HIGH ||
    (knownBw && (snap.availableOutgoingBitrate as number) < TIER_TARGET[state.tier] * BW_BACKOFF_MARGIN);
  if (congested) {
    return { tier: TIERS[Math.max(0, idx - 1)], healthyStreak: 0 };
  }

  // Above the clamp (e.g. pin lowered, or more peers joined and dropped the ceiling) → come down.
  if (idx > clampIdx) {
    return { tier: clamp, healthyStreak: 0 };
  }

  // Healthy and below the ceiling → climb one step after K consecutive healthy samples. Without
  // a known bandwidth estimate (Safari) never blind-climb past `high`; HD needs a real estimate.
  const ceilingIdx = knownBw ? clampIdx : Math.min(clampIdx, idxOf('high'));
  const streak = state.healthyStreak + 1;
  if (streak >= CLIMB_AFTER && idx < ceilingIdx) {
    return { tier: TIERS[idx + 1], healthyStreak: 0 };
  }
  return { tier: state.tier, healthyStreak: streak };
}

/** Reduce a getStats report to the controller's input signals. Missing fields (Safari doesn't
 *  expose them all) are left undefined; nextTier copes. Shared by the mesh (per-leg) and the
 *  1:1 path. */
export function snapshotFromReport(report: RTCStatsReport): StatsSnapshot {
  let qualityLimited = false;
  let availableOutgoingBitrate: number | undefined;
  let fractionLost = 0;
  let rtt: number | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  report.forEach((st: any) => {
    if (st.type === 'outbound-rtp' && st.kind === 'video') {
      // bandwidth OR cpu: in a mesh, N peers = N parallel encoders, so cpu limitation is common
      // on phones/tablets and must trigger a back-off just like bandwidth does.
      if (st.qualityLimitationReason === 'bandwidth' || st.qualityLimitationReason === 'cpu') {
        qualityLimited = true;
      }
    } else if (st.type === 'candidate-pair' && typeof st.availableOutgoingBitrate === 'number') {
      if (st.nominated || st.selected || availableOutgoingBitrate == null) {
        availableOutgoingBitrate = st.availableOutgoingBitrate;
      }
    } else if (st.type === 'remote-inbound-rtp' && st.kind === 'video') {
      if (typeof st.fractionLost === 'number') fractionLost = Math.max(fractionLost, st.fractionLost);
      if (typeof st.roundTripTime === 'number') rtt = st.roundTripTime;
    }
  });
  return { qualityLimited, availableOutgoingBitrate, fractionLost, rtt };
}

/** Map the manual pin ('auto'|'medium'|'low') + data-saver to the controller's clamp tier.
 *  'auto' allows up to HD (bandwidth-gated); data-saver caps at medium; an explicit pin caps
 *  at that tier. The clamp is an upper bound only. */
export function clampForPin(pin: 'auto' | 'medium' | 'low', lessData: boolean): Tier {
  if (pin === 'low') return 'low';
  if (pin === 'medium') return 'medium';
  return lessData ? 'medium' : 'hd';
}
