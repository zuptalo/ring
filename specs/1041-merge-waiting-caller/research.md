# Research: Merge a waiting caller into the ongoing call (spec 1041)

All unknowns were resolvable from the codebase. The headline finding reframes
the feature: the merge MACHINERY already shipped (spec 1028's `joinroom`
promote signal, spec 1030's add-to-call, the second-incoming "Add to call"
button `mergeIncoming`/`mergeSecond`, capacity gates, e2e coverage in
`call-merge*.spec.ts`). What spec 1041 actually adds is the CONSENT layer the
user asked for — a join REQUEST the waiting caller accepts or rejects — plus
rejection-final semantics, request withdrawal, and the avatar-tile fix.

## R1 — The consent hole is real and specific

- **Finding**: today's merge auto-joins the waiting caller with no prompt:
  the sealed `joinroom` signal (sent by `mergeIncoming` after
  `ensureActiveIsRoom`, `useCall.ts:1802-1810`) is received inside
  `case 'call-ice'` and immediately runs `convertActiveToRoom(...)`
  (`useCall.ts:3457-3461` — "Works whether we were the active peer or still
  dialing them (a merged-in caller)"). The server's `JoinIfRoom`
  (`server/internal/call/registry.go:46-59`) gates on capacity only — no
  invite allowlist — so consent is entirely client policy.
- **Decision**: keep `joinroom` for the case that already carries consent (a
  peer who is IN the active 1:1 being promoted — being in the call with you
  is the consent), and introduce a consent-gated request for the
  waiting/held party (R2). The auto-join branch stays but is REACHED only by
  the promote path; the merge entry points stop sending bare `joinroom` to a
  party who has not accepted.

## R2 — The join request: three new inner types on the sealed call-ice channel

- **Decision**: extend the `CallSignal.type` union with `joinreq`,
  `joinreq-accept`, `joinreq-reject`, and `joinreq-cancel`, all riding the
  existing sealed-inside-`call-ice` trick exactly like `hold`/`resume`/
  `qos`/`joinroom` (`signalling.ts:74-137`; receiver dispatch
  `useCall.ts:3423-3482`). `joinreq` carries the pre-minted `roomId` + the
  ongoing call's `kind`; accept/reject/cancel carry only ids. No new
  transport frame, no server change, zero-knowledge unchanged (the server
  cannot tell a join request from an ICE candidate).
- **Rationale**: the pattern is established four times over; a new branch in
  the `call-ice` dispatch is the entire wire surface. Old receivers ignore
  unknown inner types → the graceful degrade the spec's edge case requires
  (their attempt just keeps ringing).
- **Alternatives considered**: reusing bare `joinroom` with a "consent"
  flag (old clients would auto-join — the exact hole); a `callEvent` marker
  over the messaging ratchet (spec 1040's channel — wrong latency class:
  join requests are live-call UX, and the call-ice channel already exists
  for this session); a server-side invite allowlist (new server knowledge
  and state for zero gain — consent belongs on the device).

## R3 — Promote on accept, not on request

- **Decision**: the callee mints the `roomId` at request time but converts
  the active 1:1 into the room only when `joinreq-accept` arrives (an
  ongoing GROUP call needs no conversion; the request just carries its
  existing roomId). The accepter joins by converting THEIR outgoing attempt
  into the room (`convertActiveToRoom(roomId, ownKind, ...)`), reusing their
  already-captured stream.
- **Rationale**: promoting eagerly leaves the callee stranded in a
  pointless single-occupant "room" when the request is rejected
  (`convertActiveToRoom` is not reversible); the room is created on demand
  by the server on the first `call-join` (`hub.go:1526-1560`), so ordering
  is free — whoever joins first sits in the room and the mesh's
  roster-driven legs (`mesh.ts:223-239`) connect them as others arrive.
  Reusing the accepter's capture honors the media-consent clarification
  (audio attempt → mic only) and the WebKit no-second-getUserMedia hazard.
- **Alternatives considered**: eager promotion (stranded-room problem);
  having the accepter send a fresh call to the room (no such concept — join
  is the primitive).

## R4 — Rejection-final: a per-call, per-party block on the callee's device

- **Decision**: a module-level `Map` on the callee side keyed by the ongoing
  call's identity (roomId, or the active callId pre-promotion) → the set of
  user ids whose `joinreq-reject` arrived. The merge affordances ("Add to
  call" on the prompt, "Bring into this call" on the held bar) render
  disabled/hidden for a blocked party; the map dies with the call
  (`teardown`), satisfying FR-011 with no persistence.
- **Rationale**: FR-009's scope is exactly the ongoing call; in-memory state
  torn down with the call is the whole requirement. Hold/swap/decline paths
  are untouched (FR-010).

## R5 — Request lifecycle bounds (US3): reuse every existing timeout

- **Decision**: no new timers. The waiting caller's attempt keeps its own
  dial timeout (60s, `useCall.ts:517`) — a pending request never extends it
  (FR-013): the request PROMPT on the caller's screen lives on their call
  UI, so their teardown (timeout/cancel/hang-up) dismisses it with the call.
  The callee's outstanding request is withdrawn by `joinreq-cancel` sent
  from `teardown` when the ongoing call ends first (FR-014) and cleared when
  the waiting attempt dies (existing `call-cancel`/`call-end` handling
  already clears `incomingSecond`; the request state rides the same
  events). The second-incoming prompt's own 60s auto-drop
  (`useCall.ts:2637-2640`) and the caller-side no-answer flow (now with
  spec 1040's `ended/missed` marker settling the trace) stay authoritative.
- **Rationale**: US3 is a guard-rail story — the spec pins existing behavior;
  adding parallel timers would create the drift it warns about.

## R6 — Held-party merge (FR-002): the same request from the held bar

- **Decision**: add a "bring into this call" action alongside the existing
  "On hold · tap to swap" bar (`CallActivePage.vue:95-106`). It runs the
  same flow as the prompt-time merge: capacity check (`canAdd`), mint/reuse
  roomId, `joinreq` to the held party over their held 1:1's sealed channel.
  On accept, the held slot is freed (their 1:1 leg ends; they enter as a
  mesh participant); on reject, the held call stays parked exactly as today.
- **Rationale**: FR-002; the held slot already keeps `meta.chatId`/
  `peerUserId`/`callId` (`useCall.ts:2307-2314`), which is everything
  `sendSealedSignal` needs.

## R7 — Accepter UX: a consent prompt over the outgoing-call screen

- **Decision**: `joinreq` on a device with a matching outgoing attempt
  (meta.callId === frame.callId) raises an in-call consent surface (reusing
  the `cw-prompt` alertdialog pattern, `CallActivePage.vue:59-90`): "<Name>
  asks you to join their group call" with Join / Stay waiting. Join →
  `joinreq-accept` + convert-to-room with OWN kind (clarification A); Stay
  waiting → `joinreq-reject`, attempt untouched. The prompt dismisses with
  the attempt (teardown) or on `joinreq-cancel`.
- **Rationale**: the caller is mid-attempt on the call screen — the consent
  question belongs there, matching the existing call-waiting prompt idiom
  (Ionic-first: same button/overlay primitives).

## R8 — Avatar ellipse: height:100% survives the width-only override

- **Finding (root cause, confirmed)**: `.tile-avatar`
  (`CallActivePage.vue:1282-1289`) sets `width:34%; aspect-ratio:1;
  border-radius:50%` but NO height, while `UserAvatar.vue:60-69`'s scoped
  `img { width:100%; height:100% }` (and the emoji branch `.ua`) still
  applies to the component root. Width is overridden to 34%, height stays
  100% of the tile → both dimensions externally determined → `aspect-ratio`
  is ignored per spec → `border-radius:50%` renders a 34%-wide, tile-tall
  ellipse. Present in BOTH the camera-off and the leaving (waving-hand)
  tiles (same `.tile-camoff` + `.tile-avatar` markup); the enter/leave
  animations only draw the eye to it.
- **Decision**: declare `height: auto` on `.tile-avatar` so `aspect-ratio: 1`
  regains control (img and `.ua` span alike), and verify the `.ua` emoji
  branch centers correctly with the derived height. Uniform `tile-in`/
  `tile-leave` scale animations are distortion-free and stay.
- **Alternatives considered**: making UserAvatar's internals opt-out
  (touches every avatar surface for a one-surface bug); explicit pixel
  heights (fights the responsive 34%/clamp sizing).
