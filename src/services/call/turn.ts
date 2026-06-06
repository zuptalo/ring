/**
 * Fetches ephemeral ICE/TURN configuration from the server for WebRTC calls.
 *
 * All media rides the self-hosted TURNS relay on 443 (the only public path), so
 * the server returns a single short-lived `turns:` entry. We cache it until just
 * before it expires; callers refresh for long calls and ICE restarts.
 */
import { apiBaseUrl } from '@/services/config';
import { getToken } from '@/services/auth';

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
 * Build the RTCConfiguration for a call. We force `iceTransportPolicy: 'relay'`
 * because in the 443-only deployment the only reachable candidate is the TURNS
 * relay; trying host/srflx pairs would only add gathering latency.
 */
export function rtcConfig(turn: TurnConfig): RTCConfiguration {
  return {
    iceServers: turn.iceServers,
    iceTransportPolicy: 'relay',
    bundlePolicy: 'max-bundle',
  };
}
