/**
 * Reactive Appearance → Animations preferences (server-synced via ownsync).
 * `animEmoji` gates emoji animation in messages/reactions; `animGifs` gates GIF
 * autoplay; `avatarLoops`/`avatarUnreadLoop` shape how emoji profile pictures
 * animate (spec 0008 FR-028). All default on / 'twice'.
 */
import type { Ref } from 'vue';
import { getSetting } from '@/db/queries';
import { useLiveQuery } from '@/composables/useLiveQuery';

export function useAnimationPrefs(): {
  animEmoji: Ref<boolean>;
  animGifs: Ref<boolean>;
  avatarLoops: Ref<string>;
  avatarUnreadLoop: Ref<boolean>;
} {
  const animEmoji = useLiveQuery(() => getSetting('chats.animEmoji', true), ['settings'], true);
  const animGifs = useLiveQuery(() => getSetting('chats.animGifs', true), ['settings'], true);
  const avatarLoops = useLiveQuery(() => getSetting('chats.avatarLoops', 'twice'), ['settings'], 'twice');
  const avatarUnreadLoop = useLiveQuery(() => getSetting('chats.avatarUnreadLoop', true), ['settings'], true);
  return { animEmoji, animGifs, avatarLoops, avatarUnreadLoop };
}

// The pure resolution rule lives in utils/avatar-animation.ts (import-clean,
// unit-tested); re-exported here so avatar surfaces get prefs + rule together.
export { resolveAvatarAnimation, type AvatarAnimation } from '@/utils/avatar-animation';
