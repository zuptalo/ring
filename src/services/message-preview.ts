/**
 * Chats-list preview derivation for a message — the text line and the icon
 * category the list renders next to it. Pure and import-clean (no idb/DOM), so
 * BOTH writers of chat rows produce identical previews: the page's authoritative
 * receive (db/queries.ts) and the service worker's notification-time apply
 * (sw-drain.ts, spec 1032). Extracted from queries.ts verbatim — behavior must
 * not drift between the two.
 */
import type { Chat } from '@/db/types';
import type { MessagePayload } from './crypto/message';
import { GAMES } from '@/games/registry';

const durLabel = (sec?: number) =>
  sec ? ` (${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')})` : '';

/** Chats-list preview text for a media message (label + duration). The chats
 *  list pairs this with an Ionic icon derived from `previewKind`, so no emoji. */
export function mediaPreview(kind: string, durationSec?: number, name?: string, videoNote?: boolean): string {
  if (kind === 'voice') return `Voice message${durLabel(durationSec)}`;
  if (kind === 'video') return videoNote ? `Video note${durLabel(durationSec)}` : 'Video';
  if (kind === 'image') return 'Photo';
  if (kind === 'audio') return name && name !== 'attachment' ? name : 'Audio';
  if (kind === 'file') return `${name && name !== 'attachment' ? name : 'Document'}`;
  return 'Attachment';
}

/** The icon category for the chats-list preview of a (possibly media) message. */
export function previewKind(kind: string, albumName?: string, videoNote?: boolean): Chat['lastKind'] {
  if (albumName) return 'album';
  if (kind === 'video') return videoNote ? 'videonote' : 'video';
  if (kind === 'image' || kind === 'voice' || kind === 'file' || kind === 'audio') return kind;
  if (kind === 'location' || kind === 'poll' || kind === 'contact' || kind === 'game') return kind;
  return 'text';
}

/** The chats-list preview line for an incoming payload — the exact expression the
 *  page's receive path builds (queries.ts), shared so the SW writes the same line. */
export function chatListPreview(payload: MessagePayload, kind: string, durationSec?: number): string {
  return payload.albumName
    ? payload.albumName
    : kind === 'location'
      ? payload.location?.label || 'Location'
      : kind === 'poll'
        ? payload.poll?.question || 'Poll'
        : kind === 'game'
          ? GAMES[payload.game?.gameType ?? '']?.displayName ?? 'Game'
          : kind === 'contact'
          ? payload.contact?.name || 'Contact'
          : kind === 'audio'
            ? payload.audio?.title || mediaPreview('audio', durationSec, payload.mediaRef?.name)
            : payload.body || mediaPreview(kind, durationSec, undefined, payload.videoNote);
}
