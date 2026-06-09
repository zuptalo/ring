/**
 * Reactive access to the local user's OWN chosen profile name + avatar, for every
 * place the user is shown to themselves (call tiles, group member lists, reply quotes,
 * media captions, …). Both are encrypted-at-rest secrets, so we read them through
 * `useLiveQuery` over the `settings` store: the value re-resolves when the keystore
 * unlocks and updates live when the user edits their profile (Profile/Settings write
 * the same secret), so a rename propagates everywhere without a reload.
 *
 * Name falls back to the immutable @username (then "You") while the profile is empty or
 * the store is still locked; the avatar falls back to a generated initials avatar so a
 * face is always shown.
 */
import { computed, type Ref } from 'vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { getSecret } from '@/db/secrets';
import { getSelfUsername } from '@/services/auth';
import { isUnlocked } from '@/services/crypto/identity';
import { initialsAvatar } from '@/db/avatars';

export function useSelfProfile(): { name: Ref<string>; avatar: Ref<string> } {
  const fallbackName = getSelfUsername() ?? 'You';
  const name = useLiveQuery(
    () => getSecret('profileName', fallbackName),
    ['settings'],
    fallbackName,
    () => isUnlocked.value,
  );
  const rawAvatar = useLiveQuery(
    () => getSecret('profileAvatar', ''),
    ['settings'],
    '',
    () => isUnlocked.value,
  );
  const avatar = computed(() => rawAvatar.value || initialsAvatar(name.value));
  return { name, avatar };
}
