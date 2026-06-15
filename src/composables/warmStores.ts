/**
 * Shared, warm in-memory stores for the data a bottom tab needs the instant it
 * mounts: the user's own profile (name/about/avatar) and the default chat / call /
 * contact lists. Tab pages read these so their FIRST paint is already populated —
 * no empty-then-filled flicker, no "You"/initials placeholder swap on Settings.
 *
 * Why a singleton (not a per-mount `useLiveQuery`): the existing composables start
 * cold (`[]` / "You") and resolve asynchronously after the page is already on
 * screen, which is exactly the pop-in this feature removes. Warming once at unlock
 * means the values are ready before the user can navigate (see spec 1001).
 *
 * Zero-knowledge (Constitution Principle I, spec FR-ZK-1..7): every value here is
 * DECRYPTED PLAINTEXT and therefore lives ONLY in process memory. It is read via
 * the existing `getSecret` / query paths, never persisted to any clear medium, and
 * is wiped by `clearWarm()` on every session-end (lock / sign-out / account
 * removal — all of which flip `isUnlocked` to false). A failed/aborted unlock never
 * warms; a list query that throws mid-warm leaves its store cold rather than
 * caching a partial value.
 */
import { ref, type Ref } from 'vue';
import { subscribe } from '@/db/idb';
import { getSecret } from '@/db/secrets';
import { isUnlocked } from '@/services/crypto/identity';
import { getSelfUsername } from '@/services/auth';
import { capitalizeFirst } from '@/utils/text';
import { listChats, listCallGroups, listContacts, type CallGroup } from '@/db/queries';
import type { Chat, Contact } from '@/db/types';

const DEFAULT_ABOUT = 'Hey there! I am using Ring.';
/** Cold/fallback display name: the immutable @username, then "You". Mirrors
 *  `useSelfProfile`'s fallback so a locked or empty profile still shows a name. */
function fallbackName(): string {
  return capitalizeFirst(getSelfUsername() ?? 'You');
}

// --- Own profile (singleton refs; the computed avatar is composed in useSelfProfile) ---
export const profileName = ref(fallbackName());
export const profileAbout = ref(DEFAULT_ABOUT);
export const profileAvatarRaw = ref('');
export const profileWarmed = ref(false);

// --- Default (unfiltered) lists. `*Loaded` gates empty states like useLiveQuery.loaded ---
export const warmChats = ref<Chat[]>([]);
export const warmChatsLoaded = ref(false);
export const warmCalls = ref<CallGroup[]>([]);
export const warmCallsLoaded = ref(false);
export const warmContacts = ref<Contact[]>([]);
export const warmContactsLoaded = ref(false);

let unsubs: Array<() => void> = [];

/** Re-read own profile. Profile reads go through `getSecret`, which returns the
 *  fallback (never throws) when absent/locked, so this is safe to call any time
 *  we're unlocked; `warmed` flips true once we've populated it at least once. */
async function refreshProfile(): Promise<void> {
  if (!isUnlocked.value) return;
  const [name, about, avatar] = await Promise.all([
    getSecret('profileName', fallbackName()),
    getSecret('profileAbout', DEFAULT_ABOUT),
    getSecret('profileAvatar', ''),
  ]);
  profileName.value = name;
  profileAbout.value = about;
  profileAvatarRaw.value = avatar;
  profileWarmed.value = true;
}

// Each list refresh guards on unlock and leaves the store COLD on failure
// (FR-ZK-4): no partial/stale plaintext is cached if the query throws.
async function refreshChats(): Promise<void> {
  if (!isUnlocked.value) return;
  try {
    warmChats.value = await listChats();
    warmChatsLoaded.value = true;
  } catch { /* stay cold */ }
}
async function refreshCalls(): Promise<void> {
  if (!isUnlocked.value) return;
  try {
    warmCalls.value = await listCallGroups();
    warmCallsLoaded.value = true;
  } catch { /* stay cold */ }
}
async function refreshContacts(): Promise<void> {
  if (!isUnlocked.value) return;
  try {
    warmContacts.value = await listContacts();
    warmContactsLoaded.value = true;
  } catch { /* stay cold */ }
}

/**
 * Populate every warm store and keep them live via the idb change bus. Idempotent:
 * a second call while already warm is a no-op (subscriptions are only wired once).
 * Only does work while unlocked, so a failed/aborted unlock never warms (FR-ZK-4).
 */
export async function warmAll(): Promise<void> {
  if (!isUnlocked.value) return;
  if (unsubs.length) return; // already warm + subscribed
  // Same store sets the existing tab queries depend on, so live edits propagate.
  unsubs.push(subscribe(['settings'], () => void refreshProfile()));
  unsubs.push(subscribe(['chats', 'messages', 'chatlists'], () => void refreshChats()));
  unsubs.push(subscribe(['calls'], () => void refreshCalls()));
  unsubs.push(subscribe(['contacts', 'chats'], () => void refreshContacts()));
  await Promise.all([refreshProfile(), refreshChats(), refreshCalls(), refreshContacts()]);
}

/**
 * Drop all decrypted plaintext from memory and unsubscribe. Called on every
 * session-end transition (lock / sign-out / account removal). Every ref returns
 * to its cold initial value — this is the verifiable "no residue" evidence
 * (FR-ZK-2/FR-ZK-3, SC-006).
 */
export function clearWarm(): void {
  for (const u of unsubs) u();
  unsubs = [];
  profileName.value = fallbackName();
  profileAbout.value = DEFAULT_ABOUT;
  profileAvatarRaw.value = '';
  profileWarmed.value = false;
  warmChats.value = [];
  warmChatsLoaded.value = false;
  warmCalls.value = [];
  warmCallsLoaded.value = false;
  warmContacts.value = [];
  warmContactsLoaded.value = false;
}

/** Warm-source helper for `useLiveQuery`: return the warm value only when the
 *  search box is empty (the first-paint case). A typed term falls back to the
 *  live query so data-layer filtering stays where it is (spec "Search contract"). */
export function warmWhenIdle<T>(source: Ref<T>, search: Ref<string>): () => T | undefined {
  return () => (search.value ? undefined : source.value);
}
