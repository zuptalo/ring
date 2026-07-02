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
  'notifications.message.show', 'notifications.message.reactions', 'notifications.message.sound',
  'notifications.group.show', 'notifications.group.reactions', 'notifications.group.sound',
  'notifications.wall.show', 'notifications.showPreview', 'notifications.badge',
  'notifications.inapp.enabled', 'notifications.inapp.style', 'notifications.inapp.sounds', 'notifications.inapp.vibrate',
  'chats.animEmoji', 'chats.animGifs', 'chats.tabFilters', 'chats.saveToPhotos', 'chats.keepArchived',
];
