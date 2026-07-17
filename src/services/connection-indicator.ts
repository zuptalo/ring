/**
 * Connection-state pill decisions (spec 1042) — the PURE half of
 * components/ConnectionBanner.vue, kept free of Vue and timers so the rules
 * stay unit-testable:
 *  - the grace latch: ONE continuous non-online window across the retry loop's
 *    offline↔connecting flaps (restarting the clock per flap would keep the
 *    pill from ever showing while disconnected);
 *  - visibility: signed-in AND the window outlasted the grace period (a
 *    signed-out device idles at 'offline' by design — nothing is wrong);
 *  - copy: the device being offline reads differently from the server being
 *    unreachable, so the user knows whether to check their own connectivity.
 */
import type { TransportState } from '@/services/transport';

/** How long the link must be CONTINUOUSLY non-online before the pill shows:
 *  long enough to swallow a cold start's connect handshake and transient
 *  blips, short enough that a dead server is called out while the stuck
 *  clock-icon message is still on screen. */
export const CONN_GRACE_MS = 3000;

/** The grace latch: when the CURRENT non-online stretch began (null = online).
 *  Feed it every state change; it keeps the ORIGINAL timestamp across
 *  offline↔connecting flaps and resets only on 'online'. */
export function nextDownSince(prev: number | null, state: TransportState, now: number): number | null {
  if (state === 'online') return null;
  return prev ?? now;
}

/** Should the pill be visible right now? */
export function indicatorVisible(
  downSince: number | null,
  authed: boolean,
  now: number,
  graceMs: number = CONN_GRACE_MS,
): boolean {
  return authed && downSince !== null && now - downSince >= graceMs;
}

/** The pill's copy: device-offline vs server-unreachable. */
export function indicatorLabel(netUp: boolean): string {
  return netUp ? 'Connecting…' : 'Waiting for network…';
}
