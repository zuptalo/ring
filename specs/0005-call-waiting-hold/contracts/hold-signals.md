# Contracts: hold/resume signalling & call-waiting surface

Phase 1 for spec 0005. The interfaces this feature exposes/changes. Two layers: the
**sealed wire signal** (client ↔ client, relayed as opaque ciphertext) and the **client API
surface** (`useCall` hook + UI). No new server HTTP endpoints, no new unsealed frames — the
relay is unchanged (it already forwards sealed call signals between room members).

## 1. Sealed hold/resume signal (over the existing per-pair path)

Extend the existing `CallSignal` (the sealed payload of `call-offer`/`call-answer`/`call-ice`)
with two control kinds. These ride `sendSealedSignal` (1:1) / the mesh per-leg sealed path,
so the server relays ciphertext only and learns nothing beyond "a sealed signal was relayed."

```ts
// src/services/crypto/message.ts — CallSignal gains:
type CallSignal =
  | { type: 'offer'  | 'answer' | 'ice'; /* …existing… */ }
  | { type: 'hold';   callId: string; roomId?: string }   // sender paused this call
  | { type: 'resume'; callId: string; roomId?: string };  // sender resumed this call
```

Routing (**no new transport frame, no server change**): the signal rides an EXISTING sealed
call frame — `call-ice` (already relayed by the server and on the `sync.ts` allowlist) — as an
opaque carrier. The server forwards the ciphertext exactly as today. The **receiver** opens the
sealed `CallSignal` and **dispatches on its inner `.type`**: `hold`/`resume` branch off before
the offer/answer/ice handling. Because the outer frame type is unchanged, neither
`transport.ts`, the server relay allowlist, nor the client `sync.ts` allowlist needs editing.
The `roomId` is present for a mesh leg (one hold/resume per leg), absent for 1:1.

**Receiver behaviour** (the other party / each other group member):
- On `hold`: mark the sender `remote-held`, **pause own outgoing media to that sender**
  (`replaceTrack(null)` on the leg/pc to the holder), and show "on hold" for the holder.
  In a group, only the holder's legs are affected — the rest of the mesh is untouched.
- On `resume`: clear `remote-held`, restore own outgoing (`replaceTrack(liveTrack)`), drop
  the "on hold" indication.

**Zero-knowledge**: identical privacy posture to offer/answer/ICE (Principle I, FR-012).

## 2. `useCall` API additions (client)

```ts
// New reactive state
heldCall: Ref<CallMeta | null>      // the parked call's meta, or null when only one call
isHeld:   Ref<boolean>              // true when THIS (active-view) call is the held one mid-swap
canHoldIncoming: Ref<boolean>       // a held slot is free → incoming can be "accept & hold"

// New actions
acceptAndHold(): Promise<void>      // accept the incoming call, holding the current one
swapCalls():     Promise<void>      // active ⇄ held (pause one, resume the other)
endActive():     Promise<void>      // drop the active call; held (if any) resumes
endHeld():       Promise<void>      // drop the held call; active undisturbed
```

**Changed behaviour** (extends spec 0004):
- The 1:1 offer handler and the group-invite handler stop unconditionally replying busy when
  in a call. They reply busy **only** when already at two calls; with a free held slot they
  raise the incoming UI with an **Accept & hold** option (plus decline).
- `MeshSession` gains `pause()` / `resume()`: `replaceTrack(null|live)` on every leg's senders
  and send the sealed `hold`/`resume` per leg. The 1:1 path does the equivalent on its `pc`.

## 3. UI surface (Ionic-first)

- **IncomingCallOverlay**: when `canHoldIncoming`, show **Accept & hold** alongside
  Decline (and the normal Accept for the no-current-call case). At the two-call cap the
  overlay is never shown (the caller already got busy).
- **CallActivePage**: a tap-to-swap **"On hold — <name>"** bar (stock `ion-item`/`ion-chip`,
  `--ring-*` tokens) when a held call exists; a **swap** control in the call controls; the
  active call's other party/members render the existing "on hold" affordance when
  `remote-held`.
- No bespoke widgets where an Ionic primitive fits (Principle XI).

## 4. Audio cues (extends spec 0004 cue set)

New rate-limited recipes in `sound.ts`, fired via the existing `callCue` gate:

| Cue          | When |
|--------------|------|
| `callwaiting`| A second call arrives while in a call (distinct from the normal incoming ring) |
| `hold`       | The user puts a call on hold |
| `resume`     | A held call is resumed |
| `swap`       | The user swaps active ⇄ held |

All honour the "Call sounds" setting and the de-dup limiter (FR-011, SC-006).

## 5. Test contracts (what the e2e/unit tests assert)

- **Hold pauses both ways**: after Accept & hold, the held call's other side receives no
  media and shows "on hold"; the holder receives none either (US1, SC-002).
- **Swap restores**: after N swaps, exactly one call is active (media both ways) and one held;
  the on-hold indicator follows the held call (US2, SC-001).
- **Group hold isolates the holder**: while A holds a group, B↔C media is unaffected and A
  shows "on hold"; on resume A's media returns (US1/US2, SC-003).
- **Drop**: ending the active call resumes the held one; ending the held one leaves the active
  undisturbed; remote-ends-held frees the slot without disturbing the active (US3, SC-005).
- **Two-call cap**: a third caller gets busy, no third prompt (US4, SC-004).
- **Cues**: each cue fires distinctly and is silenced when tones are off (US5, SC-006).
- Pure unit-testable seams (no WebRTC): the slot state machine (which slot is active/held
  after accept/swap/drop) and the cue-trigger decisions.
