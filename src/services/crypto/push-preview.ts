/**
 * Spec 1055 — bounded encrypted PREVIEW for the ciphertext-in-push notification path.
 *
 * The sender builds a small, display-sized preview of a message (buildPreview),
 * seals it under a per-message key derived from the ratchet message key
 * (sealMessageWithPreview → ratchetEncryptWithPreview), and attaches it to the Web
 * Push. The recipient service worker PEEK-decrypts it (openPushPreview) against a
 * discarded session copy — no persist, no store, no ack — and renders a rich
 * notification with no /relay/pending fetch. The full message still relays and is
 * stored authoritatively over WebSocket on app open.
 *
 * Bounded by design: notification UIs truncate to ~200 chars on every platform and
 * the push stores nothing, so the preview carries only what the notification renderer
 * (notifyPreview / noteForPayload) reads. The free-text body is truncated to a UTF-8
 * byte budget, and large / sensitive fields — the media reference (incl. the file KEY
 * and the poster thumbnail), inline link previews, poll options, and game board state
 * — are dropped entirely. The SW never decrypts media from a push.
 */
import type { MessagePayload } from './message';
import type { Header } from './ratchet';
import { ratchetOpenPreview, loadSession } from './ratchet';
import { bytesToUtf8, type Envelope } from './envelope';

/** UTF-8 byte budget for the preview's free text. ~256 B overfills the visible area
 *  on every platform (iOS/iPadOS ~150–250 chars, Android/desktop less); the constant
 *  push padding (server-side RecordSize) makes the encrypted payload size uniform. */
export const PREVIEW_BODY_BUDGET = 256;

/** Truncate a string to at most `budget` UTF-8 bytes, never splitting a character
 *  (or a surrogate pair) — so an emoji / non-Latin body cannot overflow the budget. */
export function truncateUtf8(s: string, budget: number): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= budget) return s;
  // Trim by code points until it fits; [...s] iterates whole code points (surrogate-safe).
  const cps = [...s];
  let out = '';
  for (const cp of cps) {
    if (enc.encode(out + cp).length > budget) break;
    out += cp;
  }
  return out;
}

/**
 * Build a bounded, display-only preview payload from a full message payload. Keeps
 * only the fields the notification renderer reads; truncates the free text; drops or
 * shrinks large / sensitive fields. Pure — applies nothing recipient-specific (the
 * recipient's mute/hidden/preview prefs are enforced at render, in noteForPayload).
 */
export function buildPreview(p: MessagePayload): MessagePayload {
  const preview: MessagePayload = { ...p };

  // The one unbounded field: truncate to the byte budget on a character boundary.
  if (typeof preview.body === 'string') preview.body = truncateUtf8(preview.body, PREVIEW_BODY_BUDGET);
  if (typeof preview.albumName === 'string') preview.albumName = truncateUtf8(preview.albumName, PREVIEW_BODY_BUDGET);

  // Drop large / sensitive fields the notification never needs. notifyPreview reads
  // only `kind`/`videoNote` for media, so the whole media reference — including the
  // per-file KEY and the poster thumbnail data-URL — is dropped; the SW never
  // decrypts media from a push. Inline link previews carry a data-URL image too.
  delete preview.mediaRef;
  delete preview.linkPreview;

  // Shrink structured fields to the single string the preview renders (drops poll
  // options/votes, game board state, location coordinates, full contact/audio detail).
  // The renderer reads these via optional chaining, so a partial object is safe.
  if (preview.poll) preview.poll = { question: preview.poll.question } as MessagePayload['poll'];
  if (preview.game) preview.game = { gameType: preview.game.gameType } as MessagePayload['game'];
  if (preview.gameChallenge) {
    preview.gameChallenge = { gameType: preview.gameChallenge.gameType } as MessagePayload['gameChallenge'];
  }
  if (preview.location) preview.location = { label: preview.location.label } as MessagePayload['location'];
  if (preview.contact) preview.contact = { name: preview.contact.name } as MessagePayload['contact'];
  if (preview.audio) preview.audio = { title: preview.audio.title } as MessagePayload['audio'];
  // Reply: keep only the quoted author id (reply-to-me detection); drop the quoted body.
  if (preview.reply) preview.reply = { senderId: preview.reply.senderId } as MessagePayload['reply'];

  return preview;
}

/**
 * Recipient PEEK: open a push preview for `chatId` from its ratchet header + preview
 * envelope. Loads a FRESH session copy and never saves it — advancing the ratchet on
 * that copy is discarded, so this consumes nothing (no persist, no store, no ack).
 * Throws on decrypt failure (out-of-order ratchet the device is behind, header
 * mismatch, missing session) — the SW then falls back to a placeholder. Returns null
 * if there is no session for the chat.
 */
export async function openPushPreview(
  chatId: string,
  header: Header,
  previewEnv: Envelope,
  ad: Uint8Array = new Uint8Array(0),
): Promise<MessagePayload | null> {
  const session = await loadSession(chatId);
  if (!session) return null;
  const pt = ratchetOpenPreview(session, header, previewEnv, ad);
  return JSON.parse(bytesToUtf8(pt)) as MessagePayload;
}
