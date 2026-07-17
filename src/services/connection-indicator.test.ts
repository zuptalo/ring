// Spec 1042 — the connection pill's pure decision rules. The component
// (ConnectionBanner.vue) only schedules a timer off these; every behavior the
// spec pins lives here: the flap-proof grace latch, the signed-in gate, and
// the device-offline vs server-unreachable copy.
import { describe, it, expect } from 'vitest';
import { CONN_GRACE_MS, nextDownSince, indicatorVisible, indicatorLabel } from './connection-indicator';

const T0 = 1_800_000_000_000;

describe('grace latch (nextDownSince)', () => {
  it('starts the window on the first non-online state', () => {
    expect(nextDownSince(null, 'connecting', T0)).toBe(T0);
    expect(nextDownSince(null, 'offline', T0)).toBe(T0);
  });

  it('keeps the ORIGINAL timestamp across offline↔connecting flaps (one continuous window)', () => {
    let since = nextDownSince(null, 'connecting', T0);
    since = nextDownSince(since, 'offline', T0 + 500);
    since = nextDownSince(since, 'connecting', T0 + 1_200);
    since = nextDownSince(since, 'offline', T0 + 2_900);
    expect(since).toBe(T0); // a per-flap restart would keep the pill from ever showing
  });

  it('resets on online, and a later drop starts a FRESH window', () => {
    let since = nextDownSince(null, 'offline', T0);
    since = nextDownSince(since, 'online', T0 + 1_000);
    expect(since).toBeNull();
    since = nextDownSince(since, 'connecting', T0 + 60_000);
    expect(since).toBe(T0 + 60_000);
  });
});

describe('visibility (indicatorVisible)', () => {
  it('shows only once the window outlasts the grace period', () => {
    expect(indicatorVisible(T0, true, T0 + CONN_GRACE_MS - 1)).toBe(false);
    expect(indicatorVisible(T0, true, T0 + CONN_GRACE_MS)).toBe(true);
  });

  it('never shows while online (null latch) or signed out', () => {
    expect(indicatorVisible(null, true, T0 + 60_000)).toBe(false);
    expect(indicatorVisible(T0, false, T0 + 60_000)).toBe(false); // onboarding idles at offline by design
  });
});

describe('copy (indicatorLabel)', () => {
  it('tells the device-offline case apart from the server-unreachable case', () => {
    expect(indicatorLabel(true)).toBe('Connecting…');
    expect(indicatorLabel(false)).toBe('Waiting for network…');
  });
});
