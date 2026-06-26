# Phase 1 Data Model: Hidden Chats Locked Behind a PIN

**No new IndexedDB object store. No `DB_VERSION` bump** (stays 9). All state rides
existing stores. Nothing here is added to the synced `chats` row.

## Entities

### 1. Hidden set (the membership)

The set of conversation ids the user has hidden **on this device**.

- **Storage**: one record in the existing `settings` store, key
  `privacy.hiddenChats`. Value is an **AEAD `Envelope`** (via `sealJson`) wrapping
  `string[]` (conversation ids), sealed under the **master key**.
- **Why master-key-wrapped (not the hidden PIN)**: must be readable while the app
  is unlocked so hidden chats can be *excluded by default*, before any reveal.
  Protected at rest because the master key is itself PIN-wrapped (FR-010).
- **Never synced**: not in `ownsync.SYNCED`; lives only in `settings`, which is
  excluded from the profile/prefs sync bundle.
- **Lifecycle**: created lazily on first hide; mutated on hide/unhide; cleared on
  PIN reset.

### 2. Hidden-chats PIN material (the lock)

The separate, dedicated PIN gating *reveal*.

- **Storage**: in `settings`/`keystore` (kept out of sync):
  - `hiddenPinSalt` — b64url Argon2id salt, stored in the clear.
  - `hiddenPinWrapped` — `Envelope` whose successful decryption proves the PIN
    (and yields the capability to unlock the reveal session). No plaintext PIN.
  - `hiddenPinLength` — digit count, for auto-verify at length (mirrors app PIN).
- **Verification**: decryption success (AEAD tag) — `verifyHiddenPin(pin)`,
  modeled on `identity.verifyPin`.
- **Lifecycle**: set on enable / change PIN; rotated on change; destroyed on reset.

### 3. Reveal session (ephemeral)

Whether hidden chats are currently unlocked for viewing.

- **Storage**: **in-memory only** (a composable ref in `useHiddenChats.ts`) plus a
  background-entered timestamp used to compute grace expiry. **Never persisted in
  a way that survives a cold start.**
- **States**: `locked` (default) → `revealed` (after correct PIN/biometric) →
  back to `locked` on grace-expiry, explicit re-hide, or full app close.
- **Grace**: `immediately` / `1m` / `5m`; full close always re-locks.

### 4. Do-not-resync block (reset permanence)

Marks conversations wiped by a PIN reset so they don't re-download — **this
device only**.

- **Storage**: a **local-only** tombstone variant — either `tombstones` records
  with `localOnly: true`, or a dedicated `settings` block-set
  (`privacy.hiddenResyncBlock`). Consulted at sync-pull ingest; **never uploaded**
  (so other devices and the server are unaffected).
- **Lifecycle**: appended on PIN reset (one entry per wiped conversation);
  effectively permanent on this device.

### 5. Hidden conversation (reuses existing entities)

A hidden chat is an ordinary conversation; only its *membership in the hidden set*
is special.

- **Storage**: existing `chats` (the 2-person group), `messages`, `sessions`,
  `senderkeys` — unchanged shapes. The group is created by
  `createGroup('', [contactId])` and immediately added to the hidden set.
- **On the wire**: identical to any group → opaque to the server (ZK preserved).
- **Other devices**: the group syncs as a normal conversation (visible there
  unless independently hidden) — the accepted per-device-divergence behavior.

### 6. Settings values (device-local prefs)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `privacy.hiddenChatsEnabled` | toggle | `false` | Feature on/off for this device |
| `privacy.hiddenChatsGrace` | choice | `1m` | Grace window: `immediately`/`1m`/`5m` |
| `privacy.hiddenChatsBiometric` | toggle | `false` | Offer biometric unlock at reveal |

(The wrapped set, PIN material, and block list above are *not* user-facing
settings rows; they are internal records under the `settings`/`keystore` stores.)

## Relationships & invariants

- A conversation id is in **at most one** state relevant here: visible (not in
  set), hidden (in set), or wiped+blocked (in the do-not-resync block, removed
  from the set).
- The **hidden set** excludes a conversation from: `listChats()` (and therefore
  every chat-filter chip), chat search, chat pickers, `listCallGroups()` + missed-
  call badges, and notification previews — a single source of truth consulted at
  each surface.
- **Membership knowledge ≠ reveal authorization**: the app can read the set
  (master key) to *hide*; only the hidden **PIN** (or enabled biometric) flips the
  **reveal session** to *show* them.
- **Reveal session never persists** across a full app close (invariant behind
  SC-009 / FR-005).
- The **synced `chats` row is byte-identical** whether or not the conversation is
  hidden (invariant behind SC-004 / FR-014).

## State transitions

```text
Conversation visibility (this device):

  VISIBLE ──hide()──────────────▶ HIDDEN ──unhide()──────────▶ VISIBLE
                                    │
                                    └─PIN reset wipe()─▶ WIPED+BLOCKED (terminal,
                                                          local-only; no re-sync)

Reveal session:

  LOCKED ──correct PIN / biometric──▶ REVEALED
  REVEALED ──grace elapsed (bg) / explicit re-hide / FULL CLOSE──▶ LOCKED
  (cold start always begins LOCKED)
```
