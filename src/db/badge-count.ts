/**
 * Badge total computation (spec 1027, fixes bug B4; cache tightened in 1028).
 *
 * How hidden chats affect the unread badge is user-chosen
 * (`privacy.hiddenChatsBadge`):
 *   'always'   (default) — hidden chats count, so you always know something is
 *              waiting (the badge can hint a hidden chat exists; the user opted in).
 *   'revealed' — hidden chats count only during an active reveal session.
 *   'never'    — hidden chats never contribute, so the badge can't betray one.
 *
 * The subtlety is the cold-open window in the non-'always' modes: before the
 * hidden set decrypts we cannot classify ANY chat, and the naive code returned 0
 * for the whole app — suppressing legitimate visible-chat badges. The fix:
 * `hidden === null` (unknown) falls back to `lastCount`, a recent successfully
 * computed HIDDEN-EXCLUDED total (persisted as the device-local
 * `badge.lastCount`).
 *
 * `cacheable` tells the caller whether this result may seed `badge.lastCount`.
 * ONLY a hidden-EXCLUDED count is cacheable: the `always` total is hidden-
 * inclusive, and a `revealed`-while-revealed total counts hidden unreads —
 * caching either would let a later locked cold-open under `never`/`revealed`
 * briefly surface hidden activity against the user's choice (the mode-at-write
 * leak). The fallback branch is not cacheable either (it would just rewrite
 * itself). When nothing hidden-excluded has ever been cached, the fallback
 * returns 0 — a brief under-count, which is the fail-closed-safe direction (no
 * leak).
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
): { total: number; cacheable: boolean } {
  if (mode === 'always') {
    // Hidden-inclusive — correct to display, but must never seed the fallback.
    return { total: chats.reduce((n, c) => n + (c.unread || 0), 0), cacheable: false };
  }
  if (!hidden) return { total: lastCount ?? 0, cacheable: false };
  const countHidden = mode === 'revealed' && revealed;
  return {
    total: chats.reduce(
      (n, c) => n + (!countHidden && hidden.has(c.id) ? 0 : c.unread || 0),
      0,
    ),
    cacheable: !countHidden, // only a hidden-EXCLUDED total is safe to cache
  };
}
