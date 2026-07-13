/**
 * The user-preference settings backed up by encrypted own-data sync (see `ownsync.ts`).
 *
 * Kept in its own dependency-free module so the allowlist can be imported and asserted in
 * unit tests without pulling in the full sync engine (which transitively imports UI/SFC code).
 *
 * App-lock and device-local/storage settings are intentionally excluded (they're per-device or
 * security-sensitive). The whole snapshot is sealed under the master key before it leaves the
 * device — the server enforces nothing here.
 */
export const SYNCED_PREF_KEYS: string[] = [
  'privacy.lastSeen', 'privacy.online', 'privacy.profilePhoto', 'privacy.about',
  'privacy.groups', 'privacy.messageTimer',
  'privacy.disableLinkPreviews',
  // "Always relay calls" (spec 1043): a threat-model preference, so it follows
  // the user to every device. NEVER re-add the retired privacy.protectIp here —
  // old encrypted snapshots may still carry a stale value for it.
  'privacy.relayCalls',
  'notifications.message.show', 'notifications.message.reactions', 'notifications.message.sound',
  'notifications.group.show', 'notifications.group.reactions', 'notifications.group.sound',
  'notifications.wall.show', 'notifications.wall.activity', 'notifications.showPreview', 'notifications.badge',
  // Game notifications (spec 0009). Deliberately NOT games.follows — the follow
  // set is device-local and private by spec FR-006.
  'notifications.games.turn', 'notifications.games.challenges',
  'notifications.games.followMoves', 'notifications.games.followResults',
  'notifications.inapp.enabled', 'notifications.inapp.style', 'notifications.inapp.sounds', 'notifications.inapp.vibrate',
  'chats.animEmoji', 'chats.animGifs', 'chats.tabFilters', 'chats.keepArchived',
];
