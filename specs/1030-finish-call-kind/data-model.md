# Data Model: Finish Add-to-Call

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-07-02

Calls are ephemeral (no IndexedDB change). This defines the two new pure decisions and
the in-memory state the four items touch.

## Pure decisions (new, unit-tested)

### videoCapableAfterMerge (US1)
```
videoCapableAfterMerge(activeKind, combinedHeadcount) ->
  activeKind === 'video'                    -> true   (already a video call)
  combinedHeadcount <= VIDEO_MAX (4)         -> true   (audio call, still fits video)
  else                                       -> false  (audio-only, > 4)
```
"true" means the call is video-capable (the per-participant "Turn on video" control is
offered); it NEVER auto-enables a camera. The merged video caller uses the same control.

### newJoiners (US2)
```
newJoiners(announced: Set<string>, roster: string[], selfId) -> string[]
  = roster members that are not selfId and not already in `announced`
```
Caller appends the result to `announced` and toasts "{name} joined the call" for each.
`announced` is per-call (reset when a new call starts). A reconnect doesn't change roster
membership, so a member is announced at most once per call.

## In-memory state (existing, reused / lightly extended)

- **CallMeta.roster / invited** — the roster update (`call-roster` handler) is the cue's
  hook and the source for the combined-headcount check.
- **incomingSecond** (`kind: 'direct' | 'group'`) — the single waiting slot. Newly USED
  for a group invite (US3): `handleGroupInvite` raises it here instead of auto-busy when a
  slot is free. Carries `roomId` + the invite's `members` for the fold.
- **heldSlot** — untouched by merge/add (US4 invariant).
- **addInFlight** (NEW, module-level) — a promise set while a promotion/add is converting
  the active call; `swapCalls`/`parkActiveAsHeld` await it so a swap can't race a promote.

## Group-invite merge fold (US3)

```
mergeGroupInvite():
  inc = incomingSecond (kind 'group', roomId=R, members=M)
  combined = distinct(currentRoster ∪ currentInvited ∪ self ∪ M)
  if canAdd over combined exceeds cap:  toast(reason); leave both unchanged; return
  ensureActiveIsRoom()                  # promote a 1:1 first (no-op if group)
  inviteToRoom(M − present)             # planInvite dedups; rings the newcomers
  sendGroupLeave(R)                     # leave the invite's own room (not in two rooms)
  incomingSecond = null
```
INV: a member in both M and the current call resolves to one participant/one leg
(`planInvite` dedup + set-based `applyRoster`). Blocked-when-over-cap leaves both calls
exactly as they were.

## Invariants

- **INV-1**: caps unchanged (4 video / 8 audio), pre-emptive client gate + server backstop.
- **INV-2**: single active + single held call; merge/add act only on the active call.
- **INV-3**: no camera is ever auto-enabled (video is per-participant opt-in).
- **INV-4**: a genuinely-new participant is announced exactly once per call; self and
  reconnects are never announced.
- **INV-5**: after a group-invite fold, the user is in exactly ONE room (the invite's room
  is left).
