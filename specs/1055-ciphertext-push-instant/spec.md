# Feature Specification: Instant rich notifications (bounded encrypted preview in push)

**Feature Branch**: `feat/1055-ciphertext-push-instant`

**Created**: 2026-07-20

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: Follow-on to the 2043–2048 push-reliability arc. Show-first (spec 2048) made locked/idle
iOS devices show a notification within the OS's tight execution window by displaying a generic
placeholder BEFORE the `/relay/pending` fetch + decrypt, then upgrading to rich only if the network
work landed in time. On deeply throttled locked devices it usually did not, leaving the user a
generic "New message" until they opened the app. This spec removes the fetch from the notification
hot path: the SENDER seals a small, display-sized **preview** (sender + a truncated body + kind) and
attaches it to the Web Push, so the service worker can decrypt and show the real sender + preview
immediately — no network round-trip — while the phone is locked. Because notification UIs truncate to
~200 characters on every platform, and because the push is peek-decrypted (it stores nothing) with the
full message still warming over WebSocket on app open, sending the *whole* message would spend bytes on
content that is never displayed and never stored. A bounded preview is exactly enough. It is also
near-constant in size, so — unlike inlining the variable-length full frame — it leaks **nothing** about
message length to the third-party push provider. The preview is sealed under a per-message key derived
from the Double-Ratchet message key, so decryption is stateless (peek, no persist) and forward secrecy
is preserved. The server stays zero-knowledge: it forwards an opaque preview blob it cannot read.

## Clarifications

### Session 2026-07-20

- Q: Rollout — default for all eligible pushes, or opt-in setting? → A: Default on, no user toggle.
- Q: How much of the message goes in the push, given the OS truncates to ~200 chars and we store
  nothing + warm over WS on open? → A: A bounded, display-sized **preview** only (sender + truncated
  body + kind), NOT the whole frame. Cap the body by bytes (~256 B of UTF-8, truncated on a character
  boundary) so the payload is near-constant regardless of script.
- Q: How is the preview sealed so the SW can decrypt it without advancing/persisting ratchet state? →
  A: Under a per-message key `pk_N = KDF(mk_N, "ring-push-preview")` derived from the Double-Ratchet
  message key `mk_N`. The push carries the ratchet header + the preview AEAD; the SW peek-derives `mk_N`
  from the header against a discarded session copy (no persist), derives `pk_N`, and decrypts. Forward
  secrecy is inherited from `mk_N` (deleted when the message is later processed authoritatively on open).
- Q: Which frame kinds get a preview? → A: All text-class frames (1:1 messages, reactions, group —
  which are pairwise 1:1 fan-out, same ratchet path); plus post/wall activity via its own `K_post` seal.
  Calls keep their existing fast ring path (out of scope).
- Q: How does the SW handle ratchet state when it decrypts a preview? → A: Peek only — decrypt against a
  discarded copy of the session; do NOT persist, store, or ack. The full frame stays in the relay queue;
  the authoritative decrypt+store+ack happens later (warm tail below, or on app open) exactly as today.
  The preview decrypt is a pure display accelerator that consumes nothing, so no crypto state is written
  during it and session desync is impossible. A `delivered` receipt is a small fire-and-forget marker.
- Q: After showing the preview, should the SW still fetch + persist the full messages to warm the DB, like
  the iOS-17+ path does today? → A: Yes — best-effort, AFTER the guaranteed show. Once the rich preview is
  on screen, run the existing spec-1032 authoritative drain (`tryAuthoritativeDrain`: fetch `/relay/pending`
  → authoritative decrypt → persist → ack), so a device with budget opens already warm. It runs strictly
  after the visible show, so a suspend/hang cannot cause a silent wake; it self-gates on the existing 1032
  eligibility (single-device, Web Locks) and degrades harmlessly when it cannot persist. On a throttled
  locked device the warm is skipped and the DB warms over WS on open, exactly as today. Moving the fetch
  off the critical display path (the preview now shows without it) makes the warm pure upside. Enabled by
  default for non-legacy devices as part of this spec (still gated by 1032 eligibility).
- Q: Are muted chats dropped at the server or the client, given a client that shows nothing risks
  revocation? → A: SERVER (spec 1050 `AllowPush` Row 6 / `MutedPrids` — opaque prids). The preview push
  MUST inherit that identical gate, so a muted conversation gets NO push at all (no tickle, no preview, no
  wake) — the only way to truly mute without a silent-wake strike. The client-side mute suppression is a
  revocation-safe fallback for the mute-sync gap only; on iOS it ends with a silent generic (not nothing),
  so it is NOT relied on for true muting. Hidden chats are structurally absent from `MutedPrids`, so they
  DO push and the client shows a generic note (spec 1019).
- Q: When should the sender's message flip to "delivered", and how does the server track the gap between
  "notified" and "durably downloaded"? → A: Introduce a new **`notified`** receipt state, emitted the
  instant the SW shows the preview (fast sender feedback), which does NOT dequeue the relay frame. The
  existing **`delivered`** receipt continues to fire when the authoritative warm/open actually fetches +
  persists the message, and dequeues on ack. To the SENDER, `notified` and `delivered` render identically
  (the "delivered" tick) — the recipient was reached. The distinction is for the SERVER: a queued frame
  stamped notified-but-not-delivered is one the recipient has SEEN (preview) but whose full body is not yet
  durably on their device, so it is still owed. The server stamps `notified_at` on the relay row (a
  timestamp, no plaintext) to know this; it dequeues only on `delivered` (ack).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A locked phone shows the real sender and preview instantly (Priority: P1)

Someone locks their phone and later receives a message. The lock-screen notification shows the real
sender name and a message preview immediately — not a generic "New message" that only fills in when they
next open the app — because a display-sized preview rode inside the push and was decrypted on the device
with no network fetch. Opening the app warms the full conversation over WebSocket as it does today.

**Why this priority**: This is the core value. Show-first (2048) keeps the subscription alive and
guarantees *a* notification, but on throttled locked devices the rich upgrade loses the race, so the
notification stays generic. A preview in the push makes the rich notification the common case on exactly
the devices that were degraded.

**Independent Test**: With the app closed and the screen locked, a short 1:1 message push produces a
lock-screen notification bearing the sender and preview with NO `/relay/pending` fetch on the
notification path (unit: the rich note is built from the push preview, not a fetch; device: the real
sender/preview appears on the lock screen; and the full message is present after opening the app).

**Acceptance Scenarios**:

1. **Given** the app is closed/backgrounded and the screen is locked, **When** a text-class message push
   arrives, **Then** the SW peek-decrypts the preview and shows the rich per-chat note without any relay
   fetch, within iOS's execution window.
2. **Given** a locked-state burst of messages, **When** each push wakes the SW, **Then** each ends with a
   visible rich show → no silent-wake strikes → the subscription is not revoked.
3. **Given** the preview fails to decrypt (out-of-order ratchet the device hasn't caught up to, missing
   session), **When** the SW cannot render the preview, **Then** it falls back to show-first behavior
   (generic placeholder now, rich on open) — never a silent wake, never a dropped frame.
4. **Given** a rich preview was shown from the push, **When** the user opens the app, **Then** the full
   message is present with no duplicate notification.
5. **Given** the device has execution budget after the preview show, **When** the best-effort warm tail
   runs, **Then** the SW fetches + persists + acks the full messages so the app opens already warm; the
   warm persists + acks silently (no re-notification of the already-shown preview).
6. **Given** the device is suspended before the warm tail completes, **Then** the frame stays queued and
   the DB warms over WebSocket on open — no message lost, no silent wake (the preview already showed).

---

### User Story 2 - Messages with no previewable text still notify (Priority: P1)

Someone receives a photo, a voice note, or any message whose body is not plain text. They still get a
meaningful notification (e.g. "Alice: 📷 Photo"), because the sender puts a kind-based preview in the push
when there is no text to show.

**Why this priority**: The whole point is that the notification path never needs a fetch; a media message
with no text must still produce a useful, immediate notification rather than falling back to generic.

**Independent Test**: A media-only message yields a push whose decrypted preview renders a kind-based
note ("Photo" / "Voice message"), shown without a fetch. Unit: preview generation maps a text-less
payload to a kind label; device: the labeled notification appears on the lock screen.

**Acceptance Scenarios**:

1. **Given** a media-only message, **When** the sender builds the push preview, **Then** the preview
   carries a kind label (not raw media) and the SW shows "Sender: <kind>".
2. **Given** any text-class message, **When** the sender cannot build a useful preview for some reason,
   **Then** it sends the existing content-free tickle and the SW takes the show-first path (no regression).

---

### User Story 3 - The push provider learns nothing about message length or content (Priority: P1)

The privacy posture is preserved and strengthened: neither Ring's server nor the third-party push service
(Apple/Mozilla/Google) can read the preview, and the push service cannot infer message length from the
push it relays — every preview push is the same size.

**Why this priority**: Constitution Principle I (zero-knowledge boundary) is non-negotiable. A bounded
preview padded to a single constant size removes even the bucket-granular length signal that inlining a
variable full frame would have exposed.

**Independent Test**: For a range of message lengths and kinds, the encrypted preview push is byte-identical
in length. Unit: the padded preview payload is a single constant size for every input.

**Acceptance Scenarios**:

1. **Given** two messages of very different lengths, **When** each preview push is built, **Then** the two
   encrypted payloads have identical byte length.
2. **Given** a preview push, **When** it is observed at the push provider, **Then** it carries no cleartext
   `Topic` header and no cleartext sender/message identifiers (those sit inside the push-encrypted body).

---

### Edge Cases

- **Muted**: dropped SERVER-side (spec 1050 `AllowPush` Row 6 / `MutedPrids`), so no preview push is even
  sent — a muted device is never woken (FR-016). Only in the mute-sync gap can a muted-chat preview reach
  the SW; then the client downgrades it (silenced) and, on iOS, the 2048 machinery ends the wake with a
  silent generic (not nothing) to stay revocation-safe — this is a fallback, not true muting.
- **Muted receipt semantics**: a muted message MUST stay `sent` until the recipient's device actually
  receives it — the server MUST NOT fabricate `notified`/`delivered` for a dropped push. Because the push
  was dropped, no `notified` fires (nothing was decrypted); `delivered` fires only when the recipient's
  device genuinely gets the frame (live over WebSocket if the app is open — mute suppresses only the
  banner, not WS delivery — or on next open otherwise). A muted-offline recipient is therefore
  indistinguishable to the sender from any offline recipient (both sit at `sent`), so the receipt never
  betrays mute. Delivery receipts originate from the recipient's device, never from server optimism.
- **Notifications-off / content-none (client-side)**: the server cannot always know these, so a push may
  arrive; the SW suppresses the content, but on iOS the wake still ends with a silent/generic note (2048)
  rather than silently — showing nothing on iOS would forfeit the subscription. Turning off a whole class
  server-side (`ClassesOff`) is the way to get no push at all.
- **Recipient "hide preview" pref on**: the preview still rides the push (E2EE), but the SW renders "New
  message" AND hides the sender (title "Ring") per the recipient's pref — the device decides display,
  exactly as today with a full fetch.
- **Hidden chat (spec 1019)**: the SW resolves the recipient's local hidden set and renders a content-free
  generic note (no sender/avatar/body, tap → Chats tab); the sealed content is decrypted locally but never
  displayed. The encrypted preview reaching the device is no different from today's full message over the
  wire, and the constant-size push means a hidden-chat message is indistinguishable from any other to the
  server/provider. The `notified` receipt fires on decrypt (FR-015), so a hidden chat does not betray
  itself to the sender via receipt behavior.
- **Foreground + focused**: an OS notification is still shown (revocation-safe, spec 2048 FR-005); the live
  page suppresses its duplicate in-app banner where it can.
- **Decrypt failure / out-of-order ratchet / missing session**: the SW cannot always derive `mk_N` in the
  push context. On any failure it MUST fall back to show-first generic + rich-on-open; never silent, never
  dropped (the full frame is still queued).
- **Legacy iOS (≤16)**: the lite path (spec 2044) shows generic-first without decrypt where SW-context
  IndexedDB/decrypt is unreliable; preview decryption is NOT attempted there.
- **Multi-byte bodies**: the body is truncated by a UTF-8 byte budget on a character boundary, so an
  emoji/non-Latin message cannot blow the constant payload size.
- **Replay/dedupe**: a preview-notified message and its later WS-warmed store dedupe on the frame id; the
  push writes no message, so no dedupe conflict can arise.
- **Notified but never downloaded**: a recipient who sees the preview but never opens the app (so never
  durably downloads) keeps only the preview; if the 35-day relay retention lapses first, the full message
  tail is lost. Acceptable — the preview is the bulk of a short message, the recipient had the retention
  window to open, and the sender legitimately saw "delivered" (the recipient was reached). The server's
  `notified_at` stamp is exactly what lets it reason about these still-owed frames.
- **Sender offline when `notified` fires**: `notified` is a live optimistic receipt; a sender that misses
  it flips to "delivered" later on the durable `delivered` receipt — no worse than today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On every text-class send (1:1 message, reaction, group message; and post/wall activity via
  its own seal), the SENDER MUST build a bounded preview — sender identity hint + a body truncated to a
  fixed UTF-8 byte budget (~256 B) or a kind label when there is no previewable text — and seal it for the
  recipient, attached to the push. The full message is unchanged and still relayed for authoritative
  delivery.
- **FR-002**: The preview MUST be sealed under a per-message key `pk_N = KDF(mk_N, "ring-push-preview")`
  derived from the Double-Ratchet message key `mk_N`, so the recipient SW can peek-derive `mk_N` from the
  ratchet header against a discarded session copy (no persist), derive `pk_N`, and decrypt — with no
  ratchet advancement committed and forward secrecy inherited from `mk_N`. The preview AEAD MUST bind the
  ratchet header as associated data, so a sealed preview cannot be swapped onto, or replayed against, a
  different frame (open MUST fail if the header does not match the sealed one).
- **FR-003**: The preview push payload (ratchet header + preview AEAD) MUST be padded to a single constant
  byte length for all messages, so payload size reveals nothing about message length or kind. The push MUST
  carry no cleartext `Topic` header and no cleartext sender/message identifiers.
- **FR-004**: On a preview push, the SW MUST decrypt the preview and show the rich per-chat notification
  WITHOUT any `/relay/pending` fetch on the notification path, and MUST NOT persist ratchet state, store
  the message, or ack the frame. The full frame remains in the relay queue for the authoritative
  open/drain path to consume exactly as today.
- **FR-005**: On any preview-decrypt failure (out-of-order ratchet, missing session, malformed payload),
  the SW MUST fall back to spec-2048 show-first behavior (visible placeholder now, rich on open) and MUST
  NOT end the wake silently or drop the frame.
- **FR-006**: Because the preview decrypt consumes nothing, delivery-by-push and the later authoritative
  warm/open MUST converge to a single stored message with correct receipts: the preview show emits a small
  fire-and-forget **`notified`** receipt off the display path (which does NOT dequeue the relay frame); the
  warm/open path performs the one authoritative decrypt+store+ack and emits **`delivered`**, dequeuing on
  ack. No dedupe conflict can arise because the preview never writes a message.
- **FR-013**: A new **`notified`** delivery state MUST be introduced, distinct on the server from
  `delivered`: `notified` = the recipient device showed the preview but has not durably downloaded the
  message (frame still queued); `delivered` = the message was fetched + persisted authoritatively (frame
  dequeued on ack). To the SENDER's UI, `notified` and `delivered` MUST render identically ("delivered").
  The server MUST relay `notified` to the sender live and stamp `notified_at` on the relay row so it can
  distinguish seen-but-not-downloaded frames; it MUST dequeue only on `delivered` (ack). `notified` is an
  optimistic live receipt (not durably reconciled); a missed `notified` is superseded by `delivered`.
- **FR-007**: The server MUST NOT be able to read the preview and MUST store no new plaintext or metadata:
  the sealed preview blob travels in the existing WebSocket send frame and is forwarded into the push at
  enqueue time; it is opaque ciphertext to the server. No new server-visible field and no schema change is
  required (the preview is used transiently at push time, not persisted).
- **FR-008**: Show-first (spec 2048), the legacy lite path (spec 2044), quiet-note downgrade, muted/off
  suppression, badge, and coalescing semantics MUST NOT regress. The preview path is layered on the
  existing wake guard, not a replacement for it.
- **FR-009**: The relay queue's delete-on-ack invariant MUST hold: a preview push MUST NOT ack or dequeue
  the frame (it only displays); the frame is drained exactly once by the authoritative open/drain path when
  the device acks, so it neither lingers nor double-delivers.
- **FR-010**: Forward secrecy MUST be preserved: because `pk_N` derives from `mk_N`, an encrypted preview
  push captured at the push provider MUST NOT be decryptable once the corresponding message has been
  processed authoritatively (warm tail or open), which deletes `mk_N`. The preview MUST NOT introduce any
  standing, long-lived content key.
- **FR-011**: After the preview is shown, the SW SHOULD run the existing spec-1032 authoritative warm
  (`tryAuthoritativeDrain`: fetch → authoritative decrypt → persist → ack) on a best-effort basis, so a
  device with budget opens already warm. It MUST run strictly AFTER the visible show (so a suspend/hang
  cannot cause a silent wake), MUST respect the existing 1032 eligibility gates (self-degrading when it
  cannot persist safely), and MUST leave the frame queued for the open path when it does not complete.
- **FR-012**: The warm tail MUST NOT re-notify a message already shown by the preview: it persists + acks
  such frames silently (the preview's `markShown(id)` feeds the drain's dedupe), producing no duplicate or
  re-buzzed notification. It MAY still surface a notification for any NEW frame the preview did not cover.

- **FR-014**: The preview MUST be rendered ONLY through the existing `noteForPayload` choke point, passed
  the RECIPIENT's own local hidden set (spec 1019) and notification prefs (global "Show notifications",
  per-chat mute, per-chat web-push, per-chat content level, and global "Show preview"). A hidden chat MUST
  render a content-free generic note (no sender, no avatar, no body, tap → Chats tab); "Show preview" off
  MUST hide both body AND sender; muted / content-none / web-push-off / master-off MUST suppress exactly
  as the fetch path does today. The sender-sealed content MUST NOT be displayed in any way these
  recipient-local rules forbid. `previewInline` MUST source the hidden set + prefs the same way
  `previewPending` does — never defaulting them to empty/permissive.
- **FR-016**: The preview push MUST pass through the identical server-side `AllowPush` gate (spec 1050) as
  the content-free tickle, evaluated on the SAME frame `class`/`prid`/`sender`. A muted conversation
  (`prid` ∈ `MutedPrids`), a classes-off class, or any other server-side suppression MUST result in NO
  push at all — neither tickle nor preview — so a muted device is never woken (true muting, no silent-wake
  strike). Server-side drop is the PRIMARY muting mechanism; the client-side pref suppression (FR-014) is a
  revocation-safe fallback for the mute-sync gap only and, on iOS, ends with a silent generic rather than a
  silent wake — it MUST NOT be relied on as the mechanism for true muting.
- **FR-015**: The `notified` receipt MUST fire on successful preview DECRYPT (the device received the
  message), NOT gated on whether a visible notification was shown — so it is identical for shown, generic
  (hidden), and suppressed (muted) outcomes and cannot reveal the recipient's private mute/hidden/preview
  prefs via receipt presence or timing (matching today's mute-independent delivery receipt). A preview
  DECRYPT FAILURE fires no `notified`; the later warm/open `delivered` covers it.

### Key Entities *(include if feature involves data)*

- **Push preview**: a small sealed blob = ratchet header (sender DH pubkey + counters, needed to derive
  `mk_N`) + AEAD(`pk_N`, {sender hint, truncated body or kind}). Padded to one constant size. Distinct
  from the full relayed frame; carries only what a notification UI can display.
- **Preview key `pk_N`**: `KDF(mk_N, "ring-push-preview")`, per message, never persisted, forward-secret.
- **Constant padding size**: the single fixed payload length every preview push is padded to (via the
  spec-2046 `RecordSize` mechanism), well under the constrained-endpoint limit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A locked-state text-class message shows the real sender + preview with NO relay fetch on the
  notification path (unit: rich note built from the push preview; device: sender/preview on lock screen
  while closed + locked; and the full message present after opening).
- **SC-002**: A locked-state burst shows a rich notification per wake and produces **no `410 Unregistered`
  prune** afterward (device + prod-log verified).
- **SC-003**: A media-only message notifies with a kind label ("Photo"/"Voice message") from the push, no
  fetch (unit + device).
- **SC-004**: Every preview push is byte-identical in length across a range of message lengths and kinds
  (unit: constant-size truth table).
- **SC-005**: A preview-notified message and its on-open WS warm dedupe to one stored message with correct
  receipts and no duplicate notification (unit + drive).
- **SC-006**: A preview push captured before the message is processed cannot be decrypted after the
  authoritative open deletes `mk_N` (unit: forward-secrecy property of `pk_N`).
- **SC-007**: Existing suites (1194+) plus the 2044 legacy path and 2048 show-first path stay green; no
  server plaintext exposure introduced (checklist-verified).
- **SC-008**: On an eligible device with budget, after the preview show the warm tail persists + acks the
  frames so opening the app requires no WS re-fetch; the warm produces no duplicate notification (unit:
  warm runs after show, dedupes on the shown ledger; device: app opens warm with messages already present).
- **SC-009**: The sender's message flips to "delivered" as soon as the recipient's device decrypts the
  preview (via the `notified` receipt), before any download; the relay frame is NOT dequeued until the
  authoritative `delivered`+ack (unit: `notified` relays to sender + stamps `notified_at` + leaves the
  frame queued; `delivered` dequeues).
- **SC-011**: A muted conversation (`prid` ∈ `MutedPrids`) or a classes-off class produces NO push —
  neither tickle nor preview (unit: `AllowPush` gates the preview identically to the tickle; the muted
  device is never woken).
- **SC-010**: Privacy parity with the fetch path (unit, via `noteForPayload`): a hidden chat → content-free
  generic (no sender/body); "Show preview" off → generic title + "New message"; muted / content-none /
  web-push-off / master-off → suppressed; and the `notified` receipt fires identically across shown,
  generic, and suppressed outcomes (no mute/hidden leak).

## Zero-Knowledge Impact

**Server: unchanged and blind.** The sealed preview blob is opaque ciphertext the server forwards from the
WebSocket send frame into the push at enqueue time; it stores no new plaintext, adds no column, and cannot
read the preview any more than it can read the message. Constitution Principle I holds.

**Push provider (Apple/Mozilla/Google): strictly less than the full-frame alternative.** The Web Push body
is separately encrypted to the browser (RFC 8291 aes128gcm — the path spec 2046 tuned via `RecordSize`), so
the provider cannot read the preview; our AEAD-sealed preview inside it is double-encrypted. Versus today's
constant tickle, the only theoretical new signal is payload size — which a single constant padding size
removes entirely (SC-004): every preview push is identical in length, so the provider learns nothing about
message length or kind. Inline `sender`/`id` live inside the push-encrypted body (invisible to the
provider), and preview pushes carry **no `Topic` header** — one fewer cleartext field than today's tickle.
Net: the provider observes only endpoint + timing + a constant size, same as (indeed less than) today.

**Forward secrecy preserved.** The preview key `pk_N = KDF(mk_N, "ring-push-preview")` inherits the
ratchet's forward secrecy: `mk_N` is deleted when the message is processed authoritatively on open, after
which a captured encrypted preview push cannot be decrypted (FR-010, SC-006). No standing content key is
introduced. The outer RFC-8291 layer uses the long-lived subscription keys, but the inner preview AEAD is
forward-secret, so a compromise of the subscription keys alone does not reveal preview content.

**`notified` receipt + `notified_at`: ZK-neutral.** The new `notified` state reveals to the server exactly
what `delivered` already does — that the recipient's device was reached (reachability + timing) — and
carries no message content. `notified_at` is a timestamp on the relay row (no plaintext). Neither widens
what the server learns beyond the receipt metadata it already handles.

A dedicated **`checklists/zero-knowledge.md`** gates this spec; the preview-key construction and FS
property are explicitly on it for security review before implement.

## Assumptions

- Notification UIs on every target platform (iOS/iPadOS, Android Chrome, macOS/Windows desktop) truncate
  the body to a few hundred characters at most; a ~256-byte preview overfills the visible area everywhere,
  so no display fidelity is lost versus sending the full message.
- The full message continues to arrive and store authoritatively over WebSocket on app open, so the push
  storing nothing loses no content — it is a pure display accelerator.
- The sender can build and seal a preview cheaply at send time (it already has `mk_N` when sealing message
  N), and the recipient SW can peek-derive `mk_N` from the ratchet header for the common in-order case; the
  out-of-order/behind cases fall back to rich-on-open (FR-005), which is today's behavior.
- Push routing (spec 1050) continues to suppress muted/notifications-off pushes server-side.
- A single constant preview size fits comfortably under the aes128gcm/constrained-endpoint limit that
  caused the spec-2046 Firefox 413.
