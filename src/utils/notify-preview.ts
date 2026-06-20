/**
 * One-line, human-readable preview of a message for an OS / push notification.
 * Notifications are plain text (no Ionicons), so shared location / contact / poll
 * are spelled out ("Shared a location", "Contact: …", "Poll: …") instead of the
 * bare word the chats list shows next to its icon.
 *
 * Shared by the page (services/notify via db/queries) and the service worker
 * (services/sw-inbox) so both notification paths read identically. Pure, safe to
 * import into the service worker.
 */
import type { MessagePayload } from '@/services/crypto/message';

export function notifyPreview(p: MessagePayload): string {
  // Defensive (spec 1015 FR-004a): only ever surface a clean string. A decrypted
  // but malformed payload (e.g. a non-string body) must fall through to a safe
  // label, never render a partial/garbled preview.
  if (typeof p.albumName === 'string' && p.albumName.trim()) return p.albumName; // an album wins over any per-item caption
  if (typeof p.body === 'string' && p.body.trim()) return p.body; // a caption (or the text message itself)
  switch (p.kind) {
    case 'image':
      return 'Photo';
    case 'video':
      return p.videoNote ? 'Video note' : 'Video';
    case 'voice':
      return 'Voice message';
    case 'audio':
      return p.audio?.title || 'Audio';
    case 'file':
      return 'Document';
    case 'location':
      return p.location?.label ? `Location: ${p.location.label}` : 'Shared a location';
    case 'poll':
      return p.poll?.question ? `Poll: ${p.poll.question}` : 'Shared a poll';
    case 'contact':
      return p.contact?.name ? `Contact: ${p.contact.name}` : 'Shared a contact';
    default:
      return 'New message';
  }
}
