# Research: Push Classes, Conversation Mutes & Notification Routing (spec 1050)

**Date**: 2026-07-14 · No NEEDS CLARIFICATION remain (three interactive sessions + checklist gate).

## R1. Where the push decision actually lives

`ws/hub.go` `case "msg"` (≈1237-1273): enqueue → live send → `if !isActiveFresh(to) || !sent
→ notifyAsync`. The decision is INLINE and per frame. **Decision**: add the class/prid gate
right there; never persist them. A held frame is indistinguishable from a delivered-live one
in storage — FR-007 falls out structurally. **Alternative rejected**: storing class in
`relay_queue` for later re-push — nothing re-pushes queued frames today; adding that would
be new machinery the spec doesn't want.

## R2. Push kinds already exist — extend, don't invent

`push/push.go` has four debounced kinds (msg/call/conn/post) with distinct TTLs/topics;
`Notify(userID)` is called only from the hub msg case; `NotifyConn` from connection
handlers (UNgated by presence — confirmed root cause of "pushed while in the app");
`NotifyPost(recipient)` per fan-out recipient (author unavailable at the gate today).
**Decisions**: thread `(class, prid)` through `Notify`; presence-gate `wakeConn` via the
hub interface the router already wires; extend `NotifyPost(recipient, author)`. Call sites
are few (grep-verified: 1 msg, 1 conn helper, 2 post, 2 post-activity).

## R3. Prefs live with the subscription row

`push_subscriptions` (0006, one-per-user since 0026) already carries per-device rows the
Notifier loads to send. **Decision**: `prefs JSONB NOT NULL DEFAULT '{}'` (migration 0028),
read in the same query, replaced whole via a small authenticated endpoint (`PUT
/v1/push/prefs`); `{}` = push everything = exact old behavior (FR-006/interop and FR-011
lifecycle both satisfied by residency in the subscription row).

## R4. Why prid must exist even for 1:1

For 1:1 the server already knows sender↔recipient, so a per-sender mute would suffice —
but it would ALSO mute that person's group messages (group frames arrive FROM the author;
the server has no group concept). Muting "the 1:1 with X" must not mute "X in our
shared group" ⇒ conversations need their own opaque handle. **Decision**: one prid per
conversation, all types. **Convergence**: minted by first up-to-date sender; shared inside
the sealed payload (`MessagePayload.prid`, adopt-on-receive); 1:1 double-mint resolves by
adopting the lexicographically smaller (both sides converge deterministically); prefs
re-register on adoption. Pre-convergence frames simply don't match any mute (today's
behavior, never worse — spec edge case).

## R5. Sender-side class computation has all its inputs already

The sender knows: reaction target's author + current reaction set (co-reactors —
`message.reactions`), mentions + reply target author per recipient (spec 1048 computes
this on receive; the SEND side has the same data), card types (create vs invite), and
removal vs add. `sealAndEnqueueGroup` fans out per member (per-recipient frames), so
per-recipient class assignment is a parameter, not a redesign. **Decision**: a pure
`classifyFrame(recipient, payload, context)` helper in queries.ts, unit-tested against the
contract table.

## R6. Accept-note surfaces

The conn tickle wake already reconciles via `GET /v1/connections` (comment in
connections_handlers.go: "the SW reconciles state — the tickle carries no identity"), and
the SW builds friend-request notes in sw-inbox. Acceptance today = silent state change ⇒
quiet generic. **Decision**: the conn reconcile distinguishes "new incoming request" from
"my outgoing request became accepted" and composes "«name» accepted your invitation"
(name from the already-synced contact/directory data on device); the page path shows the
existing system banner and, with the presence-gated tickle (R2), no simultaneous OS push.

## R7. Prefs derivation inputs and the hidden fence

Inputs all exist: `notifications.*` settings, `chat.mutedUntil` / `notifyWebPush`,
`isWallUserMuted`, hidden set (`hidden-chats.ts`). **Decision**: new pure module
`push-prefs.ts` (no idb imports — snapshots in, prefs out) so the SC-011 hidden-exclusion
guard is a plain unit test; callers feed it snapshots and POST on change (settings bus +
mute/hide write points), debounced ~2s. Wall "always notify this friend's posts" is a new
per-contact flag stored like the existing per-person wall mute.

## R8. Banner gesture surface

`NotificationBanners.vue` already runs pointer-tracked gestures on `nb-grab` (pull-down
open, in-reply swipe-up discard) — the swipe-dismiss extends the same handler set to the
collapsed banner body with a vertical threshold, honoring the 2032 lesson (no bare
pointerdown.prevent). ✕ becomes SR-only (`.sr-only` focusable button) per FR-010.
**Alternative rejected**: Ionic gesture controller — the component already hand-tracks
pointers; two systems on one element invite conflicts.
