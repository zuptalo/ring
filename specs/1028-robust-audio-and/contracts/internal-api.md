# Internal Module Contracts: 1028 Robust Calls + Add-to-Call

**No HTTP/wire API change intended.** The server is untouched (a task verifies this).
The only new *wire* element is a sealed `CallSignal` variant carried inside the
existing `call-ice` frame — opaque to the server. These are the client module
contracts tasks and tests are written against.

## NEW `src/services/call/capacity.ts` (pure leaf — no WebRTC, no imports beyond types)

```ts
import { VIDEO_MAX, AUDIO_MAX, type CallKind } from './types';

export function capOf(kind: CallKind): number; // video→4, audio→8

/** Distinct heads currently occupying slots: roster ∪ invited ∪ self. */
export function headcount(roster: string[], invited: string[], selfId: string): number;

export function remainingSlots(
  kind: CallKind, roster: string[], invited: string[], selfId: string,
): number;

/** Pre-emptive add gate (FR-010/FR-011). Reason copy is kind-specific and user-facing. */
export function canAdd(
  kind: CallKind, roster: string[], invited: string[], selfId: string, n: number,
): { ok: true } | { ok: false; reason: string };
```

Deterministic, synchronous, exhaustively unit-tested (incl. invited-counts-against-cap,
combined headcount for US6, and the 5th-video / 9th-audio boundaries).

## CHANGED `src/services/call/signalling.ts`

```ts
/** Promote/merge control: tell a peer to join a mesh room, sealed inside a call-ice
 *  frame (the sendHoldResume pattern — no new server frame). */
export function sendJoinRoom(
  chatId: string, peerUserId: string, callId: string, roomId: string, kind: CallKind,
): Promise<boolean>;
```

- Plus: correct the misleading "SFU" doc comments (no behaviour change).

## CHANGED `src/composables/useCall.ts`

```ts
/** Promote the ACTIVE 1:1 into a mesh room (idempotent if already a room). Reuses the
 *  live capture; sends joinroom to the existing peer; tears down the 1:1 PC on leg
 *  connect. Resolves once the room is live locally. */
async function ensureActiveIsRoom(): Promise<void>;

/** Ring ids into the ACTIVE room after cap-gating + dedup (adds to meta.invited). */
async function inviteToRoom(ids: string[]): Promise<void>;

/** US2 — user picked contacts to add to the current call. */
export async function addPeople(ids: string[]): Promise<void>;

/** US1 — accept the current incoming DIRECT caller INTO the active call (merge). */
export async function mergeIncoming(): Promise<void>;

/** US6 — merge the current incoming GROUP INVITE into the active call. */
export async function mergeGroupInvite(): Promise<void>;

/** Remaining capacity for the active call, for gating the picker/actions in the UI. */
export function callRemainingSlots(): number;
```

- `handleCallFrame` / `handleMeshSignal` / the `call-ice` dispatch gains a `joinroom`
  case: auto-join the room, reuse the stream, show the cue.
- The join cue: transient "{name} joined the call" via the existing toast/cue infra.
- SFU comment cleanup (`~L1346`, `~L1526`).

## CHANGED `src/services/transport.ts`

- Extend the `CallSignal` union with `{ type: 'joinroom', roomId, kind }` (sealed
  payload only; no new transport *frame* type — it rides `call-ice`).

## CHANGED UI

- `src/components/IncomingCallOverlay.vue`: an **Add to call** action shown when you're
  already in a call — for a direct caller (→ `mergeIncoming`) and a group invite (→
  `mergeGroupInvite`), alongside the existing Hold/Decline.
- `src/views/detail/CallActivePage.vue`: an **Add people** button opening the existing
  contact picker, gated by `callRemainingSlots()`; confirm → `addPeople(ids)`.

## UNCHANGED (contract pinned by the suite staying green)

- `server/` — no diff (verified).
- `mesh.ts` public surface (`start`/`onRoster`/`buildLeg`/hold/resume) — the add path
  drives it via the server roster only.
- Hold/swap/drop (`acceptAndHold`/`swapCalls`/`heldSlot`) — untouched by merge/add.
- The consent-gated upgrade (`requestVideoUpgrade`) — reused as-is for kind reconciliation.
- The crypto core / `messaging.ts` — not modified.
