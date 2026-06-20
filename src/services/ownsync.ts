/**
 * Encrypted own-data sync + recovery-wrap backup (Milestone 7e).
 *
 * Zero-knowledge: each synced record is sealed under the device master key
 * before it leaves the device; the server stores only opaque ciphertext keyed
 * by (store, recordId) plus a coarse updatedAt for last-write-wins. This backs
 * up the social graph so a reinstalled/new device can restore it (single-device
 * v1; the same engine powers multi-device later).
 *
 * Requires the keystore to be unlocked (the master key lives in memory only
 * while unlocked), so it runs after the passcode gate.
 */
import { get, getAll, put, remove, type StoreName } from '@/db/idb';
import { recordTombstone, isTombstoned, listTombstones } from '@/db/tombstones';
import { isUnlockedNow, getMasterKey, getRecoveryWrapForUpload } from '@/services/crypto/identity';
import { sealJson, openJson, type Envelope } from '@/services/crypto/envelope';
import { getSetting, setSetting } from '@/db/queries';
import { getSecret, setSecret, SECRET_KEYS } from '@/db/secrets';
import {
  pushSyncRecords, pullSyncRecords, putRecoveryWrap,
  type SyncRecord,
} from '@/services/api';

// Stores backed up by own-data sync. Each row must have `{ id, updatedAt }`.
// (Messages/calls/media are excluded for v1: large, and messages are already
// E2EE-relayed.)
const SYNCED: StoreName[] = ['contacts', 'chats', 'chatlists'];
const PAGE = 500;

// Profile + prefs ride as ONE encrypted record (store='profile', id='me'):
// the profile secrets (name/about/avatar) and the user-preference settings
// below. Bundled so a restored device comes back as fully "you", not just your
// address book. App-lock and device-local/storage settings are intentionally
// excluded (they're per-device or security-sensitive). Server enforces nothing
// here, the whole snapshot is sealed under the master key.
const PROFILE_STORE = 'profile';
const SYNCED_PREF_KEYS: string[] = [
  'privacy.lastSeen', 'privacy.online', 'privacy.profilePhoto', 'privacy.about',
  'privacy.groups', 'privacy.status', 'privacy.statusSharing', 'privacy.messageTimer',
  'privacy.blockUnknown', 'privacy.protectIp', 'privacy.disableLinkPreviews',
  'notifications.message.show', 'notifications.message.reactions', 'notifications.message.sound',
  'notifications.group.show', 'notifications.group.reactions', 'notifications.group.sound',
  'notifications.status.show', 'notifications.status.reactions', 'notifications.status.sound',
  'notifications.reminders', 'notifications.showPreview', 'notifications.badge',
  'notifications.inapp.enabled', 'notifications.inapp.style', 'notifications.inapp.sounds', 'notifications.inapp.vibrate',
  'chats.animEmoji', 'chats.animGifs', 'chats.tabFilters',
];

interface ProfileSnapshot {
  v: 1;
  secrets: Record<string, unknown>;
  prefs: Record<string, unknown>;
}

/** Build the current profile+prefs snapshot (fixed key order → stable hashing). */
async function buildProfileSnapshot(): Promise<ProfileSnapshot> {
  const secrets: Record<string, unknown> = {};
  for (const k of SECRET_KEYS) {
    const v = await getSecret(k, '' as unknown);
    if (v) secrets[k] = v;
  }
  const prefs: Record<string, unknown> = {};
  for (const k of SYNCED_PREF_KEYS) {
    const v = await getSetting<unknown>(k, undefined as unknown);
    if (v !== undefined && v !== null) prefs[k] = v;
  }
  return { v: 1, secrets, prefs };
}

/** Apply a pulled snapshot back into the local secrets + settings. */
async function applyProfileSnapshot(snap: ProfileSnapshot): Promise<void> {
  if (snap.secrets) {
    for (const k of SECRET_KEYS) {
      const v = snap.secrets[k];
      if (typeof v === 'string' && v) await setSecret(k, v);
    }
  }
  if (snap.prefs) {
    for (const k of SYNCED_PREF_KEYS) {
      if (k in snap.prefs) await setSetting(k, snap.prefs[k]);
    }
  }
}

/** Cheap deterministic hash (djb2) for change detection. */
function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

interface Syncable {
  id: string;
  updatedAt: number;
}

/* ---- sync metadata (settings store) ---- */

interface SettingRow<T> {
  key: string;
  value: T;
}
async function getMeta<T>(key: string, def: T): Promise<T> {
  const r = await get<SettingRow<T>>('settings', key);
  return r?.value ?? def;
}
async function setMeta<T>(key: string, value: T): Promise<void> {
  await put<SettingRow<T>>('settings', { key, value });
}

/* ---- push (back up local changes) ---- */

export async function pushOwnData(): Promise<void> {
  if (!isUnlockedNow()) return;
  const mk = getMasterKey();
  const records: SyncRecord[] = [];
  const newWatermark: Record<string, number> = {};

  for (const store of SYNCED) {
    const wm = await getMeta(`syncWm:${store}`, 0);
    newWatermark[store] = wm;
    const rows = await getAll<Syncable>(store);
    for (const row of rows) {
      if (typeof row.updatedAt !== 'number' || row.updatedAt <= wm) continue;
      records.push({
        store,
        recordId: row.id,
        updatedAt: row.updatedAt,
        ciphertext: JSON.stringify(sealJson(mk, row, 'sync')),
      });
      if (row.updatedAt > newWatermark[store]) newWatermark[store] = row.updatedAt;
    }
  }

  // Deletions ride as tombstone records.
  const tWm = await getMeta('syncTombWm', 0);
  let newTWm = tWm;
  for (const t of await listTombstones()) {
    if (!SYNCED.includes(t.store as StoreName) || t.deletedAt <= tWm) continue;
    records.push({ store: t.store, recordId: t.recordId, updatedAt: t.deletedAt, deleted: true });
    if (t.deletedAt > newTWm) newTWm = t.deletedAt;
  }

  // Profile + prefs snapshot: push only when it changed (and has any content).
  const snap = await buildProfileSnapshot();
  const snapHash = stableHash(JSON.stringify(snap));
  const hasContent = Object.keys(snap.secrets).length > 0 || Object.keys(snap.prefs).length > 0;
  let profilePush: { hash: string; updatedAt: number } | null = null;
  if (hasContent && snapHash !== (await getMeta('profileSnapHash', ''))) {
    const updatedAt = Date.now();
    records.push({
      store: PROFILE_STORE,
      recordId: 'me',
      updatedAt,
      ciphertext: JSON.stringify(sealJson(mk, snap, 'sync')),
    });
    profilePush = { hash: snapHash, updatedAt };
  }

  if (!records.length) return;
  await pushSyncRecords(records);
  for (const store of SYNCED) await setMeta(`syncWm:${store}`, newWatermark[store]);
  await setMeta('syncTombWm', newTWm);
  if (profilePush) {
    await setMeta('profileSnapHash', profilePush.hash);
    await setMeta('profileSnapUpdatedAt', profilePush.updatedAt);
  }
}

/* ---- pull (restore / apply remote changes) ---- */

export async function pullOwnData(): Promise<void> {
  if (!isUnlockedNow()) return;
  const mk = getMasterKey();
  let cursor = await getMeta('ownSyncCursor', 0);

  for (let guard = 0; guard < 100; guard++) {
    const { records, cursor: next } = await pullSyncRecords(cursor);
    for (const r of records) {
      // Profile + prefs snapshot, applied specially (fans out into secrets +
      // settings), not stored as a generic row.
      if (r.store === PROFILE_STORE) {
        if (r.deleted) continue;
        if (r.updatedAt <= (await getMeta('profileSnapUpdatedAt', 0))) continue; // LWW
        try {
          const snap = openJson<ProfileSnapshot>(mk, JSON.parse(r.ciphertext ?? '') as Envelope);
          await applyProfileSnapshot(snap);
          await setMeta('profileSnapUpdatedAt', r.updatedAt);
          await setMeta('profileSnapHash', stableHash(JSON.stringify(snap)));
        } catch (e) {
          console.warn('[ownsync] failed to apply profile snapshot', e);
        }
        continue;
      }

      const store = r.store as StoreName;
      if (!SYNCED.includes(store)) continue;

      if (r.deleted) {
        await recordTombstone(store, r.recordId, r.updatedAt);
        const local = await get<Syncable>(store, r.recordId);
        if (local && r.updatedAt >= local.updatedAt) await remove(store, r.recordId);
        continue;
      }
      if (await isTombstoned(store, r.recordId, r.updatedAt)) continue;
      const local = await get<Syncable>(store, r.recordId);
      if (local && local.updatedAt >= r.updatedAt) continue; // last-write-wins
      try {
        const record = openJson<Syncable>(mk, JSON.parse(r.ciphertext ?? '') as Envelope);
        await put(store, record);
      } catch (e) {
        console.warn('[ownsync] failed to decrypt record', r.store, r.recordId, e);
      }
    }
    cursor = next;
    await setMeta('ownSyncCursor', cursor);
    if (records.length < PAGE) break;
  }
}

/* ---- recovery wrap ---- */

/** Upload the recovery wrap if it changed (initial creation or rotation). */
export async function syncRecoveryWrap(): Promise<void> {
  const wrap = await getRecoveryWrapForUpload();
  if (!wrap) return;
  const uploaded = await getMeta('recoveryUploadedSalt', '');
  if (uploaded === wrap.salt) return;
  await putRecoveryWrap(wrap.salt, wrap.envelope, wrap.lookup);
  await setMeta('recoveryUploadedSalt', wrap.salt);
}

/* ---- orchestration ---- */

let running = false;
let cooldownUntil = 0;

/**
 * True while a sync is running or just finished. The scheduler uses this to
 * ignore the change-bus echoes from ownsync's OWN bookkeeping writes (it stores
 * cursors/watermarks in the `settings` store), which would otherwise make every
 * sync trigger the next one in an endless loop.
 */
export function ownSyncQuiet(): boolean {
  return running || Date.now() < cooldownUntil;
}

/** Back up the recovery wrap, then pull + push own data. No-op while locked. */
export async function runOwnSync(): Promise<void> {
  if (running || !isUnlockedNow()) return;
  running = true;
  try {
    await syncRecoveryWrap();
    await pullOwnData();
    await pushOwnData();
  } catch (e) {
    console.warn('[ownsync] sync cycle failed', e);
  } finally {
    running = false;
    cooldownUntil = Date.now() + 2000; // swallow our own meta-write echoes
  }
}
