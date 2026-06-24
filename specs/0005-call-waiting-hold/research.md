# Research: Call waiting — hold, swap & drop

Phase 0 for spec 0005. Resolves the technical unknowns behind holding one call, taking a
second, swapping, and dropping — across 1:1 and mesh group calls — on top of the existing
calling stack (`src/composables/useCall.ts`, `src/services/call/mesh.ts`, `signalling.ts`,
the Go relay). iOS/Safari support and the zero-knowledge boundary are hard constraints.

## Current state (what we build on)

- `useCall.ts` is a **module-level singleton**: one `callState`/`callMeta`, one `pc`
  (1:1 RTCPeerConnection), one `groupSession` (mesh), one shared local stream. It assumes a
  single call at a time.
- A second incoming call while busy is **refused** today (spec 0004 US2): the 1:1 offer
  handler (~`useCall.ts:1244`) and group-invite handler (~`:1082`) reply busy when
  `callState !== 'idle'`.
- `replaceTrack(track|null)` is already used for the camera flip / screen share and is
  **renegotiation-free** (see the comment at `useCall.ts:1437` and `mesh.replaceVideoTrack`).
- Remote audio plays through a persistent global sink (`CallMediaSink`) so it survives
  minimising; tiles' `<video>` are muted and audio is routed centrally.
- Call control frames (`call-ringing/accept/reject/busy/end`) are **unsealed routing
  frames**; SDP/ICE travel **sealed** over each pair's Double Ratchet (`sendSealedSignal`).

## Decision 1 — Pause/resume media without dropping the connection

**Decision**: Hold = (a) move the live mic/camera tracks OFF the held call's senders via
`replaceTrack(null)`, (b) stop rendering the held call's incoming audio (the global sink only
plays the active call), and (c) send a sealed `hold` signal so the other side pauses ITS
outgoing too and shows "on hold". Resume reverses it: `replaceTrack(liveTrack)` + render +
sealed `resume`. The PeerConnection(s) and ICE stay **up** the whole time — only the media
content changes. No SDP renegotiation.

**Rationale**:
- `replaceTrack` is instant, needs no renegotiation, and works on iOS/Safari — already proven
  in this codebase. Keeping the PC/ICE alive makes resume immediate (no re-offer, no
  re-gather), which matters for swapping back and forth (US2, SC-001).
- "Paused in both directions" (FR-002) is achieved by both sides stopping their send: the
  holder via `replaceTrack(null)`, the other side on receipt of the `hold` signal. The holder
  also stops rendering, so neither sends nor plays.
- The shared camera/mic is the crux of two concurrent calls: a single `getUserMedia` track
  can't be independently `enabled` per call (toggling `track.enabled` would affect both
  senders that reference it). So the **active** call owns the live tracks via `replaceTrack`,
  and the **held** call's senders carry `null`. Swapping moves the live tracks between the two
  calls' senders — one gUM, no contention.

**Alternatives considered**:
- *SDP renegotiation to `a=inactive`/`a=sendonly`* (classic SIP hold): heavier, slower resume
  (full offer/answer + ICE), and historically flaky on Safari. Rejected for latency + risk.
- *`track.enabled = false`*: simplest, but a single shared track can't be enabled per-call,
  and it still transmits (black/silence) rather than freeing the encoder. `replaceTrack(null)`
  both frees the slot and lets the active call own the track. Rejected as insufficient alone.
- *Closing the held PC and re-creating on resume*: loses ICE/DTLS, slow + fragile resume,
  and for a group would make the other members see the holder leave. Rejected.

## Decision 2 — Two call slots (the architecture)

**Decision**: Introduce exactly **two slots** — `active` and `held` — in `useCall`. The
active slot keeps using today's singleton refs (`pc`/`groupSession`/`callMeta`/streams) so the
in-call path is unchanged. A new **`heldCall` holder** parks the other call's live objects
(`pc` or `groupSession`, its `callMeta`, its sender handles) in a paused state. Accepting a
second call moves the current active call into `heldCall` (pausing it) and sets up the new
call in the active refs. **Swap** exchanges the two (pause active → park; unpark held →
resume). **Drop** tears down one slot; if the held slot remains, it resumes into active.

**Rationale**:
- The cap is two (FR-008), so a single held holder suffices — no general N-call refactor, no
  new multi-session engine. This keeps the blast radius small and the active path untouched
  (Principle: justify complexity — a two-slot pair is the minimum that delivers the feature).
- Both call kinds already expose the surface we need: 1:1 via `pc` + `videoSender()`/audio
  sender; mesh via `groupSession` (which owns per-leg senders and already does
  `replaceVideoTrack`). The held holder stores whichever is set and calls pause/resume on it.
- `MeshSession` gains `pause()`/`resume()` that `replaceTrack(null|live)` every leg's senders
  and send the sealed hold/resume per leg; the 1:1 path does the same on its single `pc`.

**Alternatives considered**:
- *Full multi-session refactor* (an array of `CallSession` objects, active path rewritten):
  cleaner in theory but a large, risky rewrite of the entire singleton call module for a
  two-call cap. Rejected — disproportionate.

## Decision 3 — Hold/resume signalling (zero-knowledge)

**Decision**: Carry hold/resume as **sealed `CallSignal` kinds** (`type: 'hold' | 'resume'`)
over the existing per-pair sealed path (`sendSealedSignal` for 1:1; per-leg for the mesh) —
not as new unsealed control frames. The server relays ciphertext and learns nothing beyond
"a sealed call signal was relayed," which it already does for every offer/answer/ICE.

**Rationale**: FR-012 requires that hold/resume not reveal to the server which call a user is
attending to beyond what room membership already exposes. An *unsealed* `call-hold {to,
callId}` frame would tell the server "X paused callId." Sealing it keeps the server blind —
indistinguishable from any other sealed signal — which is strictly more private and matches
how SDP/ICE already travel. The peer/members decrypt it, set a `remoteHeld` flag, pause their
own outgoing to the holder, and show "on hold."

**Alternatives considered**:
- *Unsealed control frame* (like `call-busy`/`call-end`): simpler to route but leaks the
  hold event + target to the server. Rejected on Principle I / FR-012 (minimize metadata).

## Decision 4 — Second-incoming flow (extends 0004 busy)

**Decision**: Replace "always busy when in a call" with **slot-aware** handling: if a held
slot is free (the user has ≤ 1 call), the incoming UI offers **Accept & hold** (alongside
decline); accepting holds the current call and connects the new one. If already at two calls,
reply **busy** exactly as 0004 does (FR-008). This touches the same two handlers (1:1 offer,
group invite) and the incoming overlay.

**Rationale**: Reuses 0004's busy machinery for the over-cap case; only the
"one-call-already" case changes from busy to offer-hold. Keeps the third-caller-busy contract
intact.

## Decision 5 — Single call-log entry across hold/swap (FR-010)

**Decision**: Hold/resume/swap never call the teardown logging path, so they create **no**
history entries; a held-then-resumed call logs once, when it finally ends — which is already
how `teardown` logs (spec 0004). No change needed beyond *not* logging on hold/swap.

## Decision 6 — Audio cues (FR-011, US5)

**Decision**: Add four rate-limited cues to `sound.ts` (`callwaiting`, `hold`, `resume`,
`swap`), triggered at the new state transitions through the existing `callCue` gate (which
already honours the "Call sounds" setting and de-dups). The call-waiting alert is a distinct
recipe from the normal incoming ring.

**Rationale**: Mirrors the spec 0004 cue mechanism exactly; nothing new architecturally.

## Decision 7 — UI (Ionic-first, Principle XI)

**Decision**: On `CallActivePage`, surface the held call as a tap-to-swap bar at the top
(name + "On hold") built from stock Ionic (`ion-item`/`ion-chip` + existing `--ring-*`
tokens); add a **swap** control to the call controls and an **Accept & hold** action to
`IncomingCallOverlay`. The held call's other party/members render an existing "on hold"
affordance on the tile/call view. No bespoke widgets where an Ionic primitive fits.

**Rationale**: Principle XI — compose from Ionic + theme tokens; a held-call bar and an extra
control button are standard Ionic compositions.

## Decision 8 — Held-call lifecycle edges

**Decision**:
- A held call that the **remote ends** (1:1 hang-up, or a group where everyone else leaves)
  frees the held slot and informs the user; the active call is untouched (FR-009, SC-005).
- A held call's **network blip** follows the existing grace/recovery rules (spec 0004); if it
  dies past grace while held, its slot is freed and the user informed (no auto-recall).
- A **resumed** call's adaptive quality restarts from the low tier (spec 0004 controller's
  initial state) — paused legs stop adapting and re-climb on resume.
- **Hold during setup**: accepting a second call while the first is still
  ringing/connecting resolves the first sensibly (a not-yet-connected outgoing call is
  cancelled rather than parked; a connecting call is parked once connected or cancelled) — the
  exact rule is captured in data-model state transitions.

## Open questions

None blocking. All NEEDS CLARIFICATION from the spec's Clarifications session are resolved
(two-call cap, any combination, both-direction pause, on-hold indication). Implementation
detail (exact cue recipes, the held-bar layout) is settled at task time.
