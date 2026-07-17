/**
 * Reactive access to the local user's OWN chosen profile name + avatar (+ about),
 * for every place the user is shown to themselves (Settings header, call tiles,
 * group member lists, reply quotes, media captions, …).
 *
 * Backed by the shared, warm singleton in `warmStores` rather than a fresh
 * per-call query: the singleton is decrypted once when the keystore unlocks and
 * kept live via the `settings` change bus, so every consumer shows the REAL
 * identity from its first paint — no "You"/initials placeholder that swaps to the
 * real photo/name a moment later (spec 1001 FR-005/FR-ZK-6). The decrypted values
 * live in memory only.
 *
 * Name falls back to the immutable @username (then "You") while the profile is
 * empty or the keystore is locked; the avatar falls back to a generated initials
 * avatar so a face is always shown.
 */
import { computed, type Ref } from 'vue';
import { profileName, profileAbout, profileAvatarRaw } from '@/composables/warmStores';
import { initialsAvatar } from '@/db/avatars';

export function useSelfProfile(): { name: Ref<string>; avatar: Ref<string>; about: Ref<string> } {
  const avatar = computed(() => profileAvatarRaw.value || initialsAvatar(profileName.value));
  return { name: profileName, avatar, about: profileAbout };
}
