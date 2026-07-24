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
 * locked iOS device — that's exactly the window it's too slow for). The app routes
 * to the newest UNREAD chat, which is the one that just received the triggering
 * message — 1:1 OR group. We deliberately do NOT encode the push sender id: for a
 * GROUP message the sender is a group member, and resolving them to their 1:1 chat
 * sent the tap to the wrong conversation (a member you also DM). The newest-unread
 * chat is right for both kinds without needing the decrypt we don't have. A tiny
 * leaf module so both the SW bundle and the app can import it without pulling in
 * heavy deps or creating a cycle.
 */

// A sentinel that can never be mistaken for a real route (routes start with '/').
const PREFIX = 'ring-relevant';

/** Build the intent url for a generic notification. */
export function relevantNav(): string {
  return PREFIX;
}

/** Whether a notification's stored url is the "route to the relevant chat" intent.
 *  A normal `/…` deep-link (a rich note's chat link) is not-relevant and routes verbatim. */
export function isRelevantNav(url?: string): boolean {
  return url === PREFIX;
}
