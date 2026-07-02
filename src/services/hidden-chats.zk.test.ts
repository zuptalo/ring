// Spec 1019 zero-knowledge guard (T044 / SC-004 / FR-009): the hidden set, the
// PIN material, and the hidden-chats prefs MUST NEVER be uploaded. Own-data sync
// uploads only the explicit `SYNCED_PREF_KEYS` allowlist (settings are NOT synced
// wholesale) and excludes localOnly tombstones. This test pins those invariants
// against the source so a future edit can't silently start syncing hidden state.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ownsync = readFileSync(resolve(root, 'src/services/ownsync.ts'), 'utf8');
const ownsyncKeys = readFileSync(resolve(root, 'src/services/ownsync-keys.ts'), 'utf8');

// The hidden-chats storage keys (mirrors hidden-chats.ts SET_KEY/PIN_KEY + prefs),
// plus the spec-1027 device-local badge cache (already preference-filtered, but a
// per-device number that must never ride the snapshot to other devices).
// NOTE: privacy.hiddenChatsBiometric is FUTURE-PROOFING ONLY — biometric reveal
// (1019 US6) was never implemented and stays deferred (spec 1027 Out of Scope);
// the assertion simply guarantees that if it ever lands, it can't sync either.
const HIDDEN_KEYS = ['privacy.hiddenChats', 'privacy.hiddenPin', 'privacy.hiddenChatsEnabled', 'privacy.hiddenChatsGrace', 'privacy.hiddenChatsBiometric', 'badge.lastCount'];

describe('zero-knowledge: hidden state never syncs', () => {
  it('no hidden-chats key appears in the synced-pref allowlist', () => {
    const block = ownsyncKeys.match(/SYNCED_PREF_KEYS[^\]]*\]/s)?.[0] ?? '';
    expect(block).not.toEqual('');
    for (const k of HIDDEN_KEYS) expect(block).not.toContain(k);
  });

  it('own-data sync only covers contacts/chats/chatlists stores (not settings wholesale)', () => {
    const block = ownsync.match(/const SYNCED:\s*StoreName\[\]\s*=\s*\[[^\]]*\]/s)?.[0] ?? '';
    expect(block).toContain("'chats'");
    expect(block).not.toContain("'settings'"); // settings only sync via the explicit allowlist
  });

  it('localOnly tombstones are excluded from the uploadable set', () => {
    const tombstones = readFileSync(resolve(root, 'src/db/tombstones.ts'), 'utf8');
    // listTombstones must filter out localOnly markers before uploading.
    expect(tombstones).toMatch(/listTombstones[\s\S]*filter[\s\S]*!t\.localOnly/);
  });

  it('hidden-reset peer blocks are localOnly by construction (spec 1027 FR-018/FR-019)', () => {
    const tombstones = readFileSync(resolve(root, 'src/db/tombstones.ts'), 'utf8');
    // recordHiddenPeerBlock hard-codes localOnly: true — combined with the
    // listTombstones filter above, a hiddenPeer: block can never be uploaded.
    expect(tombstones).toMatch(/recordHiddenPeerBlock[\s\S]{0,400}localOnly:\s*true/);
  });
});
