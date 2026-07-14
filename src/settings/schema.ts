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
const QUALITY: ChoiceOption[] = [
  { value: 'standard', label: 'Standard quality', note: 'Faster to send, smaller file size' },
  { value: 'hd', label: 'HD quality', note: 'Slower to send, can be 6 times larger' },
];
// Upload-quality tiers (the actual send tiers). A source below a tier is never upscaled — it just
// sends at its own resolution — so a high setting is safe. Original keeps full fidelity.
const UPLOAD_QUALITY: ChoiceOption[] = [
  { value: 'original', label: 'Original', note: 'Full quality, largest file' },
  { value: 'fhd', label: 'Full HD (1080p)' },
  { value: 'hd', label: 'HD (720p)' },
  { value: 'sd', label: 'SD', note: 'Smaller, fastest to send' },
];
// Auto-download size cap (MB, as strings for the choice store; '0' = no limit).
const SIZE_LIMIT: ChoiceOption[] = [
  { value: '2', label: '2 MB' },
  { value: '8', label: '8 MB' },
  { value: '16', label: '16 MB' },
  { value: '50', label: '50 MB' },
  { value: '100', label: '100 MB' },
  { value: '0', label: 'No limit' },
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
        items: [{ type: 'toggle', title: 'Disable link previews', key: 'privacy.disableLinkPreviews', default: false }],
        footer:
          'When this is on, Ring stops making previews for the links you share, so those sites cannot get a peek at your IP address.',
      },
      {
        items: [{ type: 'toggle', title: 'Always relay calls', key: 'privacy.relayCalls', default: false }],
        footer:
          'Route your calls through the Ring server so people you call never see your IP address. Calls may connect slower and quality may be lower. Applies from your next call.',
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
          'Hide chats behind a separate PIN. A hidden chat is removed from your chat list, search, calls, and notification previews until you type the PIN into the chat search bar. Hiding stays on this device only, and it never leaves your phone.',
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
              'This permanently deletes every hidden chat on this device and cannot be undone. They will not come back from the server. Continue?',
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
  // Spec 1052: the old "Who can add me to groups" chooser was a placebo — pickers
  // are contacts-only and contacts are mutual, so its "Everyone" tier described an
  // adder that cannot exist. Replaced by one honest, enforced control.
  'privacy-groups': {
    id: 'privacy-groups',
    title: 'Groups',
    groups: [
      {
        items: [{ type: 'toggle', title: 'Ask before adding me to groups', key: 'privacy.groupAddApproval', default: false }],
        footer:
          'When this is on, joining a group always starts as an invitation you can accept or decline. People you have not connected with can never add you directly, no matter how this is set.',
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
          'When a passcode is set and Ring has been in the background longer than this, it asks for your passcode again on return. “Never” skips that prompt on return, but fully closing and reopening Ring still asks for your passcode.',
      },
    ],
  },
  /* ===== CHATS ===== */
  chats: {
    id: 'chats',
    title: 'Chats',
    groups: [
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
      {
        header: 'Emoji profile pictures',
        items: [
          {
            type: 'choice',
            title: 'Play',
            key: 'chats.avatarLoops',
            default: 'twice',
            options: [
              { value: 'once', label: 'Once' },
              { value: 'twice', label: 'Twice' },
              { value: 'thrice', label: 'Three times' },
              { value: 'forever', label: 'Keep looping' },
            ],
          },
          { type: 'toggle', title: 'Keep animating for unread chats', key: 'chats.avatarUnreadLoop', default: true },
        ],
        footer:
          'How an emoji profile picture moves. After its plays it settles on the first frame of the animation. In your chats list, a chat with unread messages keeps its picture moving until you have read them.',
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
        // Reactions get their OWN tone (spec 1048): the on/off gates live per surface
        // above (message/group "Reaction notifications"), but the sound is one shared,
        // deliberately subtler choice so a burst of hearts never sounds like a burst
        // of messages. "None" keeps reaction alerts visible but silent.
        header: 'Reactions',
        items: [{ type: 'link', id: 'notifications-reactions-sound', title: 'Sound', icon: 'music' }],
        footer: 'Reactions to your messages play their own tone. Pick None to keep them quiet.',
      },
      {
        header: 'Wall notifications',
        items: [
          { type: 'toggle', title: 'Show notifications', key: 'notifications.wall.show', default: true },
          { type: 'toggle', title: 'Activity on your posts', key: 'notifications.wall.activity', default: true },
        ],
        footer: 'Get notified when a friend shares a new post on their Wall, and when someone reacts to or comments on your posts.',
      },
      {
        header: 'Calls',
        items: [
          { type: 'toggle', title: 'In-call sounds', key: 'notifications.callSounds', default: true },
        ],
        footer: 'Subtle cues during a call, like connecting, reconnecting, mute and unmute, camera on and off, and a quiet tone for a message that arrives while you’re on a call.',
      },
      {
        header: 'Games',
        items: [
          { type: 'toggle', title: 'Your turn', key: 'notifications.games.turn', default: true },
          { type: 'toggle', title: 'New challenges', key: 'notifications.games.challenges', default: true },
          { type: 'toggle', title: 'Followed games, moves', key: 'notifications.games.followMoves', default: true },
          { type: 'toggle', title: 'Game results', key: 'notifications.games.followResults', default: true },
          { type: 'toggle', title: 'Game sounds', key: 'notifications.gameSounds', default: true },
        ],
        footer:
          'Alerts when it is your move, when someone answers your challenge, and for games you follow as a spectator. Sounds cover a game chat you have open: a match starting, each move landing, and the result.',
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
  // Reaction alert tone (spec 1048). Default 'pop' — subtle and distinct from the
  // message default 'note', so a reaction never masquerades as a new message.
  'notifications-reactions-sound': {
    id: 'notifications-reactions-sound',
    title: 'Sound',
    groups: [{ header: 'Alert tones', items: [{ type: 'choice', key: 'notifications.reactions.sound', default: 'pop', options: TONES }] }],
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
        footer: 'Master switch for banners that appear while Ring is open. When off, no in-app banner is shown for any chat. System (lock-screen) notifications and the app badge are unaffected.',
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
          { type: 'toggle', title: 'Sounds', key: 'notifications.inapp.sounds', default: true },
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
        ],
      },
      {
        header: 'Media auto-download',
        items: [
          { type: 'link', id: 'media-download-limit', title: 'Auto-download size limit', icon: 'download' },
          { type: 'link', id: 'storage-autodownload-photos', title: 'Photos', icon: 'image' },
          { type: 'link', id: 'storage-autodownload-audio', title: 'Audio', icon: 'music' },
          { type: 'link', id: 'storage-autodownload-video', title: 'Video', icon: 'video' },
          { type: 'link', id: 'storage-autodownload-documents', title: 'Documents', icon: 'document' },
          { type: 'action', title: 'Reset auto-download settings', action: 'reset-autodownload', confirm: 'This puts every download choice back to the way it started.' },
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
        header: 'Photos',
        items: [{ type: 'choice', key: 'storage.uploadQuality.photos', default: 'hd', options: UPLOAD_QUALITY }],
      },
      {
        header: 'Videos',
        items: [{ type: 'choice', key: 'storage.uploadQuality.videos', default: 'hd', options: UPLOAD_QUALITY }],
        footer: 'Photos and videos each send at their own quality. A chat can override this in its info menu.',
      },
    ],
  },
  'media-download-limit': {
    id: 'media-download-limit',
    title: 'Auto-download size limit',
    groups: [
      {
        header: 'Limit',
        items: [{ type: 'choice', key: 'storage.autoDownloadLimit', default: '16', options: SIZE_LIMIT }],
        footer:
          'Attachments larger than this are left for you to download with a tap, even where auto-download is on. Voice messages always download.',
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

  /* ===== HELP ===== */
  // A small set of plain-language how-tos, each its own schema node rendered as
  // static `note` paragraphs. The version lives on the About page (which styles it
  // properly), so Help no longer duplicates it. The Developer group keeps the
  // on-device self-test.
  help: {
    id: 'help',
    title: 'Help',
    groups: [
      {
        header: 'How Ring works',
        items: [
          { type: 'link', id: 'help-privacy', title: 'How Ring keeps chats private', icon: 'lock' },
          { type: 'link', id: 'help-getting-started', title: 'Getting started', icon: 'person' },
          { type: 'link', id: 'help-contacts', title: 'Adding people', icon: 'people' },
          { type: 'link', id: 'help-chats', title: 'Chats and groups', icon: 'chat' },
          { type: 'link', id: 'help-disappearing', title: 'Disappearing messages', icon: 'time' },
          { type: 'link', id: 'help-hidden', title: 'Hidden chats and app lock', icon: 'eyeOff' },
          { type: 'link', id: 'help-calls', title: 'Voice and video calls', icon: 'call' },
          { type: 'link', id: 'help-recovery', title: 'Your recovery key', icon: 'key' },
        ],
      },
      {
        header: 'Developer',
        items: [{ type: 'route', title: 'Run self-test', path: '/settings/selftest', icon: 'shield' }],
        footer: 'Runs the encryption and sync checks right here in your browser.',
      },
    ],
  },
  'help-privacy': {
    id: 'help-privacy',
    title: 'How Ring keeps chats private',
    groups: [
      {
        items: [
          { type: 'note', text: 'Ring is end-to-end encrypted. Your messages, calls and keys are scrambled on your device, and only the person you are talking to can open them.' },
          { type: 'note', text: 'The server just passes sealed data along. It never sees your messages, media, contacts or profile, so nobody in the middle can read your stuff.' },
          { type: 'note', text: 'There is no phone number and no ads, and you only get in by invitation.' },
        ],
      },
      {
        header: 'What you control',
        items: [
          { type: 'note', text: 'Head into Privacy to choose who sees your last seen, online status, profile photo and about. You can pick everyone, just your contacts, or nobody.' },
          { type: 'note', text: 'Seen receipts and typing indicators go both ways. Turn them off and you stop sharing them, and you stop seeing other people’s too.' },
          { type: 'note', text: 'You can also switch off link previews so the sites you link to cannot get a peek at your IP address.' },
        ],
      },
    ],
  },
  'help-getting-started': {
    id: 'help-getting-started',
    title: 'Getting started',
    groups: [
      {
        header: 'Joining',
        items: [
          { type: 'note', text: 'Ring is invite only. On the welcome screen tap Have Invitation Code and type in the code a friend gave you.' },
          { type: 'note', text: 'Pick a username you like. It stays with you and cannot be changed later, so go with something you are happy with.' },
          { type: 'note', text: 'You will see a recovery key once. Save it somewhere safe before you carry on, because it is your only way back in if you lose this device.' },
          { type: 'note', text: 'Then set your name and photo, and if you want, allow notifications so you hear about new messages and calls.' },
        ],
      },
      {
        header: 'Already have an account?',
        items: [
          { type: 'note', text: 'On a new device, tap Have Recovery Key on the welcome screen and enter the key you saved to bring your account back.' },
        ],
      },
    ],
  },
  'help-contacts': {
    id: 'help-contacts',
    title: 'Adding people',
    groups: [
      {
        items: [
          { type: 'note', text: 'In the Contacts tab, tap the plus button. From there you can invite someone, scan a friend’s QR code, show your own, or browse the directory.' },
          { type: 'note', text: 'Invite someone by giving the invite a nickname so you remember who it is for, then share the link and code. When they join with it, the two of you connect on your own, no accepting needed.' },
          { type: 'note', text: 'To use a QR code, tap Show my QR code for someone to scan, or Scan a friend’s QR to add them. Your username and full ID are right there to copy too.' },
          { type: 'note', text: 'Sent invites show up under Invited with a countdown, and you can extend or cancel them from the three dots menu.' },
        ],
      },
      {
        header: 'Requests and blocking',
        items: [
          { type: 'note', text: 'Only people you have connected with can message you, so add someone before you start chatting. Friend requests show up with Accept or Decline, you can swipe a contact to delete them, and anyone you block sits at the bottom of the list.' },
        ],
      },
    ],
  },
  'help-chats': {
    id: 'help-chats',
    title: 'Chats and groups',
    groups: [
      {
        header: 'Direct chats',
        items: [
          { type: 'note', text: 'In the Chats tab, tap the compose button at the top and pick a contact to start a direct chat. Tapping a friend in Contacts opens the same chat.' },
        ],
      },
      {
        header: 'Groups',
        items: [
          { type: 'note', text: 'Start a group from the compose menu or the plus menu in Contacts. Give it a name if you like, tap the people to add, then hit Create.' },
          { type: 'note', text: 'Open Group info any time to change the name or photo, add more people, see who is in it, remove someone, or leave.' },
        ],
      },
      {
        header: 'Reactions and replies',
        items: [
          { type: 'note', text: 'Tap the reaction button on a message for quick emoji, or press and hold a message for reply, forward, edit and more.' },
        ],
      },
    ],
  },
  'help-disappearing': {
    id: 'help-disappearing',
    title: 'Disappearing messages',
    groups: [
      {
        items: [
          { type: 'note', text: 'Disappearing messages delete themselves for everyone after a set time, and they show a little clock with how long is left.' },
          { type: 'note', text: 'For a whole chat, open the chat or group info and set Disappearing messages. Pick 24 hours, 7 days, 90 days, or off, and it covers new messages from everyone there.' },
          { type: 'note', text: 'For just your next message, tap the clock in the composer. It turns green when what you send will disappear.' },
          { type: 'note', text: 'To start new chats this way by default, set a timer under Privacy, in Default message timer. It only touches new direct chats, not the ones you already have.' },
        ],
      },
    ],
  },
  'help-hidden': {
    id: 'help-hidden',
    title: 'Hidden chats and app lock',
    groups: [
      {
        header: 'Hidden chats',
        items: [
          { type: 'note', text: 'A hidden chat drops out of your chat list, search, calls and notification previews, and you open it with its own PIN.' },
          { type: 'note', text: 'Turn it on under Privacy, in Hidden chats, and set a PIN. Then swipe a conversation, tap More, and hide it. There is no button for making a brand new hidden chat on purpose.' },
          { type: 'note', text: 'To bring them back, type your hidden chats PIN into the search bar at the top of Chats. Hiding stays on this device and never leaves your phone.' },
          { type: 'note', text: 'Forgot the PIN? Reset PIN and delete hidden chats is your only way out, and it wipes those chats on this device for good.' },
        ],
      },
      {
        header: 'App lock',
        items: [
          { type: 'note', text: 'Turn on App lock under Privacy to ask for a passcode every time you open Ring. You can set how long Ring waits before it asks again.' },
          { type: 'note', text: 'With app lock on, notifications in the background only say New message instead of showing a preview.' },
        ],
      },
    ],
  },
  'help-calls': {
    id: 'help-calls',
    title: 'Voice and video calls',
    groups: [
      {
        items: [
          { type: 'note', text: 'Start a call from a chat with the video or phone button at the top. Tapping a call in your history dials the same kind again.' },
          { type: 'note', text: 'While you are on a call you can mute, turn the camera on or off, switch where the sound comes out, and hang up. You can move an audio call up to video too, and the other side gets asked first.' },
          { type: 'note', text: 'Group calls ring everyone, up to 8 people on audio and 4 on video.' },
          { type: 'note', text: 'Calls are end-to-end encrypted. The sound and video go straight between devices, and no server ever sees or hears them.' },
        ],
      },
    ],
  },
  'help-recovery': {
    id: 'help-recovery',
    title: 'Your recovery key',
    groups: [
      {
        items: [
          { type: 'note', text: 'Your recovery key is a one time code you get when you sign up. It is the only way to bring your account back on a new device.' },
          { type: 'note', text: 'Nobody can get it back for you, not even Ring, so keep it somewhere safe and private.' },
          { type: 'note', text: 'To restore, tap Have Recovery Key on the welcome screen and type in the code.' },
          { type: 'note', text: 'You can make a new one under Account, in Recovery key, then Generate new recovery key. The old one stops working right away, so do this if you think it might have leaked.' },
        ],
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
        } else if (item.type === 'toggle' || item.type === 'action') {
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
