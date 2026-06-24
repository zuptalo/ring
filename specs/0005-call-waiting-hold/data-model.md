# Data Model: Call waiting — hold, swap & drop

Phase 1 for spec 0005. All state is **client-side, in-memory** (call state lives in
`useCall.ts`, not IndexedDB or Postgres) except the unchanged call-history rows. No new
persisted stores, no new server tables. The server gains no new state — it keeps relaying
sealed signals and tracking room membership + call kind.

## Entities

### CallSlot (in-memory)

One of at most two concurrent calls the local user holds. Exactly one slot is `active`
(live media both ways) and at most one is `held` (paused). Each slot owns the connection
objects for its call.

| Field            | Type                                   | Notes |
|------------------|----------------------------------------|-------|
| `meta`           | `CallMeta`                             | The existing call metadata (callId/roomId, kind, direction, peer/roster, name, …). |
| `pc`             | `RTCPeerConnection \| null`            | Set for a 1:1 call. |
| `groupSession`   | `MeshSession \| null`                  | Set for a group (mesh) call. |
| `held`           | `boolean`                              | True when this slot is paused (the `held` slot). |
| `remoteHeld`     | `boolean`                              | True when the OTHER side put US on hold (we render "on hold" to ourselves). |

Invariants:
- At most **2** slots exist at once (one `active`, one `held`); a third incoming call is
  refused busy (FR-008).
- The `active` slot's senders carry the live mic/camera tracks; the `held` slot's senders
  carry `null` (Decision 1). Swapping moves the live tracks between slots.
- Implementation note: the `active` slot continues to use today's singleton refs in
  `useCall` (`pc`/`groupSession`/`callMeta`); the `held` slot is a parked holder of the same
  shape. No general N-slot collection.

### HoldState (per call, both sides)

Whether a call is paused and from whose perspective.

| Value            | Meaning |
|------------------|---------|
| `live`           | Normal, media flowing both ways. |
| `self-held`      | I have this call on hold (I paused my send + render; I told the other side). |
| `remote-held`    | The other side has me on hold (they paused; I show "on hold" and pause my send to them). |

Surfaced in the UI: a `self-held` call shows as the tap-to-swap "On hold" bar; a
`remote-held` 1:1 shows the peer as "on hold", and in a group every other member sees the
holder's tile as "on hold" while the rest of the group stays `live` among themselves.

### Call (history — unchanged shape)

The existing `Call`/`CallLog` rows (spec 0004). **No schema change.** A held-then-resumed
call is still ONE call: hold/resume/swap do not write history; only the final teardown logs
(FR-010).

## State transitions (the active/held pair)

```
            ┌───────────────────────────── second call arrives, slot free ─────────────────────────────┐
            │                                                                                            ▼
[ idle ] ──(start/accept)──> [ 1 call: active ] ──(Accept & hold)──> [ 2 calls: active=new, held=old ]
            ▲                       │   ▲                                   │        │
            │                       │   │                                   │        │ swap
            │              drop the │   │ remote/own                        │        ▼
            │              only call│   │ resume (n/a:                      │   [ active⇄held exchanged ]
            │                       ▼   │ single call)                      │        │
            └──────── teardown ◀────┘   └───────────────────────────────────┘        │
                                                                                      │
   drop ACTIVE  ─────────────────────────────────────────> held resumes → [ 1 call: active ]
   drop HELD    ─────────────────────────────────────────> active undisturbed → [ 1 call: active ]
   remote ends HELD while held ──────────────────────────> held slot freed, user informed → [ 1 call: active ]
   third call arrives while 2 calls ─────────────────────> busy reply; no prompt (state unchanged)
```

Edge transitions (from research Decision 8):
- **Hold during setup**: a still-ringing OUTGOING first call is cancelled (not parked) when
  accepting the second; a still-connecting call is parked and resumes/cancels per its own
  outcome.
- **Held network blip**: the held call follows the spec 0004 grace/recovery; death past grace
  frees the held slot and informs the user (no auto-recall).
- **Resume**: a resumed call's adaptive-quality controller restarts at the low tier.

## Zero-Knowledge Impact

- **What crosses the wire**: hold/resume are sealed `CallSignal`s (`type: 'hold'|'resume'`,
  carrying only the call/room id for routing of the already-sealed payload) over each pair's
  Double Ratchet — 1:1 to the peer, per-leg for the mesh. No media flows for a held call.
- **What is encrypted**: the hold/resume signal payload, exactly like offer/answer/ICE today.
- **Unavoidable server-visible metadata**: only what the relay already sees — that a sealed
  call signal was relayed between two room members. The server CANNOT tell a hold from any
  other sealed signal, so it never learns which of a user's calls is active vs held (FR-012).
- **No new persistence**: no IndexedDB store, no `DB_VERSION` bump, no Postgres migration, no
  `SECRETS_KEY` impact. Call-history rows are unchanged.
