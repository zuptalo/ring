/**
 * Notification-tap navigation intent.
 *
 * A RICH notification carries the exact chat deep-link (`/chat/<id>`) because the
 * SW decrypted the frame and resolved the conversation. A GENERIC notification —
 * shown when the sender's app is pre-preview (< 1.0.10, no ciphertext-in-push) or
 * the recipient's phone was locked+off and the decrypt missed the show deadline —
 * has NO decrypted payload, so the SW can't name the chat. It used to fall back to
 * `/tabs/chats`, which dumped the tap on the chat LIST instead of the conversation.
 *
 * This encodes a "route me to the RELEVANT chat" intent that the APP resolves after
 * unlock, where it has full IndexedDB access (the SW must not do that work on a
 * locked iOS device — that's exactly the window it's too slow for). The optional
 * `from` (the push sender id) lets the app land precisely on a 1:1 chat; without it
 * (or for a group, whose id needs the decrypt we don't have) the app falls back to
 * the newest unread chat, then the list. A tiny leaf module so both the SW bundle
 * and the app can import it without pulling in heavy deps or creating a cycle.
 */

// A sentinel that can never be mistaken for a real route (routes start with '/').
const PREFIX = 'ring-relevant';

/** Build the intent url for a generic notification. `from` = the push sender id, when known. */
export function relevantNav(from?: string): string {
  return from ? `${PREFIX}:${from}` : PREFIX;
}

/** Parse a notification's stored url. `relevant` is true for the sentinel; `from` is the
 *  sender id when one was encoded. A normal `/…` deep-link parses as not-relevant. */
export function parseRelevantNav(url?: string): { relevant: boolean; from?: string } {
  if (!url || (url !== PREFIX && !url.startsWith(`${PREFIX}:`))) return { relevant: false };
  const from = url.length > PREFIX.length + 1 ? url.slice(PREFIX.length + 1) : undefined;
  return { relevant: true, from };
}
