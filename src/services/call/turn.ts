/**
 * Fetches ephemeral ICE/TURN configuration from the server for WebRTC calls.
 *
 * Media goes direct when the networks allow it and falls back to the
 * self-hosted TURN relay when they don't (spec 1043). The server always
 * advertises the short-lived TURNS-on-443 credential; deployments that opt
 * into the UDP endpoint additionally advertise a credential-less `stun:`
 * entry so peers on different networks can discover their public addresses.
 * We cache the response until just before it expires; callers refresh for
 * long calls and ICE restarts.
 */
import { apiBaseUrl } from '@/services/config';
import { getToken } from '@/services/auth';
import { getSetting } from '@/db/queries';

export interface TurnConfig {
  iceServers: RTCIceServer[];
  ttl: number; // seconds
  fetchedAt: number; // epoch ms
}

let cached: TurnConfig | null = null;

/** Fetch (or return cached) ICE servers. Pass force to bypass the cache. */
export async function getTurnConfig(force = false): Promise<TurnConfig> {
  if (
    !force &&
    cached &&
    Date.now() - cached.fetchedAt < cached.ttl * 1000 - 30_000 // refresh 30s early
  ) {
    return cached;
  }
  const token = getToken();
  if (!token) throw new Error('not authenticated');

  const res = await fetch(`${apiBaseUrl()}/v1/turn-credentials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`turn-credentials ${res.status}`);
  const data = (await res.json()) as { iceServers: RTCIceServer[]; ttl: number };
  cached = { iceServers: data.iceServers, ttl: data.ttl, fetchedAt: Date.now() };
  return cached;
}

/** Drop the cached config (e.g. on sign-out). */
export function clearTurnConfig(): void {
  cached = null;
}

/**
 * Fire-and-forget cache warm (spec 2008): kick the TTL-cached credential fetch off the critical
 * path — at outgoing call intent and on incoming ring — so the eventual `newPeerConnection` finds
 * the cache warm instead of blocking on a network round-trip. Idempotent (a warm hit returns the
 * cache); never throws. Reuses the exact same authenticated request — only *when* it runs moves
 * earlier, so it reveals nothing new to the server.
 */
export function warmTurnConfig(): void {
  void getTurnConfig().catch(() => {
    /* a failed warm is harmless — the real call still fetches/awaits on its own path */
  });
}

/**
 * Build the RTCConfiguration for a call. Policy is `'all'` so ICE can pick a
 * direct pair when one works — same-LAN via mDNS host candidates, cross-network
 * via srflx where the deployment advertises a STUN endpoint — and the TURN
 * relay stays in the candidate set as the automatic fallback, so no network
 * that could connect under the old forced-relay behavior gets worse. The
 * relayOnly override exists for the "Always relay calls" privacy setting:
 * relay-only gathering never hands the peer a direct address for this user.
 */
export function rtcConfig(turn: TurnConfig, opts?: { relayOnly?: boolean }): RTCConfiguration {
  return {
    iceServers: turn.iceServers,
    iceTransportPolicy: opts?.relayOnly ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
  };
}

/**
 * The one place call setup turns user preference into an RTCConfiguration.
 * Every peer connection — the 1:1 call, each mesh leg, and the mesh's
 * setConfiguration on ICE restart — must come through here so a restart can
 * never silently flip the transport policy out from under the privacy setting.
 * The setting is read per connection, so a toggle applies from the next call.
 */
export async function callRtcConfig(): Promise<RTCConfiguration> {
  const [turn, relayOnly] = await Promise.all([
    getTurnConfig(),
    getSetting<boolean>('privacy.relayCalls', false),
  ]);
  return rtcConfig(turn, { relayOnly });
}
