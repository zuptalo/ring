# Internal Module Contracts: 1030 Finish Add-to-Call

**No HTTP/wire API change.** Server untouched (a task asserts an empty `server/` diff).
No new sealed signal (1028's `joinroom` is reused). These are the client module contracts.

## NEW `src/services/call/merge-kind.ts` (pure leaf)
```ts
import { VIDEO_MAX, type CallKind } from './types';
/** Is the call video-capable after a merge? (US1) True = the per-participant "Turn on
 *  video" control is offered; never auto-enables a camera. */
export function videoCapableAfterMerge(activeKind: CallKind, combinedHeadcount: number): boolean;
```

## NEW `src/services/call/join-cue.ts` (pure leaf)
```ts
/** Roster members to announce as new joiners (US2): not self, not already announced. */
export function newJoiners(announced: ReadonlySet<string>, roster: string[], selfId: string): string[];
```

## CHANGED `src/composables/useCall.ts`
```ts
/** US3 — merge the pending incoming GROUP INVITE into the current call. */
export async function mergeGroupInvite(): Promise<void>;
```
- `handleGroupInvite`: when `callState !== 'idle'` AND `canRaiseSecondIncoming()`, raise
  `incomingSecond` as `kind:'group'` (roomId + members) instead of `sendGroupBusy`; keep
  auto-busy when no slot is free.
- `call-roster` handler: before assigning `callMeta.roster`, announce `newJoiners(...)`
  via `appToast`; maintain a per-call `announced` set (reset on new call).
- `mergeIncoming` / a merge completion: apply `videoCapableAfterMerge` — no new UI when
  false; when true the existing "Turn on video" affordance already applies (no code beyond
  ensuring `meta.kind`/roster are correct so `toggleVideoMode` gates right).
- `addInFlight` guard: set around `ensureActiveIsRoom`+`inviteToRoom`; `swapCalls` /
  `parkActiveAsHeld` await it (or no-op with a toast) so a swap can't race a promotion.
- Export `mergeGroupInvite` in the `useCall()` accessor + a testhook.

## CHANGED `src/views/detail/CallActivePage.vue`
- The second-incoming prompt shows **Add to call** for a `kind:'group'` invite too
  (currently only `kind:'direct'`), wired to `mergeGroupInvite`; Hold + Decline unchanged.

## UNCHANGED (contract pinned by the suite staying green)
- `server/` — no diff.
- `toggleVideoMode`, `addVideoTrack`, the roster/leg machinery, hold/swap/drop, `heldSlot`.
- 1028's `ensureActiveIsRoom` / `mergeIncoming` / `inviteToRoom` / `sendJoinRoom` /
  `capacity` / `invite-plan` — reused, not modified (beyond the guard + group path).
- Crypto core / `messaging.ts` — untouched; no new signal.
