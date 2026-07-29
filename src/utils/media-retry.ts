/**
 * Spec 2058: how many times the chat may re-try fetching one attachment BY ITSELF.
 *
 * A pending attachment recovers on its own when its bubble scrolls into view, which is what
 * makes a voice message that arrived while the app was closed simply work. But that trigger
 * fires every time the bubble comes back into view, so an attachment that can never be
 * fetched — its blob aged off the relay, the sender's device never finished the upload —
 * would retry every single time you scrolled past it, forever.
 *
 * The bound only ever restrains the AUTOMATIC path. A deliberate tap always attempts, however
 * many times the automatic path has already given up (a tap usually means the person just
 * fixed the thing that was broken — they reconnected).
 *
 * The count deliberately lives in memory for the session rather than on the message. If it
 * were persisted, a message that burned its attempts during one offline stretch would be
 * stuck on manual-tap for the rest of that install; letting it die with the session means the
 * next launch quietly tries again, which is exactly what a message stranded by an older build
 * needs.
 */
export const AUTO_RETRY_LIMIT = 3;

/** Whether the automatic on-view recovery may attempt this message again. */
export function shouldAutoRetry(attempts: number): boolean {
  // Callers read from a Map that has no entry until the first attempt, so treat a missing or
  // nonsensical count as "never tried" — reading it as "exhausted" would silently turn
  // recovery off for every message.
  if (!Number.isFinite(attempts) || attempts < 0) return true;
  return attempts < AUTO_RETRY_LIMIT;
}
