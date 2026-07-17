/**
 * First-run / clean-start init.
 *
 * Historically this seeded demo contacts/chats/calls. The app now starts CLEAN:
 * real users are added via the friend-request handshake, nothing is
 * pre-populated. This step just wipes any leftover demo/test social data once
 * per version bump (so existing installs get purged on next load), leaving the
 * identity/keystore/prekeys and settings (profile, sync cursors) intact.
 */
import { clearStore } from './idb';

// Bump to force existing installs to re-run the clean step.
const CLEAN_VERSION = 7;
const CLEAN_FLAG = 'ring.seedVersion';

function cleanedVersion(): number {
  try {
    return Number(localStorage.getItem(CLEAN_FLAG) ?? '0');
  } catch {
    return 0;
  }
}
function markClean(): void {
  try {
    localStorage.setItem(CLEAN_FLAG, String(CLEAN_VERSION));
  } catch {
    /* ignore */
  }
}

/**
 * Wipe demo/test social data so the device starts clean. Runs once per
 * CLEAN_VERSION. Identity, prekeys and settings are preserved.
 * (Name kept as `seedIfEmpty` for the existing call site in main.ts.)
 */
export async function seedIfEmpty(): Promise<void> {
  if (cleanedVersion() >= CLEAN_VERSION) return;
  for (const s of [
    'contacts', 'chats', 'messages', 'calls', 'media',
    'requests', 'alerts', 'sessions', 'senderkeys', 'outbox',
  ] as const) {
    await clearStore(s);
  }
  markClean();
}
