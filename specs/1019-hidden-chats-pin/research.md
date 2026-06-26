# Phase 0 Research: Hidden Chats Locked Behind a PIN

All spec clarifications were resolved in the 2026-06-26 session. This document
records the *technical* decisions reached by mapping the existing codebase, with
rationale and rejected alternatives. File:line anchors are the integration points
the implementation will touch.

## R1. Where the "hidden" designation lives

**Decision**: Store the set of hidden conversation ids as a **separate,
local-only, master-key-wrapped blob in the `settings` store** (e.g. key
`privacy.hiddenChats`). Do **not** add a `hidden` field to the `Chat` record.

**Rationale**:
- `ownsync.ts` seals and uploads **whole `chats` rows** under the master key
  (`SYNCED = ['contacts','chats','chatlists']`, `sealJson(mk, row, 'sync')`). A
  `hidden` field on the row would therefore sync to the server (as ciphertext)
  **and propagate to the user's other devices**, violating FR-018 / FR-009
  ("hiding is local to this device").
- A separate set keeps the synced `chats` row byte-identical to a non-hidden
  chat → satisfies FR-014 / SC-005 ("no observable signal when the feature is in
  use") and SC-004 ("hidden vs visible indistinguishable on the wire").
- Wrapping the set under the **master key** (available whenever the app/SW is
  unlocked) meets FR-010 ("protected at rest, not readable without unlock") while
  still letting the app/SW *exclude* hidden chats by default (before the hidden
  PIN is entered). The hidden **PIN** gates *revealing*, not *knowing membership*.

**Alternatives rejected**:
- *Plaintext `hidden:boolean` on the Chat row* (like the existing `locked`
  flag): simplest, but it syncs and is readable at rest — fails FR-009/010/018.
- *Wrap the set under the hidden PIN itself*: then the app couldn't exclude
  hidden chats until the PIN was entered — backwards (they'd be visible by
  default). Membership must be knowable while unlocked; **revealing** is what the
  PIN authorizes.

**Integration points**: `src/db/queries.ts:54` `listChats()` (single choke point —
all filter chips compose over it via `src/services/chat-filters.ts`
`chatMatchesFilter`); `src/services/ownsync.ts:27` `SYNCED` (leave `chats` as-is,
keep the set out).

**Residual at-rest note (for security review)**: chat *message bodies* already
live in the `messages` store in the clear on-device (offline-first; the
zero-knowledge boundary is about the **server**, not local forensics). Hidden
chats inherit that same posture — wrapping the *membership set* hides *which*
chats are hidden, not the message bytes of a fully-forensic device image.
Deeper at-rest encryption of hidden message bodies is **out of scope** (a future
hardening) and is called out for the security review. This matches the threat
model in the spec: "someone briefly handed the unlocked phone," not disk forensics.

## R2. The distinct, coexisting hidden conversation

**Decision**: A hidden chat is realized as a **2-person group** via
`createGroup('', [contactId])`. Two flows:
- **Hide existing** (US1): add an existing conversation's id to the hidden set.
- **New hidden chat** (US2): create a fresh 2-person group, add it to the hidden
  set immediately → coexists with the normal 1:1.

**Rationale**:
- `createGroup(name, memberIds)` (`src/db/queries.ts:1091`) enforces **no minimum
  size**; a 2-person group is valid and yields a distinct `groupId`, its own
  sender-key state, and its own history — exactly the "coexists with the 1:1"
  requirement (FR-017). Reusing the group primitive honors Crypto Discipline
  (Principle IV): **no new key-exchange/ratchet**.
- `startDirectChat()` (`:3518`) dedupes 1:1s by contact, so you cannot get a
  second 1:1 with the same person — confirming the group route is the way to a
  coexisting distinct thread.

**Accepted consequence (confirmed with user)**: the counterpart sees a normal
separate 2-person group conversation on their device (FR-018). "Hidden" is local.

**Alternatives rejected**:
- *Second 1:1 thread*: impossible — 1:1 is identity-pair keyed and deduped.
- *Pure-local "shadow" conversation with no real session*: messages need a real
  crypto session to flow; would mean hand-rolling — rejected by Principle IV.

**Integration points**: `src/db/queries.ts:1091` `createGroup`, `:419`
`sealAndEnqueueGroup`, `src/services/crypto/senderkeys.ts`.

## R3. Separate dedicated PIN (verify, enable, change, reset)

**Decision**: Mirror the app-PIN pattern for an independent secret. Store, in the
`settings`/`keystore` area (kept out of sync), `hiddenPinSalt` (b64url, clear),
`hiddenPinWrapped` (an `Envelope` sealing a known marker / the hidden-set key),
and `hiddenPinLength`. **Verification = decryption success** (AEAD tag), exactly
like `verifyPin()` — no plaintext PIN, no separate stored verifier.

**Rationale**: `src/services/crypto/identity.ts:217` `wrapSecret` /`:226`
`unwrapSecret` /`:410` `verifyPin` /`:477` `enableLock` already implement this
pattern with `argon2id` (`primitives.ts:138`) and the `envelope.ts` `seal/open`
primitives. Reuse → Principle IV, and the separate salt/key keeps it fully
independent of the app-unlock PIN (FR-015).

**Detail**: the hidden-set blob (R1) is wrapped under the **master key** for
default exclusion; the **hidden PIN** unlocks a *reveal session*. To bind reveal
to the PIN without a second copy of the data, the hidden PIN wraps a small
capability (e.g. the marker proving PIN-correctness); on success the app flips the
reveal session on. (Exact composition — PIN wraps marker vs. PIN wraps the set's
read — finalized in implementation; both reuse `sealJson/openJson`.)

**Integration points**: `src/services/crypto/identity.ts:217/226/410/477`,
`src/services/crypto/envelope.ts:54-85`, `primitives.ts:138`.

## R4. Reveal session + sticky grace window + re-lock on full close

**Decision**: Model on `useAutoLock.ts`. The revealed state is an **in-memory**
ref plus a grace timer driven by `visibilitychange`. On background, record a
timestamp; on return within the configured grace window, stay revealed; on
elapse, explicit re-hide, or **cold start**, re-lock. **Nothing that auto-reveals
is persisted across a full close** → an immediate relaunch shows no hidden chats
(FR-005, FR-020, US3 AC5/AC6, SC-009).

**Rationale**: `useAutoLock.ts:23-49` already does "stored timestamp + elapsed
check" for app-lock, and `:52-58` wires `visibilitychange`; `useSync.ts:481`
shows `pagehide` handling. Reusing this pattern avoids a parallel lifecycle
implementation and inherits its tested edge handling.

**Grace options**: `immediately` / `1m` / `5m`, default **1 minute** (privacy-
leaning but enough for copy-paste). A full close always wins regardless.

**Integration points**: new `src/composables/useHiddenChats.ts` (mirrors
`useAutoLock.ts`); `src/views/tabs/ChatsPage.vue` consumes the revealed state.

## R5. Reveal gesture in the search bar

**Decision**: Reuse the existing `ion-searchbar` on `ChatsPage.vue:13-17`. When
the typed query verifies as the hidden PIN, start the reveal session and surface
hidden chats; otherwise it behaves as normal search (FR-004, SC-005/SC-006 — an
incorrect/normal query is indistinguishable from the pre-feature behavior).

**Rationale**: no discoverable entry point (the whole point), and it reuses an
Ionic primitive already in the header (Principle XI). Mirrors Viber.

**Detail**: attempt verification when the query is all-digits and matches
`hiddenPinLength` (auto-verify at length, as the app PIN does). Non-matching input
never errors or hints.

**Integration points**: `src/views/tabs/ChatsPage.vue` search handler; gate the
revealed list through `listChats()`/`useChatFilters` with a "include hidden when
revealed" flag.

## R6. Notifications — generic, no preview, no deep-link

**Decision**: In `noteForPayload()` (`src/services/sw-inbox.ts:138-224`), if the
target chat id ∈ hidden set, render a generic content-free note (no sender, no
avatar, neutral body) and set `url` to `/tabs/chats` (not `/chat/{id}`), so a tap
lands on the Chats tab without opening/revealing the chat (FR-007, FR-008).

**Rationale**: the SW already imports `@/db/idb` and reads `chats`/`contacts`/
settings (`sw-inbox.ts:23,395`), already supports `notifyContent: generic/none`,
and already builds the `url`. The SW reads the master-key-wrapped hidden set
**after** `attemptDeviceUnlock()`; if device-unlock fails it already shows a
generic notification — so the no-preview guarantee holds **fail-safe**. Existing
burst-coalescing (spec 2017, `coalesceForShow`/`serializeNotify`) is untouched.

**Integration points**: `src/services/sw-inbox.ts:138-224` (build), `:219-220`
(url), `src/sw.ts:582-600` (`notificationclick` already routes by `data.url`).

## R7. Call history & pre-answer caller suppression

**Decision**: (a) Exclude hidden conversations from the Calls tab by filtering in
`listCallGroups()` (`src/db/queries.ts:1878`) before grouping; (b) suppress missed-
call badges for hidden chats; (c) in `useCall.ts` incoming-offer handling
(`:1663-1673`, and the call-waiting second-incoming branch), substitute a generic
caller identity when the originating conversation is hidden, so
`IncomingCallOverlay.vue` shows nothing identifying (FR-019).

**Rationale**: the `calls` store records `contactId = roomId` for group calls
(`types.ts:302`, `recordGroupCall`/`createCall` `:4225+`). Since hidden chats are
2-person **groups**, their calls carry `contactId = hidden groupId`, which is a
direct membership check against the hidden set — clean, no schema change. The
pre-answer UI resolves name/avatar in `useCall.ts`, the single place to branch.

**Edge**: the in-chat call-log line (`logCallToChat`/`calllog.ts`) is already
generic and stays inside the (hidden) conversation — safe.

**Integration points**: `src/db/queries.ts:1878` `listCallGroups`, `:1953`
`markCallsSeen`; `src/composables/useCall.ts:1663-1673` (+ call-waiting branch);
`src/components/IncomingCallOverlay.vue` (auto via `callMeta`).

## R8. PIN reset: wipe local history + block re-sync (this device only)

**Decision**: On reset, for each hidden conversation: delete its messages,
sessions, sender keys, and chat row locally, **and** record a **local-only
"do-not-resync" block** so `pullOwnData()` ingest skips it — **without** uploading
a deletion tombstone (other devices keep their copy). Then clear the hidden set
and the hidden-PIN material; the user can set a fresh PIN.

**Rationale**: the existing tombstone mechanism (`src/db/tombstones.ts`
`recordTombstone`/`isTombstoned`, checked in `sync.ts`/`ownsync.ts`
`pullOwnData` ingest) already does "prevent resurrection from server pull" — but
`listTombstones()` **uploads** tombstones, which would delete the conversation on
other devices and is observable. So we add a **local-only variant** (e.g. a
`localOnly: true` flag on the tombstone, or a separate `settings` block-set) that
is consulted at ingest but never enqueued/uploaded. This satisfies FR-016 ("wipe
+ block re-sync on this device") and the user's "Wipe + block re-sync" choice
while keeping it device-local.

**Alternatives rejected**:
- *Normal tombstone*: propagates the delete to other devices and to the server
  cursor — wrong scope, and observable.
- *Just delete locally, no block*: the conversation re-downloads on next
  `pullOwnData()` — fails FR-016.

**Integration points**: `src/db/tombstones.ts` (+ local-only flavor),
`src/services/ownsync.ts:172` `pullOwnData` (ingest skip), the deletion helpers in
`src/db/queries.ts` (`deleteChat` and message/session/senderkey removal).

## R9. Settings surface

**Decision**: Add a `privacy-hidden-chats` screen under the existing
`privacy` hub in `src/settings/schema.ts` (declarative, rendered by
`SettingDetailPage.vue`): enable toggle, set/change PIN (action), reset PIN
(danger action with explicit confirm), biometric toggle, and a grace-window
`choice` (`immediately`/`1m`/`5m`). Values read via `getSetting`/`setSetting`.

**Rationale**: Principles X/XI — a settings screen is a data edit here, not a new
component. App-lock/device-local settings are already **excluded from sync**
(`ownsync.ts` comment), so the hidden-chats prefs stay per-device automatically.

**Integration points**: `src/settings/schema.ts` (`privacy` node ~`:240`,
sibling to `privacy-app-lock`/`privacy-chat-lock`); `SettingDetailPage.vue`
(`str/bool` readers, `setSetting` writers).

## R10. Relationship to the existing "Locked chats" feature

**Decision**: Build Hidden Chats as a **distinct** feature, reusing building
blocks but not the `locked` flag.

**Rationale**: Locked chats (`chat.locked`, `listLockedChats`, `privacy-chat-lock`,
gated by app auth, shown in a discoverable "Locked chats" view, and **synced**)
differ from Hidden Chats on every defining requirement: separate dedicated PIN,
**no** discoverable entry point, notification/call-history suppression, distinct-
conversation coexistence, local-only + reset wipe/block. Overloading `locked`
would entangle two different threat models and break "no observable signal."
Reused *patterns*: the per-flag exclusion at `listChats`, the `useAutoLock` grace
lifecycle, the wrap/verify primitives, the settings schema, `ChatActionsSheet`.

## Summary of decisions

| # | Decision | Key reuse |
|---|---|---|
| R1 | Hidden-set = local-only, master-key-wrapped blob in `settings` (no Chat field) | `ownsync` SYNCED set, `sealJson` |
| R2 | Hidden chat = 2-person group (coexists with 1:1) | `createGroup`, sender keys |
| R3 | Separate PIN via wrap/verify (decryption = verification) | `identity.ts` wrapSecret/verifyPin |
| R4 | Reveal session + grace window; cold start always re-locks | `useAutoLock` pattern |
| R5 | Reveal = PIN typed into the chat-list searchbar | `ion-searchbar` on ChatsPage |
| R6 | Generic notification + `/tabs/chats` url for hidden | `sw-inbox.noteForPayload` |
| R7 | Exclude from Calls tab + generic pre-answer caller | `listCallGroups`, `useCall` |
| R8 | Reset = wipe local + **local-only** do-not-resync block | tombstones + `pullOwnData` |
| R9 | Declarative `privacy-hidden-chats` settings screen | `settings/schema.ts` |
| R10 | Distinct from Locked-chats; reuse blocks, not the `locked` flag | — |

**Open for `/speckit-checklist` + security review**: exact PIN↔set composition
(R3), the precise local-only-tombstone representation (R8), and the at-rest
residual on message bodies (R1). None block tasks; all are implementation/review
details.
