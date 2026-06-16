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
import { isPeerBlocked, getSetting, downscaleAvatar, listContacts } from '@/db/queries';
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
  const existing = await get<Contact>('contacts', u.id);
  if (existing?.ghosted || existing?.blocked) return;

  const name = (u.displayName || u.username || '').trim() || u.id.slice(0, 8);
  const avatar = u.avatar || existing?.avatar || initialsAvatar(name);
  const about = u.about ?? existing?.about ?? '';

  // Skip the write when nothing the directory owns has changed, avoids churning
  // the contacts store (and its reactive subscribers) on every poll.
  if (
    existing &&
    existing.name === name &&
    existing.username === u.username &&
    existing.avatar === avatar &&
    existing.about === about
  ) {
    return; // nothing the directory owns changed
  }

  const contact: Contact = {
    id: u.id,
    name,
    username: u.username,
    avatar,
    phone: existing?.phone ?? '',
    about,
    updatedAt: u.profileAt || Date.now(),
  };
  // Mirror the PROFILE only — this does not make them a friend. Friendship is set
  // (markContactConnected) by the accept flow; the server gate enforces it.
  await put('contacts', contact);
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
    await upsertDirectoryContact(u);
    return u.id;
  } catch {
    return null;
  }
}
