/**
 * Declarative settings tree. One data structure drives the entire settings
 * hierarchy; `SettingDetailPage.vue` renders it with stock Ionic components.
 * Adding a screen is a data edit here, not a new component.
 *
 * Persistence: every toggle/choice/segment carries its own settings `key` and
 * `default`; the renderer reads a live snapshot of the `settings` store and
 * writes with `setSetting(key, value)` on change.
 */
import {
  personOutline,
  lockClosedOutline,
  chatbubbleOutline,
  colorPaletteOutline,
  notificationsOutline,
  cloudDownloadOutline,
  helpCircleOutline,
  shieldCheckmarkOutline,
  keyOutline,
  mailOutline,
  callOutline,
  phonePortraitOutline,
  trashOutline,
  archiveOutline,
  eyeOutline,
  eyeOffOutline,
  timeOutline,
  imageOutline,
  documentOutline,
  videocamOutline,
  musicalNotesOutline,
  cameraOutline,
  peopleOutline,
  informationCircleOutline,
  cellularOutline,
  serverOutline,
  fingerPrintOutline,
  syncOutline,
  shareSocialOutline,
  qrCodeOutline,
  heartOutline,
  cafeOutline,
  logoGithub,
} from 'ionicons/icons';

/** ion-icon registry, keeps the schema serializable (string keys, not imports). */
export const ICONS: Record<string, string> = {
  person: personOutline,
  lock: lockClosedOutline,
  chat: chatbubbleOutline,
  palette: colorPaletteOutline,
  bell: notificationsOutline,
  download: cloudDownloadOutline,
  help: helpCircleOutline,
  shield: shieldCheckmarkOutline,
  key: keyOutline,
  mail: mailOutline,
  call: callOutline,
  phone: phonePortraitOutline,
  trash: trashOutline,
  archive: archiveOutline,
  eye: eyeOutline,
  eyeOff: eyeOffOutline,
  time: timeOutline,
  image: imageOutline,
  document: documentOutline,
  video: videocamOutline,
  music: musicalNotesOutline,
  camera: cameraOutline,
  people: peopleOutline,
  info: informationCircleOutline,
  cellular: cellularOutline,
  server: serverOutline,
  fingerprint: fingerPrintOutline,
  sync: syncOutline,
  share: shareSocialOutline,
  qr: qrCodeOutline,
  heart: heartOutline,
  cafe: cafeOutline,
  github: logoGithub,
};

export interface ChoiceOption {
  value: string;
  label: string;
  note?: string;
}

export type SettingItem =
  | { type: 'link'; id: string; title: string; icon?: string; note?: string }
  | { type: 'route'; title: string; path: string; icon?: string; note?: string }
  | { type: 'toggle'; title: string; key: string; default: boolean; icon?: string; note?: string }
  | { type: 'choice'; title?: string; key: string; default: string; options: ChoiceOption[]; icon?: string }
  | { type: 'segment'; title?: string; key: string; default: string; options: ChoiceOption[] }
  | { type: 'stat'; title: string; value: string; icon?: string }
  | { type: 'action'; title: string; action: string; danger?: boolean; confirm?: string; icon?: string }
  // Opens an EXTERNAL url in a new browser tab (e.g. a donation page). The app never
  // handles payment — it only links out — so the zero-knowledge boundary is untouched.
  | { type: 'external'; title: string; url: string; icon?: string; note?: string }
  | { type: 'note'; text: string };

export interface SettingGroup {
  header?: string;
  footer?: string;
  items: SettingItem[];
}

export interface SettingNode {
  id: string;
  title: string;
  groups: SettingGroup[];
}

/* ---- shared option lists ---- */

// Contacts are curated again, so "My contacts" is a meaningful, server-enforced
// tier: visible to people you've added + people who've added you.
const AUDIENCE: ChoiceOption[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'contacts', label: 'My contacts' },
  { value: 'nobody', label: 'Nobody' },
];
const AUDIENCE_NO_NOBODY: ChoiceOption[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'contacts', label: 'My contacts' },
];
const QUALITY: ChoiceOption[] = [
  { value: 'standard', label: 'Standard quality', note: 'Faster to send, smaller file size' },
  { value: 'hd', label: 'HD quality', note: 'Slower to send, can be 6 times larger' },
];
const AUTO_DOWNLOAD: ChoiceOption[] = [
  { value: 'never', label: 'Never' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'wifi-cellular', label: 'Wi-Fi and cellular' },
];
// Royalty-free tones synthesized on-device (see services/sound.ts), no audio
// files, nothing sampled or licensed. Tapping one in Settings previews it.
const TONES: ChoiceOption[] = [
  { value: 'none', label: 'None' },
  { value: 'note', label: 'Note (default)' },
  { value: 'chime', label: 'Chime' },
  { value: 'ping', label: 'Ping' },
  { value: 'pop', label: 'Pop' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'glow', label: 'Glow' },
  { value: 'beacon', label: 'Beacon' },
];
const TIMER: ChoiceOption[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '90d', label: '90 days' },
  { value: 'off', label: 'Off' },
];
// App-lock grace period: how long Ring can sit in the background before it asks
// for the passcode/passkey again. 'never' never re-locks while the app stays alive
// (backgrounded included) — but a FULL app close still locks at rest, so reopening
// Ring always asks for the passcode. Tradeoff to be aware of: a 'never' user who
// forgets the passcode is fine until the next relaunch, then is locked out and can't
// turn the lock off without it. To stop locking entirely, turn App lock OFF while
// you still know your passcode.
const APP_LOCK_TIMEOUT: ChoiceOption[] = [
  { value: 'never', label: 'Never' },
  { value: '1m', label: '1 minute' },
  { value: '5m', label: '5 minutes' },
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '8h', label: '8 hours' },
  { value: '24h', label: '24 hours' },
];

// Hidden Chats reveal grace window (spec 1019, FR-020). Default '1m'.
const HIDDEN_GRACE: ChoiceOption[] = [
  { value: 'immediately', label: 'Immediately' },
  { value: '1m', label: 'After 1 minute' },
  { value: '5m', label: 'After 5 minutes' },
];

// Whether messages in hidden chats add to the unread badge. Default 'always' so a new
// hidden message is never missed; 'never' keeps the badge from ever hinting one exists.
const HIDDEN_BADGE: ChoiceOption[] = [
  { value: 'always', label: 'Always' },
  { value: 'revealed', label: 'Only while revealed' },
  { value: 'never', label: 'Never (most private)' },
];

/* ---- the tree ---- */

export const SETTINGS: Record<string, SettingNode> = {
  /* ===== ACCOUNT ===== */
  account: {
    id: 'account',
    title: 'Account',
    groups: [
      {
        items: [
          { type: 'link', id: 'account-recovery', title: 'Recovery key', icon: 'key' },
        ],
      },
      {
        items: [
          {
            type: 'action',
            title: 'Delete account',
            action: 'delete-account',
            danger: true,
            confirm:
              'This will erase your account and all on-device data. This cannot be undone.',
            icon: 'trash',
          },
        ],
      },
    ],
  },
  'account-recovery': {
    id: 'account-recovery',
    title: 'Recovery key',
    groups: [
      {
        items: [
          {
            type: 'action',
            title: 'Generate new recovery key',
            action: 'regenerate-recovery',
            icon: 'key',
            confirm:
              'Your current recovery key will stop working and be replaced by a new one. Make sure you can save the new key somewhere safe.',
          },
        ],
        footer:
          'Your recovery key is the only way to restore your account on a new device if you lose this one. No one else can recover it for you. Generate a new one if you think your current key may have been exposed. You can only have one active recovery key at a time.',
      },
    ],
  },

  /* ===== PRIVACY ===== */
  privacy: {
    id: 'privacy',
    title: 'Privacy',
    groups: [
      {
        items: [
          { type: 'link', id: 'privacy-last-seen', title: 'Last seen & online', icon: 'eye' },
          { type: 'link', id: 'privacy-profile-photo', title: 'Profile picture', icon: 'person' },
          { type: 'link', id: 'privacy-about', title: 'About', icon: 'info' },
          { type: 'link', id: 'privacy-groups', title: 'Groups', icon: 'people' },
          { type: 'route', title: 'Close friends', path: '/settings/close-friends', icon: 'people' },
        ],
      },
      {
        header: 'Disappearing messages',
        items: [
          { type: 'link', id: 'privacy-message-timer', title: 'Default message timer', icon: 'time' },
        ],
        footer: 'Start new chats with disappearing messages set to your timer.',
      },
      {
        items: [{ type: 'toggle', title: 'Seen receipts', key: 'privacy.seenReceipts', default: true }],
        footer:
          'If you turn off seen receipts, you won’t send them and you won’t see when other people have seen your messages either. This applies to both one-to-one and group chats.',
      },
      {
        items: [
          { type: 'toggle', title: 'Typing & recording indicators', key: 'privacy.activityIndicators', default: true },
        ],
        footer:
          'Show people when you’re typing or recording. If you turn this off, you won’t see when other people are typing or recording either.',
      },
      {
        items: [
          { type: 'link', id: 'privacy-app-lock', title: 'App lock', icon: 'key' },
          { type: 'link', id: 'privacy-hidden-chats', title: 'Hidden chats', icon: 'eyeOff' },
        ],
      },
      {
        items: [
          { type: 'link', id: 'privacy-advanced', title: 'Advanced', icon: 'shield' },
        ],
      },
    ],
  },
  'privacy-hidden-chats': {
    id: 'privacy-hidden-chats',
    title: 'Hidden chats',
    groups: [
      {
        items: [{ type: 'toggle', title: 'Enable hidden chats', key: 'privacy.hiddenChatsEnabled', default: false }],
        footer:
          'Hide chats behind a separate PIN. A hidden chat is removed from your chat list, search, calls, and notification previews until you type the PIN into the chat search bar. Hiding stays on this device only — it never leaves your phone.',
      },
      {
        items: [{ type: 'action', title: 'Set or change PIN', action: 'hidden-set-pin', icon: 'key' }],
      },
      {
        header: 'Re-lock hidden chats',
        items: [{ type: 'choice', key: 'privacy.hiddenChatsGrace', default: '1m', options: HIDDEN_GRACE }],
        footer: 'How long revealed chats stay visible when you briefly switch apps. A full app close always re-locks immediately.',
      },
      {
        header: 'Unread badge',
        items: [{ type: 'choice', key: 'privacy.hiddenChatsBadge', default: 'always', options: HIDDEN_BADGE }],
        footer:
          'Whether messages in hidden chats add to the unread badge. “Always” means you never miss one, but the count can hint a hidden chat exists. “Never” keeps the badge from ever revealing hidden activity. Hidden chats never show a notification preview or play a sound, regardless of this setting.',
      },
      {
        items: [
          {
            type: 'action',
            title: 'Reset PIN & delete hidden chats',
            action: 'hidden-reset',
            danger: true,
            confirm:
              'This permanently deletes every hidden chat on this device and cannot be undone — they will not come back from the server. Continue?',
          },
        ],
        footer: 'Forgot your PIN? Resetting permanently deletes the hidden chats on this device so they can never be exposed.',
      },
    ],
  },
  'privacy-last-seen': {
    id: 'privacy-last-seen',
    title: 'Last seen & online',
    groups: [
      { header: 'Who can see my last seen', items: [{ type: 'choice', key: 'privacy.lastSeen', default: 'everyone', options: AUDIENCE }] },
      {
        header: 'Who can see when I’m online',
        items: [
          {
            type: 'choice',
            key: 'privacy.online',
            default: 'same',
            options: [
              { value: 'everyone', label: 'Everyone' },
              { value: 'same', label: 'Same as last seen' },
            ],
          },
        ],
        footer:
          'If you don’t share when you were last seen or online, you won’t be able to see when other people were last seen or online.',
      },
    ],
  },
  'privacy-profile-photo': {
    id: 'privacy-profile-photo',
    title: 'Profile picture',
    groups: [{ header: 'Who can see my profile picture', items: [{ type: 'choice', key: 'privacy.profilePhoto', default: 'everyone', options: AUDIENCE }] }],
  },
  'privacy-about': {
    id: 'privacy-about',
    title: 'About',
    groups: [{ header: 'Who can see my About', items: [{ type: 'choice', key: 'privacy.about', default: 'everyone', options: AUDIENCE }] }],
  },
  'privacy-groups': {
    id: 'privacy-groups',
    title: 'Groups',
    groups: [
      {
        header: 'Who can add me to groups',
        items: [{ type: 'choice', key: 'privacy.groups', default: 'everyone', options: AUDIENCE_NO_NOBODY }],
        footer:
          'Admins who can’t add you to a group will have the option of inviting you privately instead.',
      },
    ],
  },
  'privacy-message-timer': {
    id: 'privacy-message-timer',
    title: 'Default message timer',
    groups: [
      {
        header: 'Start new chats with a disappearing message timer set to',
        items: [{ type: 'choice', key: 'privacy.messageTimer', default: 'off', options: TIMER }],
        footer:
          'When turned on, all new individual chats will start with disappearing messages set to the duration you select. This setting will not affect your existing chats.',
      },
    ],
  },
  'privacy-app-lock': {
    id: 'privacy-app-lock',
    title: 'App lock',
    groups: [
      {
        items: [{ type: 'toggle', title: 'Require a passcode', key: 'privacy.appLock', default: false }],
        footer:
          'By default Ring unlocks without a passcode (your keys stay encrypted at rest by a device key). Turning this on asks for a passcode each time you open Ring, stronger protection if your device is lost, but background notifications can no longer show message previews (only “New message”).',
      },
      {
        header: 'Require passcode after being away for',
        items: [{ type: 'choice', key: 'privacy.appLock.timeout', default: '1m', options: APP_LOCK_TIMEOUT }],
        footer:
          'When a passcode is set and Ring has been in the background longer than this, it asks for your passcode again on return. “Never” skips that on-return prompt — but fully closing and reopening Ring still asks for your passcode.',
      },
    ],
  },
  'privacy-advanced': {
    id: 'privacy-advanced',
    title: 'Advanced',
    groups: [
      {
        items: [{ type: 'toggle', title: 'Block unknown account messages', key: 'privacy.blockUnknown', default: false }],
        footer:
          'Block messages from people who aren’t in your contacts. They’ll need to send you a contact request first.',
      },
      {
        items: [{ type: 'toggle', title: 'Disable link previews', key: 'privacy.disableLinkPreviews', default: false }],
        footer:
          'To help protect your IP address from being inferred by third-party websites, previews for the links you share in chats will no longer be generated.',
      },
    ],
  },

  /* ===== CHATS ===== */
  chats: {
    id: 'chats',
    title: 'Chats',
    groups: [
      {
        items: [{ type: 'link', id: 'chats-animations', title: 'Animations', icon: 'palette' }],
        footer: 'Choose whether emoji and GIFs move automatically.',
      },
      {
        items: [{ type: 'toggle', title: 'Save to Photos', key: 'chats.saveToPhotos', default: false }],
        footer: 'Automatically save photos and videos you receive to your device.',
      },
      {
        items: [{ type: 'toggle', title: 'Keep chats archived', key: 'chats.keepArchived', default: false }],
        footer: 'Archived chats stay archived when a new message arrives. When off, a new message brings the chat back to your main list.',
      },
      {
        items: [
          { type: 'action', title: 'Archive all chats', action: 'archive-all' },
          { type: 'action', title: 'Clear all chats', action: 'clear-all-chats', danger: true, confirm: 'This clears the messages in every chat. This cannot be undone.' },
          { type: 'action', title: 'Delete all chats', action: 'delete-all-chats', danger: true, confirm: 'This permanently deletes every chat. This cannot be undone.' },
        ],
      },
    ],
  },
  'chats-animations': {
    id: 'chats-animations',
    title: 'Animations',
    groups: [
      {
        items: [
          { type: 'toggle', title: 'Emoji', key: 'chats.animEmoji', default: true },
          { type: 'toggle', title: 'GIFs', key: 'chats.animGifs', default: true },
        ],
        footer: 'When turned on, emoji and GIFs will move automatically. Emoji in a message play a few times when they scroll into view.',
      },
    ],
  },

  /* ===== CALLS ===== */
  calls: {
    id: 'calls',
    title: 'Calls',
    groups: [
      {
        items: [
          { type: 'route', title: 'Decline with message', path: '/settings/calls-declines', icon: 'chat' },
        ],
        footer: 'Customize the quick replies you can send when you decline a call.',
      },
    ],
  },

  /* ===== APPEARANCE ===== */
  appearance: {
    id: 'appearance',
    title: 'Appearance',
    groups: [
      { items: [{ type: 'link', id: 'appearance-theme', title: 'Theme', icon: 'palette' }] },
      {
        items: [{ type: 'link', id: 'chats-animations', title: 'Animations', icon: 'palette' }],
        footer: 'Choose whether emoji and GIFs move automatically.',
      },
    ],
  },
  'appearance-theme': {
    id: 'appearance-theme',
    title: 'Theme',
    groups: [
      {
        header: 'App theme',
        items: [
          {
            type: 'choice',
            key: 'appearance.theme',
            default: 'system',
            options: [
              { value: 'system', label: 'System default', note: 'Follow your device appearance' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ],
          },
        ],
      },
    ],
  },

  /* ===== NOTIFICATIONS ===== */
  notifications: {
    id: 'notifications',
    title: 'Notifications',
    groups: [
      {
        header: 'Message notifications',
        items: [
          { type: 'toggle', title: 'Show notifications', key: 'notifications.message.show', default: true },
          { type: 'link', id: 'notifications-message-sound', title: 'Sound', icon: 'music' },
          { type: 'toggle', title: 'Reaction notifications', key: 'notifications.message.reactions', default: true },
        ],
      },
      {
        header: 'Group notifications',
        items: [
          { type: 'toggle', title: 'Show notifications', key: 'notifications.group.show', default: true },
          { type: 'link', id: 'notifications-group-sound', title: 'Sound', icon: 'music' },
          { type: 'toggle', title: 'Reaction notifications', key: 'notifications.group.reactions', default: true },
        ],
      },
      {
        header: 'Wall notifications',
        items: [
          { type: 'toggle', title: 'Show notifications', key: 'notifications.wall.show', default: true },
        ],
        footer: 'Get notified when a friend shares a new post on their Wall.',
      },
      {
        header: 'Calls',
        items: [
          { type: 'toggle', title: 'In-call sounds', key: 'notifications.callSounds', default: true },
        ],
        footer: 'Subtle cues during a call — connecting, reconnecting, mute/unmute, camera on/off, and a quiet tone for a message that arrives while you’re on a call.',
      },
      {
        header: 'Home screen notifications',
        items: [{ type: 'link', id: 'notifications-badge', title: 'App icon badge', icon: 'bell' }],
      },
      { items: [{ type: 'link', id: 'notifications-inapp', title: 'In-app notifications', icon: 'bell' }] },
      {
        items: [{ type: 'toggle', title: 'Show preview', key: 'notifications.showPreview', default: true }],
        footer: 'Preview message text inside new message notifications.',
      },
    ],
  },
  'notifications-message-sound': {
    id: 'notifications-message-sound',
    title: 'Sound',
    groups: [{ header: 'Alert tones', items: [{ type: 'choice', key: 'notifications.message.sound', default: 'note', options: TONES }] }],
  },
  'notifications-group-sound': {
    id: 'notifications-group-sound',
    title: 'Sound',
    groups: [{ header: 'Alert tones', items: [{ type: 'choice', key: 'notifications.group.sound', default: 'note', options: TONES }] }],
  },
  'notifications-badge': {
    id: 'notifications-badge',
    title: 'App icon badge',
    groups: [
      {
        header: 'Select how the badge clears on the app icon on your home screen',
        items: [
          {
            type: 'choice',
            key: 'notifications.badge',
            default: 'open',
            options: [
              { value: 'view', label: 'When viewed', note: 'Clears when you view all messages and calls' },
              { value: 'open', label: 'When opened', note: 'Clears when you open the app' },
            ],
          },
        ],
      },
    ],
  },
  'notifications-inapp': {
    id: 'notifications-inapp',
    title: 'In-app notifications',
    groups: [
      {
        items: [{ type: 'toggle', title: 'In-app notifications', key: 'notifications.inapp.enabled', default: true }],
        footer: 'Master switch for banners that appear while Ring is open. When off, no in-app banner is shown for any chat — system (lock-screen) notifications and the app badge are unaffected.',
      },
      {
        header: 'Alert style',
        items: [
          {
            type: 'segment',
            key: 'notifications.inapp.style',
            default: 'banners',
            options: [
              { value: 'none', label: 'None' },
              { value: 'banners', label: 'Banners' },
              { value: 'alerts', label: 'Alerts' },
            ],
          },
        ],
        footer: 'Alerts require an action before proceeding. Banners appear below the header and go away automatically.',
      },
      {
        items: [
          { type: 'toggle', title: 'Sounds', key: 'notifications.inapp.sounds', default: false },
          { type: 'toggle', title: 'Vibrate', key: 'notifications.inapp.vibrate', default: true },
        ],
      },
    ],
  },

  /* ===== STORAGE AND DATA ===== */
  storage: {
    id: 'storage',
    title: 'Storage and data',
    groups: [
      { header: 'Storage', items: [{ type: 'route', title: 'Manage storage', path: '/settings/storage-manage', icon: 'server' }] },
      {
        header: 'Network',
        items: [
          { type: 'route', title: 'Network usage', path: '/settings/network-usage', icon: 'cellular' },
          { type: 'toggle', title: 'Use less data for calls', key: 'storage.lessDataCalls', default: false },
        ],
      },
      {
        header: 'Media quality',
        items: [
          { type: 'link', id: 'media-upload-quality', title: 'Upload quality', icon: 'image' },
          { type: 'link', id: 'media-download-quality', title: 'Auto-download quality', icon: 'download' },
        ],
      },
      {
        header: 'Media auto-download',
        items: [
          { type: 'link', id: 'storage-autodownload-photos', title: 'Photos', icon: 'image' },
          { type: 'link', id: 'storage-autodownload-audio', title: 'Audio', icon: 'music' },
          { type: 'link', id: 'storage-autodownload-video', title: 'Video', icon: 'video' },
          { type: 'link', id: 'storage-autodownload-documents', title: 'Documents', icon: 'document' },
          { type: 'action', title: 'Reset auto-download settings', action: 'reset-autodownload' },
        ],
        footer: 'Voice messages are always automatically downloaded.',
      },
    ],
  },
  'media-upload-quality': {
    id: 'media-upload-quality',
    title: 'Upload quality',
    groups: [
      {
        header: 'Quality',
        items: [{ type: 'choice', key: 'storage.uploadQuality', default: 'hd', options: QUALITY }],
        footer: 'Select the quality for photos and videos to be sent at in chats.',
      },
    ],
  },
  'media-download-quality': {
    id: 'media-download-quality',
    title: 'Auto-download quality',
    groups: [
      {
        header: 'Quality',
        items: [{ type: 'choice', key: 'storage.downloadQuality', default: 'hd', options: QUALITY }],
        footer: 'Select the quality for photos and videos to be automatically downloaded in.',
      },
    ],
  },
  'storage-autodownload-photos': {
    id: 'storage-autodownload-photos',
    title: 'Photos',
    groups: [{ items: [{ type: 'choice', key: 'storage.autoDownload.photos', default: 'wifi-cellular', options: AUTO_DOWNLOAD }] }],
  },
  'storage-autodownload-audio': {
    id: 'storage-autodownload-audio',
    title: 'Audio',
    groups: [{ items: [{ type: 'choice', key: 'storage.autoDownload.audio', default: 'wifi', options: AUTO_DOWNLOAD }] }],
  },
  'storage-autodownload-video': {
    id: 'storage-autodownload-video',
    title: 'Video',
    groups: [{ items: [{ type: 'choice', key: 'storage.autoDownload.video', default: 'wifi', options: AUTO_DOWNLOAD }] }],
  },
  'storage-autodownload-documents': {
    id: 'storage-autodownload-documents',
    title: 'Documents',
    groups: [{ items: [{ type: 'choice', key: 'storage.autoDownload.documents', default: 'wifi', options: AUTO_DOWNLOAD }] }],
  },

  /* ===== SUPPORT ===== */
  // Pay-what-you-want contribution links (spec 1021). Outbound links ONLY — the app
  // never touches money or payment data, so nothing new crosses the zero-knowledge
  // boundary. All handles are `zuptalo`. Honest + optional, never a nag.
  support: {
    id: 'support',
    title: 'Support Ring',
    groups: [
      {
        items: [
          {
            type: 'note',
            text:
              'Ring is free and open-source, with no paywall — donations are never required. ' +
              'If it’s useful to you, you can chip in whatever you think it’s worth to support its ' +
              'development. Thank you! 🙏',
          },
        ],
      },
      {
        header: 'Ways to contribute',
        items: [
          { type: 'external', title: 'Ko-fi', url: 'https://ko-fi.com/zuptalo', icon: 'cafe', note: 'Pay what you want' },
          { type: 'external', title: 'Liberapay', url: 'https://liberapay.com/zuptalo', icon: 'heart', note: 'Recurring' },
          { type: 'external', title: 'GitHub Sponsors', url: 'https://github.com/sponsors/zuptalo', icon: 'github', note: 'One-off or monthly' },
        ],
        footer: 'Each opens in your browser. Contributions are handled entirely by that platform — Ring never sees any payment details.',
      },
      {
        items: [{ type: 'action', title: 'Share Ring', action: 'share-support', icon: 'share' }],
      },
    ],
  },

  /* ===== HELP ===== */
  help: {
    id: 'help',
    title: 'Help',
    groups: [
      { items: [{ type: 'stat', title: 'Version', value: '0.1.0' }] },
      {
        header: 'Developer',
        items: [{ type: 'route', title: 'Run self-test', path: '/settings/selftest', icon: 'shield' }],
        footer: 'Runs the on-device encryption & sync checks in this browser.',
      },
    ],
  },
};

export function settingNode(id: string): SettingNode | undefined {
  return SETTINGS[id];
}

/**
 * Right-aligned summary for a `link` row: if the target node's first item is a
 * choice/segment, return the label of its currently-selected option. Lets hub
 * rows show "Nobody" / "My contacts" etc. without duplicating option lists.
 */
export function linkSummary(
  targetId: string,
  read: (key: string, fallback: string) => string,
): string | undefined {
  const node = SETTINGS[targetId];
  if (!node) return undefined;
  for (const group of node.groups) {
    for (const item of group.items) {
      if (item.type === 'choice' || item.type === 'segment') {
        const current = read(item.key, item.default);
        return item.options.find((o) => o.value === current)?.label;
      }
    }
  }
  return undefined;
}

/** Top-level hubs shown on the You tab, in order. */
export const YOU_SECTIONS: { id: string; title: string; icon: string }[] = [
  { id: 'account', title: 'Account', icon: 'key' },
  { id: 'privacy', title: 'Privacy', icon: 'lock' },
  { id: 'chats', title: 'Chats', icon: 'chat' },
  { id: 'calls', title: 'Calls', icon: 'call' },
  { id: 'appearance', title: 'Appearance', icon: 'palette' },
  { id: 'notifications', title: 'Notifications', icon: 'bell' },
  { id: 'storage', title: 'Storage and data', icon: 'download' },
  { id: 'support', title: 'Support Ring', icon: 'heart' },
  { id: 'help', title: 'Help', icon: 'help' },
  { id: 'about', title: 'About', icon: 'info' },
];

/* ---- flat search index over the whole tree ---- */

export interface SettingSearchResult {
  /** The matched screen or control. */
  title: string;
  /** Route to open (the destination screen, or the screen the control lives on). */
  path: string;
  /** Top-level section this sits under, shown as a breadcrumb under the title. */
  context?: string;
  icon?: string;
}

/**
 * Walk the tree from the You-tab hubs down, flattening every navigable screen
 * and every toggle/action into a searchable entry tagged with its hub. Built
 * once at module load; `searchSettings` just filters it.
 */
function buildSearchIndex(): SettingSearchResult[] {
  const out: SettingSearchResult[] = [];
  const seen = new Set<string>();
  const add = (title: string, path: string, context?: string, icon?: string) => {
    const key = `${path}|${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title, path, context, icon });
  };
  const visit = (nodeId: string, hub: string) => {
    const node = SETTINGS[nodeId];
    if (!node) return;
    for (const group of node.groups) {
      for (const item of group.items) {
        if (item.type === 'link') {
          add(item.title, `/settings/${item.id}`, hub, item.icon);
          visit(item.id, hub);
        } else if (item.type === 'route') {
          add(item.title, item.path, hub, item.icon);
        } else if (item.type === 'toggle' || item.type === 'action' || item.type === 'external') {
          add(item.title, `/settings/${node.id}`, hub, item.icon);
        }
      }
    }
  };
  for (const sec of YOU_SECTIONS) {
    add(sec.title, `/settings/${sec.id}`, undefined, sec.icon);
    visit(sec.id, sec.title);
  }
  return out;
}

const SETTINGS_INDEX = buildSearchIndex();

/** Case-insensitive search across every settings screen and control. */
export function searchSettings(query: string): SettingSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_INDEX.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      (e.context ? e.context.toLowerCase().includes(q) : false),
  );
}
