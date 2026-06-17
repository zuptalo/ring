# Phase 0 Research: Ephemeral Activity Indicators

All Technical Context unknowns are resolved below. Each item is a decision +
rationale + the alternatives rejected. These are grounded in the existing Ring
architecture (`internal/ws` Hub relay, `transport.ts` frame union, `useSync.ts`
dispatch, `usePresence.ts` ephemeral state, the read-receipt relay path).

## D1 — Delivery model: relay (like read receipts), NOT server-computed presence

- **Decision**: Deliver activity as a **live, relay-only control frame** —
  client-originated, addressed `{to: peer}`; the server stamps `from =`
  authenticated sender and fans the frame only to the peer's currently-connected
  sockets via the existing `Hub.Send`, dropping it if the peer has no live
  socket. It is **never** `EnqueueRelay`'d (no durable queue), never persisted,
  never pushed, and never `bufferCall`'d.
- **Rationale**: The server already sees the sender↔recipient relay path for
  every message and read receipt. Reusing exactly that addressing adds **no new
  metadata** (Constitution I, IX). Read receipts are the precedent: client
  originates `read`/`downloaded`, the server stamps `from` and routes to `to`.
- **Alternatives rejected**:
  - *Server-computed presence* (broadcast via the `watchers` map, gated by
    online tiers) — would make the server **author and aggregate a new signal**,
    reusing the contact graph for a new purpose: more than relaying requires →
    violates Principle I and the "justify complexity" rule.
  - *Durable/queued delivery* — defeats ephemerality and creates new at-rest
    metadata; an indicator is only meaningful "right now."

## D2 — Anti-forgery: server stamps `from`

- **Decision**: The server overwrites `from` with the authenticated connection's
  user id (drops any client-supplied `from`/`to` mismatch), exactly as the
  existing `receipt` handling does. A client cannot emit activity "as" another
  user.
- **Rationale**: Carries over Ring's existing receipt anti-forgery rule (the
  server hard-rejects client-claimed `sent`/`delivered`). Prevents spoofed
  "X is typing" frames.
- **Alternatives rejected**: Trusting client `from` — forgeable.

## D3 — Sealing the activity kind without Double-Ratchet churn

- **Decision**: The activity **kind** (`typing` | `recording-audio` |
  `recording-video`) and on/off state ride inside a **sealed `ciphertext`** that
  the server relays opaquely, the same way the Hub already forwards opaque
  peer-to-peer control payloads (e.g. the sealed group-key / stream-id frames).
  Seal it with the existing libsodium sealing reused for those control payloads
  — a **stateless seal that does NOT advance the Double Ratchet** (so frequent
  ephemeral signals cannot desync or churn the message ratchet).
- **Rationale**: Keeps even the activity *kind* opaque to the server (only `{t,
  to, from}` are visible), satisfying metadata minimization, while reusing the
  existing crypto core (Principle IV — no hand-rolled primitive). Decoupling
  from the message ratchet avoids skipped-key/out-of-order interactions with real
  messages and avoids per-keystroke ratchet cost.
- **Alternatives considered**:
  - *Encrypt via the message Double Ratchet* — rejected: advancing the ratchet on
    every typing/keepalive frame churns ratchet state, risks desync with real
    messages, and is wasteful for a high-frequency low-value signal.
  - *Send the kind as plaintext in a new frame field* — rejected: leaks
    "typing vs recording" metadata to the server beyond what relaying requires.
- **Fail closed**: if no encryption session/keys exist with the peer yet, the
  client **suppresses** the activity signal rather than sending it unsealed. An
  indicator is never worth leaking a plaintext kind.
- **Open for checklist/security review**: the exact sealing primitive and key
  (sealed-box to the peer's identity public key vs. a derived per-contact key)
  is validated in the required `/speckit-checklist` and security review. The
  invariant the design fixes now: **server sees no plaintext kind; no new
  primitive; no ratchet advance.**

## D4 — Emission cadence: debounce + keepalive + explicit stop

- **Decision**: On the first composer input, emit one **start**; while the user
  keeps composing, send a **keepalive** roughly every ~3s; emit an explicit
  **stop** on send, on clearing the draft, on blur/leaving the chat, and on app
  background. The recipient **auto-expires** the indicator ~6s after the last
  received signal (D5), so a missed stop self-heals.
- **Rationale**: Avoids a per-keystroke frame storm (Principle IX), reads as a
  steady "typing…" during continuous composing, and is robust to dropped stops.
  ~3s keepalive < ~6s expiry guarantees no flicker during active composing.
- **Alternatives rejected**: One frame per keystroke (spam); start-only with no
  keepalive (would expire mid-typing).
- **Side-channel note**: the keepalive cadence coarsely reveals composing
  duration to the peer (and the frame timing to the relay). This is accepted and
  bounded by the ~3s cadence; it exposes nothing the per-message relay timing does
  not, and the kind/state stay sealed (D3).

## D5 — Recipient state + auto-expiry (~6s)

- **Decision**: A new `useTyping.ts` composable holds an **in-memory reactive
  Map** keyed by conversation→sender, mirroring `usePresence.ts`: never persisted
  to IndexedDB, never synced. Each entry carries the kind and a timer; if no
  further signal arrives within **~6s** the entry auto-clears. `clearTyping()` is
  wired into the same offline/logout paths as `clearPresence()`.
- **Rationale**: Matches the proven ephemeral-presence pattern; guarantees FR-006
  (never survives reconnect/reload) and FR-007 (no stuck indicator). The 6s value
  is the clarified default (Session 2026-06-17).
- **Alternatives rejected**: Persisting activity (violates ephemerality);
  relying solely on explicit stop (a dropped stop would stick forever).

## D6 — Dispatch path: the `live` fast-path, not the serialized inbound chain

- **Decision**: Add the activity frame type(s) to the `live` predicate in
  `useSync.ts` (currently `call-*` / `sfu-*` / `presence`) so they bypass the
  serialized `inboundChain` (which exists to serialize IndexedDB read-modify-write
  for stored messages). Apply them directly to `useTyping` state. Send via the
  existing transient `sendLive()` helper (bypasses the durable outbox).
- **Rationale**: Activity touches no store, so it must not be serialized behind
  message DB writes (latency) — it belongs on the same live path as presence and
  call signalling.
- **Alternatives rejected**: Routing through the durable outbox / inbound message
  chain — adds latency and implies persistence semantics it must not have.

## D7 — Group fan-out: client-driven, bounded, per-member

- **Decision**: For a group chat the **client** sends one activity frame per
  recipient member (excluding self and blocked), mirroring the existing
  group-call invite (`ringGroup` / `call-roster`) fan-out. The server relays each
  like a 1:1 frame. **Concrete bounds** (defaults, tunable in implementation):
  fan out to at most ~50 recipients (skip activity fan-out beyond that — the
  indicator is non-essential), and emit at most one start + one keepalive per ~3s
  per recipient (D4 cadence). This caps amplification in large groups.
- **Rationale**: The server holds **no group object** (zero-knowledge); group
  membership is client-side. Asking the server to fan out by group would require
  it to learn membership = new metadata. Bounding + rate-limiting prevents a
  large group from amplifying frames.
- **Alternatives rejected**: Server-side group fan-out (needs server-visible
  membership — violates Principle I).

## D8 — Multi-device coalescing & per-sender attribution

- **Decision**: The recipient keys activity by **sender user id** (not device),
  so multiple devices of the same sender coalesce to one indicator. In groups,
  the UI shows up to **two names** then "several people are typing…" (clarified
  default), reusing the existing `senderName` / `senderAvatar` / per-sender colour
  already computed for group bubbles.
- **Rationale**: FR-011 (single indicator across devices) falls out of keying by
  user. Group coalescing keeps the header readable and bidi-safe.

## D9 — Privacy toggle: single combined, reciprocal, client-enforced

- **Decision**: Add **one** toggle `privacy.activityIndicators` (default `true`)
  in the `privacy` node of `src/settings/schema.ts`, beside `privacy.readReceipts`,
  with a reciprocity footer. When off: the client **emits nothing** for any chat,
  **and** does not render incoming activity from others (reciprocity), mirroring
  read receipts. Enforcement is entirely client-side.
- **Rationale**: "You can't leak what you don't send." Reciprocity by
  non-rendering matches the existing read-receipts UX and needs no server logic.
  Single combined toggle is the clarified choice (simplest IA).
- **Alternatives rejected**: Two/three toggles (more IA + reciprocity edge cases,
  not requested); server-enforced gating (would need server to act on the signal).

## D10 — Rendering surfaces (transient override)

- **Decision**: 1:1 → transiently override the chat-header status line
  (`statusLine` in `ChatDetailPage.vue`), reverting to Online/last-seen when
  activity ends. Chats list → transiently override the `.preview` last-message
  subtitle in `ChatListItem.vue`. Groups → header subtitle (empty for groups
  today) with per-sender coalescing. An above-composer footer bar is an accepted
  alternative surface but the header/subtitle surfaces are the baseline.
- **Rationale**: Reuses existing presence-driven surfaces; minimal new UI; stock
  Ionic (Principle XI). Matches WhatsApp-style expectations.

## Resolved unknowns

No `NEEDS CLARIFICATION` markers remain. All four spec clarifications (toggle
granularity, recording-label distinction, ~6s auto-expiry, group coalescing) are
incorporated. The one item deferred to the required `/speckit-checklist` +
security review is the exact sealing primitive/key for the activity kind (D3) —
the ZK invariant it must satisfy is fixed here.
