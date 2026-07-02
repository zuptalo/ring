# Data Model: Robust Calls + Add-to-Call

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-07-02

Calls are ephemeral (no IndexedDB change). This defines the in-memory entities the
new flows touch, the capacity rule, the new sealed signal, and the promotion state
machine.

## Entities (existing, reused)

### CallMeta (`src/services/call/types.ts`, unchanged shape)
- `isGroup`, `kind` (`'audio'|'video'`), `roomId?`, `roster: string[]` (in the room),
  `invited?: string[]` (rung, not yet joined), `peerUserId?`/`chatId?` (1:1).
- A **1:1** has `isGroup:false`, no `roomId`, a bare `RTCPeerConnection`.
- A **group** has `isGroup:true`, a `roomId`, a `MeshSession`.
- **Promotion** turns the former into the latter in place (same `CallMeta` object gains
  `roomId`, `isGroup:true`, and `roster` grows).

### MeshSession (`src/services/call/mesh.ts`, reused)
- Owns per-pair legs; `start(existing?)` reuses a captured stream; `onRoster` →
  `applyRoster` (serialized, set-based) opens/closes legs. No shape change; the add path
  drives it purely by growing the server roster.

### HeldSlot (spec 0005, unchanged)
- At most one held call. **Never** touched by merge/add (which act on the active call).

## Capacity (new — pure)

```
capOf(kind)                         = kind === 'video' ? VIDEO_MAX(4) : AUDIO_MAX(8)
headcount(roster, invited, self)    = |distinct(roster ∪ invited ∪ {self})|
remainingSlots(kind, roster, invited) = max(0, capOf(kind) − headcount(...))
canAdd(kind, roster, invited, n)    = n ≤ remainingSlots(...)  → {ok}
                                      else {ok:false, reason:"<kind>-specific copy"}
```

- **Invited counts against capacity** (a ringing placeholder holds a slot) so two
  concurrent adds can't both squeak past the cap.
- **US6 (group-invite merge)** evaluates `canAdd` over the **combined distinct** headcount
  of both rooms' rosters+invited.
- Server `JoinIfRoom(roomId, userId, capOf(kind))` remains the authoritative backstop.

## New sealed signal: `joinroom`

A new `CallSignal` variant, carried **inside an existing `call-ice` frame** (the
hold/resume/qos pattern — no new server frame, opaque to the server):

```
CallSignal { type: 'joinroom', roomId: string, kind: CallKind }
```

- **Sender**: the promoter (to the existing 1:1 peer) and, for merge-incoming, to the
  incoming caller.
- **Receiver action**: join the mesh room (`MeshSession(roomId, kind).start(sharedStream)`,
  `call-join` with no members), tear down the prior 1:1 PC once the mesh leg connects,
  and show the "{name} joined the call" cue.
- Sealed over the pair's Double Ratchet (`sealForChat`/`openPacket`); the server relays
  ciphertext and learns only that a room is forming (already true for group calls).

## Promotion state machine (per device)

```
Active call kinds:  ONE_TO_ONE ──promote──▶ ROOM (mesh)
```

| From | Event | Guard | To | Effects |
|---|---|---|---|---|
| ONE_TO_ONE | `ensureActiveIsRoom()` (add/merge initiated) | active is 1:1 | ROOM | mint roomId; MeshSession.start(existingStream); send `joinroom` to peer; tear down 1:1 PC on leg-connect |
| ONE_TO_ONE | receive `joinroom` from peer | — | ROOM | auto-join room (reuse stream); tear down 1:1 PC on leg-connect; show cue |
| ROOM | `inviteToRoom(ids)` | `canAdd` passes | ROOM | dedup vs roster∪invited; add to invited; `call-ring` each |
| ROOM | roster member appears (post-promotion) | — | ROOM | `applyRoster` builds the leg; show cue for a genuinely new member |
| ROOM | invitee declines / times out | — | ROOM | remove from invited; drop ringing tile |
| any | promotion times out (peer never joins) | — | leave half-formed room cleanly | no stuck state |

Invariants:
- **INV-1**: at most one active call + one held call (unchanged); merge/add touch only
  the active one.
- **INV-2**: `headcount ≤ capOf(kind)` at all times, gated pre-emptively on the client and
  backstopped by the server.
- **INV-3**: exactly one capture (mic/cam) per device for the session; every promotion/add
  reuses the existing stream (`MeshSession.start(existing)`).
- **INV-4**: a member present in both a room roster and an incoming set resolves to a
  single participant / one leg (set semantics in `applyRoster` + `inviteToRoom` dedup).

## Kind reconciliation (merge)

```
after merge join:
  wantVideo = active.kind==='video' OR mergedParty.kind==='video'
  if wantVideo AND headcount ≤ VIDEO_MAX:  run existing consent-gated requestVideoUpgrade
  else:                                    stay audio; merged party audio-only
```

## Compose map (new client functions → primitives)

| User action | Composition |
|---|---|
| Add people (US2) | `ensureActiveIsRoom()` → `inviteToRoom(pickedIds)` |
| Merge incoming direct caller (US1) | `ensureActiveIsRoom()` → send `joinroom` to caller → kind reconcile |
| Merge incoming group invite (US6) | `canAdd(combined)` → `ensureActiveIsRoom()` → `inviteToRoom(inviteRoster − present)` → `call-leave` invite room |
