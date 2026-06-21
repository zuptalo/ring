/** Compact "time left before a post disappears" label, e.g. "2h left", "45m left".
 *  Returns '' when there's no expiry, 'expiring…' once elapsed. */
export function timeLeft(expiresAt: number | undefined, nowMs: number): string {
  if (!expiresAt) return '';
  const s = Math.floor((expiresAt - nowMs) / 1000);
  if (s <= 0) return 'expiring…';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m left`;
  if (s < 86400) return `${Math.floor(s / 3600)}h left`;
  return `${Math.floor(s / 86400)}d left`;
}

/** Compact relative time for a post/comment timestamp ("now", "5m", "3h", "2d"). */
export function ago(ts: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(ts).toLocaleDateString();
}
