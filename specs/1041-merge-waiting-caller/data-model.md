# Data Model: Merge a waiting caller into the ongoing call (spec 1041)

No new persisted entities, no schema change, no server change. Everything is
in-memory call-session state over existing sealed signalling.

## Sealed inner signals (existing `CallSignal`, four new `type` values)

Carried inside `call-ice` frames like `hold`/`resume`/`qos`/`joinroom` —
opaque to the server.

| type | Sender → receiver | Fields used | Meaning |
|---|---|---|---|
| `joinreq` | callee → waiting/held party | `callId` (their attempt/held call), `roomId` (pre-minted or existing), `kind` (ongoing call's kind) | "Join my ongoing call instead?" |
| `joinreq-accept` | party → callee | `callId`, `roomId` | They chose to join; they convert their attempt into the room with their OWN media kind |
| `joinreq-reject` | party → callee | `callId`, `roomId` | They wait behind the line; callee blocks further requests to them for this call |
| `joinreq-cancel` | callee → party | `callId`, `roomId` | Withdrawal: the ongoing call ended / merge no longer applies |

## Join request (pure module `call/join-request.ts`, per ongoing call)

Callee-side state, in-memory, dies with the call:

| Field | Notes |
|---|---|
| `roomId` | minted at first request (or the ongoing group call's roomId) |
| `pending` | map partyId → their attempt `callId` (an outstanding request) |
| `rejected` | set of partyIds — rejection-final for THIS call (FR-009/FR-011) |

Rules (vitest-pinned):

- `canRequest(party)` = not in `rejected`, no `pending[party]`, capacity
  allows one more (`canAdd`), party is a waiting (`incomingSecond`) or held
  (`heldSlot`) 1:1 party.
- `reject(party)` moves pending → rejected; hold/swap/decline unaffected.
- `accept(party)` clears pending; the join proceeds via existing machinery.
- Call teardown → cancel every `pending` (send `joinreq-cancel`), drop all
  state.
- Waiting attempt dies (cancel/timeout/hang-up) → its pending entry clears
  silently (no cancel needed — their device dismissed with the attempt).

Accepter-side state: one nullable prompt ref
`{ from, roomId, callId, roomKind }` raised by `joinreq` (or by a bare
`joinroom` from an old sender while still dialing — see contract), dismissed
by accept/reject/`joinreq-cancel`/attempt teardown.

## Consent + media on accept (clarification A)

The accepter converts their OWN outgoing attempt into the room via the
existing `convertActiveToRoom(roomId, ownAttemptKind, …)`, reusing their
captured stream: audio attempt → mic only (camera off in a video room),
video attempt → camera on. No second `getUserMedia` (WebKit constraint), no
capture the party didn't already offer.

## UI state touched (CallActivePage)

- Second-incoming prompt: "Add to call" button now sends a `joinreq` (label
  reads as an invitation, e.g. "Invite to this call") and is hidden/disabled
  for a `rejected` party; Accept & hold / Decline unchanged.
- Held bar: gains a "bring into this call" affordance with the same gating.
- Accepter: consent alertdialog over the outgoing-call screen (cw-prompt
  idiom): Join / Stay waiting.
- Waiting-party tile/state on the callee side is unchanged until an accept
  actually lands them in the roster (existing join semantics).

## Avatar fix (US4)

`.tile-avatar` gains `height: auto` so `aspect-ratio: 1` governs again
(UserAvatar's internal `img/.ua { height:100% }` currently wins because the
override sets width only — both dimensions set ⇒ aspect-ratio ignored ⇒
ellipse). Applies to camera-off, pending, and leaving (waving-hand) tiles,
every layout and orientation. No markup change.
