# Phase 1 Contracts: Hidden Chats Locked Behind a PIN

This is a **client-only** feature. **There is no external/wire contract** — no new
HTTP endpoint, request, response field, header, or push payload. The server is
untouched and remains unable to distinguish a hidden conversation from a visible
one (Zero-Knowledge Impact, spec).

> **Wire contract**: *none.* Confirmed against the zero-knowledge boundary
> (Principle I). The only thing that crosses the wire is the hidden conversation's
> normal sealed group traffic, identical to any other group.

What follows is the **client-internal API surface** the implementation introduces
and the call sites it edits — the "contract" other modules and the e2e tests rely
on. Signatures are indicative (TypeScript), to be finalized in implementation.

## New module: `src/services/hidden-chats.ts`

```ts
// ── Membership (master-key-wrapped set; requires unlocked app) ──
export async function getHiddenSet(): Promise<Set<string>>;        // ids hidden on this device
export async function isHidden(chatId: string): Promise<boolean>;
export async function addHidden(chatId: string): Promise<void>;    // hide existing conversation
export async function removeHidden(chatId: string): Promise<void>; // unhide

// ── Separate dedicated PIN (mirrors identity.ts wrapSecret/verifyPin) ──
export async function hasHiddenPin(): Promise<boolean>;
export async function enableHiddenPin(pin: string): Promise<void>;
export async function changeHiddenPin(oldPin: string, newPin: string): Promise<void>;
export async function verifyHiddenPin(pin: string): Promise<boolean>; // = decryption success
export async function hiddenPinLength(): Promise<number | null>;       // for auto-verify-at-length

// ── Destructive reset: wipe local history + block re-sync (this device only) ──
export async function resetHiddenChats(): Promise<{ wiped: string[] }>;

// ── Start a NEW distinct hidden conversation (US2 coexistence) ──
export async function startHiddenChat(contactId: string): Promise<string>; // returns groupId, added to set
```

**Guarantees**:
- `getHiddenSet`/`isHidden` resolve from the master-key-wrapped blob; callable by
  the page **and** the service worker (post device-unlock). If the app/SW cannot
  unlock, callers treat *everything* as "preview-suppressed" (fail-safe).
- `verifyHiddenPin` never reveals whether any chats are hidden on failure.
- `resetHiddenChats` deletes messages/sessions/sender-keys/chat-rows for every
  hidden id, records a **local-only** do-not-resync block per id, clears the set
  and PIN material, and returns the wiped ids (for UI confirmation/logging — never
  sent anywhere).

## New composable: `src/composables/useHiddenChats.ts`

```ts
export function useHiddenChats(): {
  revealed: Ref<boolean>;                 // in-memory reveal session state
  reveal(pin: string): Promise<boolean>;  // verify → start session (+ grace timer)
  revealWithBiometric(): Promise<boolean>;// if enabled+available; falls back to PIN
  relock(): void;                         // explicit re-hide
  // internally: visibilitychange + grace-window timer (mirrors useAutoLock);
  // ALWAYS starts locked on cold load; full close re-locks.
};
```

## Edited choke points (existing code)

| Module | Change | Anchor |
|---|---|---|
| `src/db/queries.ts` `listChats()` | Exclude ids in the hidden set unless a reveal session is active | `:54` |
| `src/db/queries.ts` `listCallGroups()` | Filter calls whose `contactId` ∈ hidden set; exclude from missed-call badge | `:1878`, `:1953` |
| `src/services/chat-filters.ts` | Inherits exclusion via `listChats` (no per-chip change needed) | `chatMatchesFilter` |
| `src/services/sw-inbox.ts` `noteForPayload()` | If chat ∈ hidden set → generic note (no sender/avatar/body) + `url:'/tabs/chats'` | `:138-224`, `:219` |
| `src/services/ownsync.ts` `pullOwnData()` | Skip ingest for ids in the local-only do-not-resync block | `:172` |
| `src/db/tombstones.ts` | Add local-only ("do not upload") tombstone variant | — |
| `src/composables/useCall.ts` | Generic caller identity in `callMeta` when originating chat ∈ hidden set (incoming + call-waiting) | `:1663-1673` |
| `src/components/ChatActionsSheet.vue` | "Hide chat" / "Unhide" action | action list |
| `src/views/tabs/ChatsPage.vue` | PIN-in-searchbar reveal gesture; show hidden chats while revealed | `:13-17` |
| `src/settings/schema.ts` | `privacy-hidden-chats` screen (enable, set/change PIN, reset PIN [danger+confirm], biometric, grace choice) | `privacy` node |

## Behavioral contracts (testable assertions)

These map directly to spec FR/SC and become the test oracles:

1. **Exclusion is total**: a hidden id never appears from `listChats()`,
   `listCallGroups()`, chat search, any picker, or a notification preview.
   *(FR-002/007/019, SC-001/002)*
2. **Wire-identical**: the synced `chats` row for a conversation is byte-identical
   before and after hiding it. *(FR-009/014, SC-004/005)*
3. **Reveal requires the dedicated PIN**: `listChats()` includes hidden ids only
   while `revealed === true`; a wrong PIN yields no reveal and no signal.
   *(FR-004, SC-006)*
4. **Cold start re-locks**: after `reveal()` then a simulated full close,
   `revealed` is `false` on next load and hidden chats are absent. *(FR-005, SC-009)*
5. **Coexistence**: `startHiddenChat(c)` leaves the existing 1:1 with `c` intact
   and listed; the two threads never merge. *(FR-017, SC-008)*
6. **Reset is permanent**: after `resetHiddenChats()`, the wiped conversations'
   local data is gone and a subsequent `pullOwnData()` does not re-add them.
   *(FR-016, SC-007)*
7. **Notifications fail safe**: if the SW cannot unlock, hidden (and all) previews
   are generic — never a leak. *(FR-007)*
