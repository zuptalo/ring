# Phase 0 Research: Robust Calls + Add-to-Call

**Spec**: [spec.md](./spec.md) | **Date**: 2026-07-02

This feature extends live WebRTC **mesh** calling — the most fragile part of the
app. The research goal is a design that reuses proven machinery (mesh join,
serialized roster, late-joiner legs, consent-gated upgrade, invite recovery) and
adds **no new server capability**, so the risk is contained to well-scoped client
seams. Every decision below is anchored to the current code.

## R1. Current mechanics (audit, file:line)

- **Caps already exist**: `VIDEO_MAX=4`, `AUDIO_MAX=8` (`src/services/call/types.ts:10-11`);
  server mirror + authoritative enforcement `registry.go` `JoinIfRoom` (over-cap join
  refused, `call-full` to joiner only; an already-present user is always re-admitted).
  Audio→video upgrade already blocked above `VIDEO_MAX`.
- **1:1 calls are a bare `RTCPeerConnection`**, not a `MeshSession` (`useCall.ts`
  `handleOffer`/`acceptCall`/`startDirectCall`). **Group calls are a `MeshSession`**
  (`src/services/call/mesh.ts`) keyed by a `roomId`.
- **Mesh join / roster / late-join**: `MeshSession.start` sends `call-join`
  (`mesh.ts:207`); the server rings the initiator's `members` and `broadcastRoster`s;
  each client's `onRoster` → `applyRoster` (`mesh.ts:225`) opens a leg to each new peer
  (`buildLeg`) and closes departed legs — **serialized through `rosterChain`** so
  bursts never interleave. A late joiner already meshes with everyone (e2e-tested).
- **Ringing a new id into a room**: server `call-ring` handler requires the sender be
  `InRoom` and rings an arbitrary `To`, broadcasting `ringing` room-wide
  (`hub.go:1581`). The client already **inserts an unknown id into `meta.invited`** on
  a `call-member` `ringing` broadcast (`useCall.ts:2995-2999`). Today only
  `recallMember` (`useCall.ts:1506`, re-ring an original invitee) and `cancelInvite`
  use this — never for a brand-new id.
- **Hold/swap (spec 0005)**: `acceptAndHold`/`parkActiveAsHeld`/`swapCalls`; single
  `heldSlot`; hold rides a **sealed `CallSignal` inside an existing `call-ice` frame**
  (`sendHoldResume`, `signalling.ts:88`) — the proven pattern for a new control signal
  with **no new server frame**. Second-incoming uses the single `incomingSecond` slot.
- **Consent-gated video upgrade**: `requestVideoUpgrade`/`acceptUpgrade`/`rejectUpgrade`
  (`useCall.ts:2569-2593`), `call-upgrade-*` frames relayed by the server.
- **Shared capture on the second call**: `MeshSession.start(existing)` reuses an
  already-captured stream instead of a second `getUserMedia` (`mesh.ts:188-201`) —
  exactly what a merge needs (one capture per device).

## R2. Decision — promotion architecture (1:1 → mesh), the crux

**Decision**: Promotion is a **sealed control signal + a fresh mesh room**, not an
in-place migration of the existing 1:1 `RTCPeerConnection`.

Flow to promote a 1:1 with peer P to a group and add new caller/contact N:
1. Promoter mints `roomId = uid()`, constructs `MeshSession(roomId, kind, cb,
   members=[])` and `start(existingStream)` — **reusing the current capture** (no
   second gUM), sending `call-join` (no members → a plain join, the promoter is first
   into the room).
2. Promoter sends a **sealed `CallSignal { type: 'joinroom', roomId, kind }`** to P
   over their existing 1:1 `call-ice` channel (the `sendHoldResume` pattern). P's
   device auto-joins the room (`MeshSession(roomId).start(existingStream)`, `call-join`
   no members), tears its old 1:1 PC down once its mesh leg connects, and shows the
   "{name} joined the call" cue (FR-002 / SC-008).
3. The server `broadcastRoster`s as each joins; `applyRoster` builds the P↔promoter
   leg **fresh inside the room** (reuses the proven late-join path — no PC migration).
4. Bringing in N differs by source:
   - **Add-people (US2)**: N is rung via `call-ring` (`inviteToRoom`), joins normally.
   - **Merge-incoming (US1)**: N is the caller who just rang us on a 1:1. Instead of a
     1:1 answer we reply with the same sealed `joinroom` signal (over N's incoming
     1:1 `call-ice`/answer channel); N joins the room; their original 1:1 offer is
     superseded.

**Why not migrate the existing PC into a mesh leg**: reusing an established
`RTCPeerConnection` as a room leg means rewriting its signalling identity and racing
renegotiation — far more fragile. Rebuilding the pair leg inside the room reuses the
exact code a late joiner already exercises (proven, e2e-covered). The one-time cost is
a brief renegotiation of the existing pair, which is acceptable.

**No server change**: `joinroom` is an opaque sealed `CallSignal` (like hold/resume);
`call-join`/`call-ring`/`broadcastRoster`/`JoinIfRoom` already exist. The server sees
a group room forming — a shape it already handles.

**Alternatives considered**: (a) server-side "promote 1:1 to room" frame — rejected,
adds server capability for no gain; (b) migrate the live PC — rejected, fragile.

## R3. Decision — one shared primitive for both new capabilities

**Decision**: Both merge and add-people compose two primitives:
- `ensureActiveIsRoom()` — if the active call is a 1:1, run R2's promotion (idempotent
  once it's already a room).
- `inviteToRoom(ids: string[])` — cap-gate, add each to `meta.invited`, `call-ring`
  each into the room; the roster/leg machinery meshes them on accept.

Then:
- **US2 add-people** = `ensureActiveIsRoom()` → `inviteToRoom(pickedIds)`.
- **US1 merge-incoming direct caller** = `ensureActiveIsRoom()` → send `joinroom` to
  the incoming caller (they join instead of a 1:1 answer).
- **US6 merge group invite** = `ensureActiveIsRoom()` → `inviteToRoom(inviteRoster
  minus already-present)`, then decline the incoming invite room (`call-leave`),
  subject to the combined-headcount cap.

This keeps the new surface tiny and funnels every add through the same cap gate and
the same mesh join.

## R4. Decision — pre-emptive cap gate (pure, tested)

**Decision**: a pure helper `src/services/call/capacity.ts`:
- `capOf(kind)` → `VIDEO_MAX | AUDIO_MAX`.
- `remainingSlots(kind, roster, invited)` → cap − |distinct(roster ∪ invited ∪ self)|.
- `canAdd(kind, roster, invited, n)` → `{ ok } | { ok:false, reason }` (kind-specific
  copy).
The add-people picker disables selections past `remainingSlots`; merge/add actions call
`canAdd` before ringing (FR-010/FR-011). The server `JoinIfRoom` stays the backstop.
For US6, `canAdd` is evaluated over the **combined distinct** headcount of both rosters.

## R5. Decision — kind reconciliation on merge (reuse the upgrade flow)

**Decision**: no new mechanism. After a merge completes the join:
- If the merged party (or the active call) wants video AND the combined headcount ≤
  `VIDEO_MAX`, run the **existing consent-gated `requestVideoUpgrade`** so each
  participant opts in — exactly today's flow (`useCall.ts:2569`).
- If the combined headcount > `VIDEO_MAX`, no upgrade: the merged party joins
  audio-only and the call stays audio (reuses the existing above-cap upgrade block).
A video call absorbing an audio participant keeps video; that participant may enable
their camera under the same consent flow. (Clarification 2.)

## R6. Decision — the existing-peer cue (US1 / SC-008)

**Decision**: on receiving `joinroom` (P's promotion) and on a new roster member
appearing after promotion, show a transient "{name} joined the call" toast via the
existing cue/toast infra — no consent prompt (Clarification 1). Reuses the goodbye-wave
sibling pattern (roster diffs already drive tile add/remove animations).

## R7. Decision — robustness pass (FR-013/014, US5)

**Decision**: lean on existing serialization + set semantics; fix the identified gaps:
- **Cap race** (audit fragility #3): today a mid-call add would only fail server-side
  with `call-full`; the R4 pre-emptive gate closes it.
- **Concurrent join/leave & simultaneous same-person add**: `rosterChain` serializes
  roster application; `applyRoster` is set-based (idempotent — a duplicate add resolves
  to one leg). `inviteToRoom` dedups against `roster ∪ invited`.
- **Invitee reload mid-ring**: reuses spec 2012 invite-recovery unchanged (the added
  invite is an ordinary ring).
- **Add-then-swap** (FR-014): merge/add act only on the ACTIVE call; `heldSlot` is
  untouched. Add a guard so an add in flight completes (or is cancelled cleanly) before
  a swap parks the call — no half-open leg.
- **Promotion interrupted** (promoter or P drops mid-promote): if P never joins the
  room, the promoter's room still forms (P simply appears offline/ringing); define a
  timeout that falls back to leaving the half-formed room rather than a stuck state.

## R8. Decision — no server changes (verify in implementation)

**Decision**: target **zero** server changes. `call-join`, `call-ring` (in-room sender
rings arbitrary To), `broadcastRoster`, `JoinIfRoom` (cap backstop), and opaque sealed
`call-ice` relay already cover promotion + invite. A task explicitly **verifies** no
`server/` change is needed (and that `go test ./...` stays green untouched); if a gap
is found, it is raised before adding any server capability (constitution I/VI).

## R9. Decision — SFU comment cleanup (FR-016)

**Decision**: correct the misleading "SFU" comments (`useCall.ts:~1346`, `~1526`) to
say "mesh session"; grep the tree for dead SFU identifiers and remove any unreachable
remnants. No behaviour change; covered by the existing suite staying green.

## R10. Decision — testing under the CI constraint

**Decision**:
- **Unit (vitest)**: the pure `capacity.ts` helpers; a pure roster/merge decision
  module (`ensureActiveIsRoom`/`inviteToRoom` planning as pure functions where feasible).
- **e2e (Playwright)**: on **audio** meshes (3–4 people) + 2-person proxies — merge an
  incoming caller into a 1:1 → 3-way audio; add-a-person to an ongoing audio call and
  assert a non-initiator also meshes; the pre-emptive cap gate blocks the 5th video /
  9th audio; merge leaves a held call intact; group-invite merge fits vs. blocked.
- **drive scenarios**: the **video** path (`group-call-4.mjs` extended) + a promote-1:1
  →video-3-way scenario for real-device/interactive validation.
- **Never** a 3-person video mesh in headless CI (documented flaky —
  `e2e/call-quality.spec.ts:44-51`).

All NEEDS CLARIFICATION resolved (the three clarify answers are folded into R2/R5/R3).
