# Data Model: Harden Hidden Chats + One-Hidden-One-Visible Per Person

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-07-02

No new IndexedDB object stores and no `DB_VERSION` bump. All new data rides
existing stores (`settings`, `tombstones`). This file defines the entities,
their keys, the per-person invariant, and the hide/reveal state machine.

## Entities

### Conversation (existing `chats` store — unchanged shape)

Two channel shapes participate in the per-person model:

| Shape | Discriminator | Crypto channel | Inbound routing key |
|---|---|---|---|
| **Plain 1:1** | `!isGroup && participantIds.length === 1` | per-peer Double Ratchet; session stored under this chat's id (`sessions[chatId]`, `smeta:<chatId>`) | sender (`from`) — resolved by rule R |
| **Pair conversation** | `isGroup && participantIds.length === 1` | sender keys (group mechanism) | `payload.groupId` (exact id) |
| Multi-member group | `isGroup && participantIds.length > 1` | sender keys | `payload.groupId` |

*Hidden* is **not** a chat field — membership in the sealed hidden set is the
only marker (unchanged from 1019). Multi-member groups are outside the
per-person rule and hide/unhide individually.

### Hidden set (existing, unchanged)

`settings['privacy.hiddenChats']` — `EncWrapper` (AEAD-sealed `string[]` under
the master key, AAD = key name). Device-local; excluded from own-data sync.

### Hidden PIN verifier (existing, unchanged)

`settings['privacy.hiddenPin']` — `{ salt, env, length }`, Argon2id-derived key,
decrypt-succeeds verification, no recoverable PIN, no fast path.

### Reveal session (existing, unchanged storage; new relock hook)

Memory-only (`hidden-state.ts`): `revealed` flag + grace timer in
`useHiddenChats.ts`. **New**: a registered navigation hook fires on every
transition to `revealed=false` (grace expiry, manual relock, keystore auto-lock,
`clearHiddenState`) so an on-screen hidden conversation is left immediately.

### Peer block (new rows in existing `tombstones` store)

```
Tombstone {
  id:        'hiddenPeer:<peerUserId>'   // store-qualified key, existing scheme
  store:     'hiddenPeer'                // logical namespace, not an idb store
  recordId:  <peerUserId>
  deletedAt: Number.MAX_SAFE_INTEGER     // permanent until explicitly lifted
  localOnly: true                        // never uploaded, never synced
}
```

Written by `resetHiddenChats` for each hidden **plain-1:1** peer (pair/group
threads keep chat-id tombstones — their ids are stable and shared, so id-keyed
blocking works). Consulted by rule R step 4 in `receiveIncomingInner` (ack +
drop, no rekey, no contact/chat creation). Lifted by `clearTombstone` when the
user explicitly starts a new chat with that person (`startDirectChat`).

### Badge cache (new `settings` key)

`settings['badge.lastCount']` — plain integer, the last successfully computed
(already preference-filtered) unread total. Device-local: added to the own-sync
exclusion list beside the hidden keys. Read as the fallback when the hidden set
is not yet decryptable in modes `never`/`revealed` (page `countUnread`, SW
`unreadCount`). Leaks nothing: it equals the number the OS badge already
displays.

### Badge preference (existing, unchanged values)

`settings['privacy.hiddenChatsBadge']`: `'always'` (default) | `'never'` |
`'revealed'`. New semantics detail: in the SW, `'revealed'` behaves as
`'never'` (reveal is page-memory-only and must never be assumed from the SW).

## The per-person invariant

For a peer `P`, over the set `chatsWithPeer(P)` = plain 1:1s with `P` + pair
conversations with `P`:

- **INV-1**: at most one member of `chatsWithPeer(P)` is hidden.
- **INV-2**: at most one member of `chatsWithPeer(P)` is visible.
- **INV-3**: at most one plain 1:1 with `P` exists (channel uniqueness — the
  ratchet session for `P` lives under exactly one chat id).

Enforcement points (all through pure `hidden-pair.ts` predicates):

| Action | Guard | Blocked outcome |
|---|---|---|
| Hide chat | `canHide`: no other hidden member of `chatsWithPeer(P)` | Action disabled, reason: already a hidden chat with this person |
| Unhide chat | `canUnhide`: no visible member of `chatsWithPeer(P)` | Action disabled, reason: already a visible chat with this person (delete it first) |
| Start chat (user) | `startDirectChat`: existing visible member → return it; hidden plain 1:1 exists → create **pair conversation**; else create plain 1:1 | never a second visible, never a second plain 1:1 |
| Inbound frame | rule R (below) | never creates a row when a hidden thread exists |

Legacy tolerance: pre-1027 devices may hold a hidden **and** a visible plain 1:1
for the same peer (bug B1's residue), violating INV-3. Tolerated read-only: rule
R prefers the visible one (where the live session is), `canHide`/`canUnhide`
still hold INV-1/INV-2, and deleting either chat converges the state. No
migration pass.

## Inbound routing (rule R)

For an inbound frame from peer `P` (runs only unlocked; frames queue while
locked — existing gate). Rule R has two stages, because `payload.groupId` lives
INSIDE the sealed payload and is only known after decryption:

**Stage 1 — session resolution (PRE-decrypt).** Every frame from `P` rides the
per-peer 1:1 ratchet regardless of what it carries, so the session chat is
resolved without looking at the payload:

```
S1. visible plain 1:1 with P?   → that chat (open the packet under its id)
S2. hidden plain 1:1 with P?    → that chat (silent: no row created, no unhide)
S3. tombstone 'hiddenPeer:P'?   → ack + drop (no rekey request, no contact/chat
                                   creation, no notification — no trace)
S4. else                        → create fresh visible plain 1:1 (existing path)
```

**Stage 2 — content routing (POST-decrypt).** With the payload open:

```
C1. payload.groupId?            → conversation payload.groupId (existing behavior;
                                   ensureGroupChat consults group-id tombstones —
                                   the stage-1 chat only carried the session)
C2. else (plain 1:1 content)    → the stage-1 chat (hidden thread stays silent:
                                   notifications per FR-012, badge per FR-015)
```

Fail-closed rule: if the hidden set is not `isHiddenKnown()` at stage-1 time
(cannot normally happen — unlocked implies decryptable), the frame is re-queued,
never resolved against an unknown set.

Stage 1 is what eliminates bug B1's spurious `requestRekey`: the packet is
always opened under the chat id that actually holds the ratchet.

## Hide / reveal state machine (per device)

States: `Setup` (no PIN) → `Locked` (PIN exists, not revealed) ⇄ `Revealed`.

| From | Event | Guard | To | Effects |
|---|---|---|---|---|
| Setup | Hide chat | PIN created via `ensureHiddenPin`; `canHide` | Locked | chat id added to sealed set; leaves all visible surfaces |
| Locked | Correct PIN typed in search | length match + verifier decrypt | Revealed | lists re-query; hidden chats marked + sorted to top; search box cleared |
| Locked | Wrong PIN | — | Locked | no output, no signal (no oracle) |
| Revealed | Grace expiry / manual relock / keystore auto-lock / app close | — | Locked | lists re-query; **kick-out hook** leaves any open hidden conversation |
| Revealed | Hide chat | `canHide` | Revealed | new id sealed into set |
| Revealed | Unhide chat | `canUnhide` | Revealed | id removed from set; chat rejoins normal list |
| any | Reset hidden chats | user confirm | Setup | tombstones (chat ids + `hiddenPeer:` peers) → wipe messages/sessions/senderkeys/chats → clear set + PIN + memory (order preserved from 1019 FR-024) |

## Notification decision (per delivery path — FR-012)

| Path | Hidden + relocked outcome |
|---|---|
| Foreground page | Fully silent; claims the banner so a co-arriving push can't double-fire; badge updates |
| Backgrounded, WS-connected, not push-woken | Fully silent (generic bridge **removed** — B6); badge updates |
| Push-woken SW | Generic note byte-identical to previews-off: title `Ring`, body `New message`, url `/tabs/chats`, internal coalescing tag; badge per preference |
| Incoming call (any path) | Full identity ring — never suppressed (knock-knock, FR-013) |

## Badge computation (FR-015)

```
mode = privacy.hiddenChatsBadge
if mode == 'always':      total = Σ unread(all chats)            # no hidden dependency
else:
  if hidden set known:    total = Σ unread(chats not hidden)     # + hidden if revealed & mode=='revealed' (page only)
  else:                   total = settings['badge.lastCount']    # last good, never 0-collateral
persist settings['badge.lastCount'] = total on every successful computation
SW: 'revealed' ≡ 'never'; pending frames not classifiable as non-hidden are NOT counted
```
