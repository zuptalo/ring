/**
 * Reactive Appearance → Animations preferences (server-synced via ownsync).
 * `animEmoji` gates emoji animation in messages/reactions; `animGifs` gates GIF
 * autoplay. Both default on.
 */
import type { Ref } from 'vue';
import { getSetting } from '@/db/queries';
import { useLiveQuery } from '@/composables/useLiveQuery';

export function useAnimationPrefs(): { animEmoji: Ref<boolean>; animGifs: Ref<boolean> } {
  const animEmoji = useLiveQuery(() => getSetting('chats.animEmoji', true), ['settings'], true);
  const animGifs = useLiveQuery(() => getSetting('chats.animGifs', true), ['settings'], true);
  return { animEmoji, animGifs };
}
