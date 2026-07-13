import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rtcConfig, callRtcConfig, clearTurnConfig, type TurnConfig } from './turn';
import { getSetting } from '@/db/queries';

// callRtcConfig composes the fetched ICE servers with the user's relay
// preference; isolate it from the real app by mocking the settings read, the
// auth token, and the credentials fetch (node env — no real network).
vi.mock('@/db/queries', () => ({ getSetting: vi.fn() }));
vi.mock('@/services/auth', () => ({ getToken: () => 'test-token' }));
vi.mock('@/services/config', () => ({ apiBaseUrl: () => 'http://test.invalid' }));

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['turns:ring.test:443?transport=tcp'], username: 'u', credential: 'c' },
  { urls: ['stun:ring.test:3478'] },
];

const turn: TurnConfig = { iceServers: ICE_SERVERS, ttl: 3600, fetchedAt: Date.now() };

describe('rtcConfig (spec 1043 — direct when possible, relay on demand)', () => {
  it('defaults to iceTransportPolicy "all" so direct host/srflx pairs are tried', () => {
    expect(rtcConfig(turn).iceTransportPolicy).toBe('all');
  });

  it('forces "relay" when relayOnly is set (Always relay calls)', () => {
    expect(rtcConfig(turn, { relayOnly: true }).iceTransportPolicy).toBe('relay');
    expect(rtcConfig(turn, { relayOnly: false }).iceTransportPolicy).toBe('all');
  });

  it('keeps max-bundle and passes the server-advertised iceServers through untouched', () => {
    const cfg = rtcConfig(turn);
    expect(cfg.bundlePolicy).toBe('max-bundle');
    expect(cfg.iceServers).toEqual(ICE_SERVERS);
  });
});

describe('callRtcConfig (setting-aware config shared by every call site)', () => {
  beforeEach(() => {
    clearTurnConfig();
    vi.mocked(getSetting).mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ iceServers: ICE_SERVERS, ttl: 3600 }),
      })),
    );
  });

  it('reads privacy.relayCalls with a default of false and yields "all"', async () => {
    vi.mocked(getSetting).mockImplementation(async (_key, fallback) => fallback);
    const cfg = await callRtcConfig();
    expect(getSetting).toHaveBeenCalledWith('privacy.relayCalls', false);
    expect(cfg.iceTransportPolicy).toBe('all');
    expect(cfg.iceServers).toEqual(ICE_SERVERS);
  });

  it('yields "relay" when the user switched Always relay calls on', async () => {
    vi.mocked(getSetting).mockResolvedValue(true);
    const cfg = await callRtcConfig();
    expect(cfg.iceTransportPolicy).toBe('relay');
  });
});
