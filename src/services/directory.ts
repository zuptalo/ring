/**
 * Public in-network directory → local contacts.
 *
 * The network is invite-only, but inside it every member is discoverable. This
 * service reads the server directory (GET /v1/users) and mirrors a member's
 * PROFILE (display name, avatar, About, username) into the local `contacts` store.
 * It does NOT make them a friend: friendship is established only via the
 * request/accept flow (spec 0002), which is what the server consent gate enforces
 * (you can't fetch a non-connected peer's key bundle). Mirroring a profile never
 * overrides local block/ghost state, and Block stays the only barrier.
 */
import {
  fetchDirectory,
  fetchDirectoryUser,
  updateDirectoryProfile,
  putContactEdges,
  type DirectoryUser,
} from './api';
import { getSelfUserId } from './auth';
import { get, put } from '@/db/idb';
import { isPeerBlocked, getSetting, downscaleAvatar, listContacts, updateContactProfile } from '@/db/queries';
import { hasTombstone, clearTombstone } from '@/db/tombstones';
import { getSecret } from '@/db/secrets';
import { isUnlockedNow } from '@/services/crypto/identity';
import { initialsAvatar } from '@/db/avatars';
import type { Contact } from '@/db/types';

/** Mirror one directory profile into a local auto-connected contact. Preserves a
 *  blocked/ghosted contact's local state and never resurrects them. */
export async function upsertDirectoryContact(u: DirectoryUser): Promise<void> {
  const self = getSelfUserId();
  if (!self || u.id === self || !u.id) return;
  // Never pull a blocked peer back into the contact list from the directory (the
  // server already hides mutual blocks, but a one-directional block we set should
  // also win locally).
  if (await isPeerBlocked(u.id)) return;
  // Never resurrect a contact the user deleted. `syncDirectory`/`refreshContactProfiles`
  // mirror EVERY directory member into contacts on each connect, so without this a
  // deleted contact silently reappears on the next sync. The tombstone is absolute
  // here (see `hasTombstone`); an explicit re-add lifts it via `importDirectoryUser`.
  if (await hasTombstone('contacts', u.id)) return;
  const existing = await get<Contact>('contacts', u.id);
  if (existing?.ghosted || existing?.blocked) return;

  const name = (u.displayName || u.username || '').trim() || u.id.slice(0, 8);
  const avatar = u.avatar || existing?.avatar || initialsAvatar(name);
  const about = u.about ?? existing?.about ?? '';

  if (!existing) {
    // New contact: apply the directory profile directly (nothing to prompt about yet).
    // Mirror the PROFILE only — this does not make them a friend (set by the accept flow).
    await put('contacts', {
      id: u.id,
      name,
      username: u.username,
      avatar,
      phone: '',
      about,
      remoteName: name,
      remoteAvatar: avatar,
      updatedAt: u.profileAt || Date.now(),
    });
    return;
  }

  // Existing contact: update the directory-owned, non-prompting fields (username/about)
  // directly; route the DISPLAY name/avatar through updateContactProfile so a real change
  // is staged for the user's adopt/dismiss decision and any local override is preserved.
  if (existing.username !== u.username || (existing.about ?? '') !== about) {
    existing.username = u.username;
    existing.about = about;
    existing.updatedAt = u.profileAt || Date.now();
    await put('contacts', existing);
  }
  await updateContactProfile(u.id, name, avatar);
}

/**
 * Drop a contact's local name/photo override and re-pull their CURRENT profile from the
 * directory, applying it DIRECTLY (no adopt prompt) — what "Reset to their name & photo"
 * does. Falls back to the last-known remote values offline (handled by the queries layer
 * before this runs). Best-effort: a network failure leaves the optimistic revert in place.
 */
export async function refetchContactProfile(id: string): Promise<void> {
  try {
    const u = await fetchDirectoryUser(id);
    if (!u) return;
    const name = (u.displayName || u.username || '').trim();
    const avatar = u.avatar || '';
    await updateContactProfile(id, name, avatar, true); // force-apply the server's current profile
  } catch {
    /* offline / not found → keep the optimistic local revert the caller already applied */
  }
}

/** Pull the whole directory and mirror it into contacts. Paged; best-effort
 *  (network errors abort quietly and retry on the next connect/poll). Runs only
 *  when unlocked (it writes the keystore-independent contacts store, but we gate
 *  to avoid churning during the locked window). */
export async function syncDirectory(): Promise<void> {
  if (!getSelfUserId()) return;
  let cursor = '';
  for (let page = 0; page < 100; page++) {
    let res: Awaited<ReturnType<typeof fetchDirectory>>;
    try {
      res = await fetchDirectory({ cursor, limit: 200 });
    } catch {
      return; // retried on the next connect/poll
    }
    for (const u of res.users) await upsertDirectoryContact(u);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
}

/** Publish our own profile (display name, avatar thumbnail, About) to the
 *  directory so every member sees it. Client-enforces the privacy tiers the
 *  zero-knowledge server can't: a 'nobody' photo/About is sent as '' (stored
 *  NULL → omitted from the directory). Requires the keystore unlocked (the
 *  profile fields are encrypted at rest); a no-op otherwise. Best-effort. */
export async function publishOwnProfile(): Promise<void> {
  if (!getSelfUserId() || !isUnlockedNow()) return;
  const [name, about, photo, photoTier, aboutTier] = await Promise.all([
    getSecret('profileName', 'You'),
    getSecret('profileAbout', ''),
    getSecret('profileAvatar', ''),
    getSetting<string>('privacy.profilePhoto', 'everyone'),
    getSetting<string>('privacy.about', 'everyone'),
  ]);
  const avatar = photoTier === 'nobody' || !photo ? '' : await downscaleAvatar(photo);
  try {
    await updateDirectoryProfile({
      displayName: name.trim() || 'You',
      avatar,
      about: aboutTier === 'nobody' ? '' : about.trim(),
    });
  } catch {
    /* retried on the next connect/profile edit */
  }
}

/** Refresh our existing contacts' display name / avatar / About / username from
 *  the directory (the directory is the source of truth for OTHER members' profile
 *  fields). Replaces the old peer-to-peer "share my name & photo" card. Skips
 *  ghosted/blocked contacts; best-effort. Runs on connect. */
export async function refreshContactProfiles(): Promise<void> {
  if (!getSelfUserId()) return;
  let contacts;
  try {
    contacts = await listContacts();
  } catch {
    return;
  }
  for (const c of contacts) {
    if (c.ghosted) continue;
    try {
      if (await isPeerBlocked(c.id)) continue;
      const u = await fetchDirectoryUser(c.id);
      if (u) await upsertDirectoryContact(u);
    } catch {
      /* skip this one; retried next connect */
    }
  }
}

/** Push our curated contact ids to the server (the presence audience for the
 *  'contacts' tier). Reconciles the full set; blocked peers are excluded.
 *  Best-effort, retried on the next connect / contacts change. */
export async function syncContactEdges(): Promise<void> {
  if (!getSelfUserId()) return;
  try {
    const contacts = await listContacts();
    const ids: string[] = [];
    for (const c of contacts) {
      if (c.ghosted) continue;
      if (await isPeerBlocked(c.id)) continue;
      ids.push(c.id);
    }
    await putContactEdges(ids);
  } catch {
    /* retried on the next connect / contacts change */
  }
}

/** Live server-side search of the directory by username/display name (for an
 *  explicit "find people" box). Returns [] on failure. */
export async function searchDirectory(q: string): Promise<DirectoryUser[]> {
  const query = q.trim();
  if (!query) return [];
  try {
    const { users } = await fetchDirectory({ q: query, limit: 50 });
    return users;
  } catch {
    return [];
  }
}

/** Fetch and mirror one member by id (e.g. before starting a chat with someone
 *  surfaced by search). Returns the local contact id (== userId) or null. */
export async function importDirectoryUser(userId: string): Promise<string | null> {
  try {
    const u = await fetchDirectoryUser(userId);
    if (!u) return null;
    // Intentional add/re-add: lift any prior delete tombstone FIRST, otherwise the
    // `hasTombstone` guard in upsertDirectoryContact would keep skipping the re-add.
    await clearTombstone('contacts', userId);
    await upsertDirectoryContact(u);
    // Stamp the restored record as fresh so it out-dates the deletion: own-data sync
    // pushes it back as alive (winning last-write-wins over the server's tombstone
    // record), so a later pull can't silently re-delete the contact we just re-added.
    const c = await get<Contact>('contacts', u.id);
    if (c) {
      c.updatedAt = Date.now();
      await put('contacts', c);
    }
    return u.id;
  } catch {
    return null;
  }
}
