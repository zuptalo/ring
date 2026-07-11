# Research: Simultaneous mutual calls (spec 1039)

All Technical Context items were resolvable from the codebase; no external unknowns
remained. Decisions below are the load-bearing ones.

## R1 — Winner tie-break: reuse the existing deterministic id ordering

- **Decision**: the attempt whose CALLER has the smaller user id survives; the other
  side yields. This is the rule the current glare branch already applies
  (`useCall.ts:1883`, `if (self < from) return`) and matches the mesh's polite/impolite
  convention (`mesh.ts`: `polite = selfId > peerId`).
- **Rationale**: both devices can compute it independently from information they already
  hold (the two user ids), with no extra round-trip and no timing sensitivity — FR-002's
  symmetric determinism for free. Keeping the same ordering as the mesh avoids two
  competing conventions in one file.
- **Alternatives considered**: comparing callIds (random per attempt — both sides know
  both ids only after the cross, same property but no benefit and it diverges from the
  established convention); timestamps (not comparable across devices; ties possible);
  explicit negotiation frames (new protocol surface for zero gain).

## R2 — Where glare must be detected: `callMeta`, not `callState`

- **Decision**: key the glare gate on the synchronously-set `callMeta`
  (direction `outgoing`, non-group, `peerUserId === from`, call not yet answered)
  combined with `callState` in `{'idle' (setup window), 'dialing', 'remote-ringing'}`,
  instead of today's `callState.value !== 'idle'` gate.
- **Rationale**: `startDirectCall` sets `callMeta` on its first line but only leaves
  `'idle'` after getUserMedia + PC construction + offer send (0.5–2s+, longer with a
  permission prompt). Mutual taps land inside that window almost by definition, which is
  exactly why users see both sides stuck. `callMeta` is the earliest truthful record of
  "an attempt exists".
- **Alternatives considered**: setting `callState = 'dialing'` synchronously at the top
  of `startDirectCall` (rejected: `dialing` drives UI/tones that must not start before
  capture consent, and other code paths key off the current meaning); a separate
  `placingCall` flag (rejected: `callMeta` already encodes it — a second source of truth
  invites the next desync).

## R3 — Cancelling the in-flight `startDirectCall` safely: attempt token

- **Decision**: give each outgoing attempt a monotonically increasing token (or use the
  callId itself) captured at entry; after every `await` inside `startDirectCall`, bail
  out if the current attempt token no longer matches (the attempt was yielded/torn
  down). The yield path stops local tracks only if the auto-accept isn't reusing them.
- **Rationale**: the chimera state exists because a half-finished `startDirectCall`
  keeps mutating global state (`setState('dialing')`, tones, navigation) after
  `handleOffer` has already repurposed the call slot. A generation check after each
  suspension point is the established minimal pattern for exactly this bug class.
- **Alternatives considered**: AbortController plumbed through (heavier, same effect);
  a mutex serializing `startDirectCall` against `handleOffer` (would *delay* the
  incoming offer instead of resolving it, and risks deadlock with the sealed-signal
  session mutex).

## R4 — Media for the auto-accepting (yielding) side: reuse the already-captured stream

- **Decision**: when the yielding side has already captured its local stream (its own
  attempt got as far as getUserMedia) and the kinds match, hand that stream to the
  accept path instead of a second `getUserMedia`. If capture hadn't resolved yet, let
  the accept path do the (single) capture as usual.
- **Rationale**: WebKit mutes tracks when a second concurrent `getUserMedia` runs
  (documented in `useCall.ts` ~line 629, WebKit bug 179363); the kinds-match rule means
  the captured stream is exactly what the surviving call needs. This also makes the
  auto-connect faster (capture is the slow step).
- **Alternatives considered**: always re-capture (violates the WebKit constraint and
  slower); keep both captures alive briefly (two live captures is itself the hazard).

## R5 — The abandoned attempt on the wire: reuse `call-cancel`

- **Decision**: the yielding side sends the existing `call-cancel` control for its
  abandoned callId (reason from the existing vocabulary, e.g. `answered-elsewhere`)
  before/while auto-accepting the surviving offer.
- **Rationale**: the relay retains sealed offers for redelivery (spec 2012); without a
  cancel, the winner (or one of its other devices) could get the yielder's stale offer
  redelivered after a reload and raise a ghost incoming ring. `call-cancel` is already
  understood by every receive path (`useCall.ts:3224`) and by the relay's retention
  logic; no new frame type, zero-knowledge unchanged.
- **Alternatives considered**: silent abandonment (leaves the retained-offer ghost);
  a new dedicated reason string (needless vocabulary growth — nothing branches on it).

## R6 — Call-log integrity (FR-007): delete the yielded attempt's record

- **Decision**: `startDirectCall` writes an outgoing call record immediately
  (`createCall` at `useCall.ts:1294`); on yield, remove that record via the existing
  `deleteCalls([callId])` and let the auto-accept path write its normal
  incoming-answered record. Winner side: its outgoing record proceeds normally, and the
  crossing offer is ignored *before* any record is created for it (current behavior,
  preserved).
- **Rationale**: exactly one entry per side, each reflecting what actually happened
  (an answered call), with no "no answer"/"missed" artifacts — the spec's SC-005.
- **Alternatives considered**: mutating the outgoing record into an incoming one
  (more code, lies about direction); leaving both records (fails FR-007).

## R7 — Kind mismatch: ring, never auto-enable a camera

- **Decision**: auto-connect only when `myKind === offerKind`. On mismatch the yielding
  side cancels its own attempt and presents the surviving offer as a normal incoming
  ring (today's post-glare behavior), showing the offer's kind.
- **Rationale**: constitution Principle IX / spec FR-004 — capture consent is explicit.
  A video offer auto-accepted by someone who placed an audio call would light their
  camera uninvited; the ring is the established consent surface. (Joining a video call
  as audio-only, or auto-accepting audio when the yielder wanted video, are viable
  refinements — deferred by the spec's Assumptions to keep this slice small.)
- **Alternatives considered**: degrade-to-audio auto-connect (extra states in the accept
  path and in-call upgrade interplay; deferred); treating mismatch as busy (worst UX —
  the call simply fails).

## R8 — Per-chat mute vs. the mutual case

- **Decision**: the glare branch runs BEFORE the per-chat mute suppression in
  `handleOffer`, so a muted chat still resolves/auto-connects a mutual attempt (the
  muted person themselves just placed a call to that contact — it is not an unsolicited
  ring). A mismatched-kind fall-through to the ring path keeps ringing even for the
  muted chat in the mutual case only (the user's own outgoing attempt is the consent).
- **Rationale**: spec edge case; mute exists to stop unsolicited interruptions, and a
  mutual attempt is by construction solicited.
- **Alternatives considered**: honoring mute (the mutual call silently fails on one
  side — indistinguishable from the current bug).
