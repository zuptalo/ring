/**
 * Badge total computation (spec 1027, fixes bug B4).
 *
 * How hidden chats affect the unread badge is user-chosen
 * (`privacy.hiddenChatsBadge`):
 *   'always'   (default) — hidden chats count, so you always know something is
 *              waiting (the badge can hint a hidden chat exists; the user opted in).
 *   'revealed' — hidden chats count only during an active reveal session.
 *   'never'    — hidden chats never contribute, so the badge can't betray one.
 *
 * The subtlety is the cold-open window in the non-'always' modes: before the
 * hidden set decrypts we cannot classify ANY chat, and the old code returned 0
 * for the whole app — suppressing legitimate visible-chat badges. The fix:
 * `hidden === null` (unknown) falls back to `lastCount`, the most recent
 * successfully computed and ALREADY preference-filtered total (persisted as the
 * device-local `badge.lastCount`; it equals what the OS badge showed a moment
 * ago, so it reveals nothing new). `fresh` tells the caller whether the result
 * came from a real computation (persist it) or the fallback (don't).
 *
 * Pure and dependency-free so both the page (`queries.countUnread`) and any
 * future SW use share one tested semantic.
 */

export type HiddenBadgeMode = 'always' | 'never' | 'revealed';

export function computeUnreadTotal(
  chats: ReadonlyArray<{ id: string; unread?: number }>,
  mode: HiddenBadgeMode,
  hidden: ReadonlySet<string> | null, // null = set not yet decryptable (unknown)
  revealed: boolean,
  lastCount: number | null,
): { total: number; fresh: boolean } {
  if (mode === 'always') {
    return { total: chats.reduce((n, c) => n + (c.unread || 0), 0), fresh: true };
  }
  if (!hidden) return { total: lastCount ?? 0, fresh: false };
  const countHidden = mode === 'revealed' && revealed;
  return {
    total: chats.reduce(
      (n, c) => n + (!countHidden && hidden.has(c.id) ? 0 : c.unread || 0),
      0,
    ),
    fresh: true,
  };
}
