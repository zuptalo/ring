# Internal Module Contracts: 1027 Harden Hidden Chats

**No HTTP/wire API changes.** The server is untouched; these are the client
module contracts that tasks and tests are written against.

## NEW `src/services/hidden-pair.ts` (pure leaf — no idb, no imports beyond types)

```ts
/** Plain 1:1s and pair conversations with this peer (multi-member groups never count). */
export function chatsWithPeer(chats: Chat[], peerId: string): Chat[]

/** Per-person one-hidden rule (INV-1). */
export function canHide(
  chats: Chat[], hidden: ReadonlySet<string>, chatId: string,
): { ok: true } | { ok: false; reason: string }

/** Per-person one-visible rule (INV-2). */
export function canUnhide(
  chats: Chat[], hidden: ReadonlySet<string>, chatId: string,
): { ok: true } | { ok: false; reason: string }

/** Rule R stage 1 (pre-decrypt session resolution, steps S1–S2) as a pure
 *  function; null → caller consults the peer block / creates. Never returns a
 *  pair conversation (those carry no 1:1 session; group content routes by
 *  groupId post-decrypt). */
export function resolveInboundDirectChat(
  chats: Chat[], hidden: ReadonlySet<string>, peerId: string,
): Chat | null
```

Contract notes:
- Deterministic, synchronous, no side effects — unit-tested exhaustively
  including the legacy INV-3-violating state (hidden + visible plain 1:1).
- `reason` strings are the user-facing copy (UI voice rules apply: warm, plain,
  "you", no em-dashes/semicolons).

## CHANGED `src/db/queries.ts`

```ts
/** Existing signature, new behavior: if a hidden chat with this peer exists,
 *  creates/returns the VISIBLE PAIR CONVERSATION (group-modeled) instead of a
 *  second plain 1:1; also lifts any 'hiddenPeer:' block (explicit re-engagement). */
export async function startDirectChat(contact: Contact): Promise<string>

/** Existing function, new resolution: rule R replaces the internal
 *  startDirectChat call; step 4 acks+drops on a 'hiddenPeer:' tombstone with no
 *  rekey and no writes. */
async function receiveIncomingInner(from, remoteId, ciphertext): Promise<void>

/** Existing signature; new: persists 'badge.lastCount' on success and returns it
 *  (never 0-collateral) when the hidden set is unknown in never/revealed modes. */
export async function countUnread(): Promise<number>
```

## CHANGED `src/services/hidden-chats-reset.ts`

```ts
/** Additionally records localOnly 'hiddenPeer:<peer>' tombstones for each hidden
 *  plain-1:1 peer BEFORE deleting data (same FR-024 ordering). */
export async function resetHiddenChats(): Promise<{ wiped: string[] }>
```

## CHANGED `src/services/hidden-state.ts`

```ts
/** NEW: register a callback fired on every transition to revealed=false and on
 *  clearHiddenState — the router uses it to leave an open hidden conversation. */
export function registerRelockHook(fn: () => void): void
```

(Leaf discipline preserved: the router imports the leaf, never the reverse.)

## CHANGED `src/router/index.ts`

- Registers the relock hook: active route is a hidden conversation →
  `router.replace('/tabs/chats')`.
- `beforeEach`: navigation to a hidden conversation while not revealed →
  redirect `/tabs/chats` (deep links, notification taps, back-stack).

## CHANGED `src/services/notify.ts`

- The hidden-chat branch's backgrounded-but-connected generic
  `notifyLocal('Ring','New message',…)` bridge is removed; that path is silent
  (badge only). Foreground claim behavior unchanged.

## CHANGED `src/services/sw-inbox.ts`

```ts
/** Existing signature; new: applies privacy.hiddenChatsBadge ('revealed' ≡
 *  'never' in the SW), excludes hidden chats via readHiddenSet(), falls back to
 *  'badge.lastCount' when the set is locked, and never counts a pending frame it
 *  cannot classify as non-hidden. */
export async function unreadCount(): Promise<number>
```

- `noteForPayload` hidden branch: unchanged behavior, now pinned by tests —
  byte-identical to the previews-off generic (`Ring` / `New message` /
  `/tabs/chats`) and evaluated before mention/mute/content branches.

## CHANGED `src/components/ChatActionsSheet.vue`

- Hide/Unhide entries consult `canHide`/`canUnhide`; a blocked action renders
  disabled with the reason as its note text (stock Ionic action sheet only).

## UNCHANGED (contract pinned by tests)

- `hidden-chats.ts` public API (set + PIN + verifier semantics).
- `hidden-calls.ts` (`hiddenCallKeys`) and the call-history exclusion.
- The incoming-call overlay: full caller identity for hidden peers (knock-knock)
  — asserted by a new e2e, no code change.
- `messaging.ts` — not modified at all.
