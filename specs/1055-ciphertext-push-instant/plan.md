# Implementation Plan: Instant rich notifications (bounded encrypted preview in push)

**Spec**: `specs/1055-ciphertext-push-instant/spec.md`
**Branch**: `feat/1055-ciphertext-push-instant`
**Status**: in-progress

## Summary

The sender seals a small, display-sized **preview** (sender hint + a body truncated to ~256 UTF-8
bytes, or a kind label like "Photo") under a per-message key derived from the Double-Ratchet message
key, and attaches it to the Web Push. The service worker peek-decrypts the preview from the push and
shows a rich notification with no `/relay/pending` fetch. It consumes nothing — no persist, no store,
no ack; the full message still warms + stores authoritatively over WebSocket on app open. Because the
preview is bounded and padded to one constant size, the push provider learns nothing about message
length, and there is no padding ladder and no large-message fallback. Forward secrecy is inherited
from the ratchet message key.

## Constitution Check (Principle I — zero-knowledge)

- **Server sees nothing new.** The sealed preview travels in the existing WS send frame and is
  forwarded into the push at enqueue time (`hub.go` msg case, ~`:1262-1300`); it is opaque ciphertext
  to the server. No plaintext, no new column, no schema change — used transiently at push time. ✅
- **Push provider: strictly less than full-frame inlining.** RFC-8291 encrypts the push body to the
  browser; our preview AEAD inside it is double-encrypted. A single constant padding size removes the
  only new signal (payload length). `from`/`id` are inside the encrypted body; no `Topic` header. ✅
- **Forward secrecy.** `pk_N = KDF(mk_N, "ring-push-preview")` inherits the ratchet's FS; `mk_N` is
  deleted on authoritative open, after which captured preview pushes are undecryptable. No standing
  content key. ✅
- **`checklists/zero-knowledge.md` gates this spec**, with the preview-key construction + FS property
  called out for security review before implement.

## Crypto design (the new surface — review target)

Reuses the existing pure ratchet core (`src/services/crypto/ratchet.ts`, `message.ts`); the message
key derivation is already exercised by `ratchetDecryptPreview` / `openMessagePreview` /
`previewOpen(persistAdvance=false)` (which "loads a fresh session copy, writes nothing").

- **Sender (has `mk_N` when sealing message N):**
  - `derivePreviewKey(mk) = KDF(mk, "ring-push-preview")` — new, in `crypto/` (libsodium
    `crypto_kdf`/HKDF-style; single-purpose, domain-separated string).
  - `sealPushPreview(mk_N, header, preview) → previewAEAD`: AEAD-seal the bounded preview with
    `pk_N`, binding the ratchet `header` as associated data (anti-tamper / anti-swap).
  - `buildPreview(payload) → {kind, body}`: pure — truncate `payload` text to a UTF-8 byte budget on
    a char boundary, or map a text-less payload (media, reaction, game, call-event) to a kind label.
    Honors nothing recipient-specific (recipient prefs are applied at render, SW-side).
- **Recipient SW (peek, no persist):**
  - `openPushPreview(chatId, header, previewAEAD) → preview`: load a fresh session copy
    (`loadSession`), peek-derive `mk_N` from `header` (the existing preview derivation path, advancing
    only the discarded copy — never `saveSession`), `derivePreviewKey`, AEAD-open with `header` as AD.
    Returns the bounded preview or throws → caller falls back (FR-005).
- The push carries the ratchet **header** (needed to derive `mk_N`; ~40–100 B, effectively fixed) +
  the **preview AEAD** (~256 B body + tag). Total padded to one constant size.

## Architecture

### Wire shape

- **Preview push (new):** `{"t":"msgx","id":<msgId>,"from":<senderId>,"h":<b64 header>,"p":<b64 previewAEAD>}`.
  `from` resolves the session before decrypt; `id` is the dedupe/mark-shown key. **No `Topic` header**
  (each preview push must survive independently — a shared Topic would collapse a burst to only the last).
- **Post preview (new):** `{"t":"postx","post":<id>,"p":<b64 sealed engagement/post preview>}` — sealed
  under `K_post` (non-ratchet, stateless); same no-Topic rule.
- **Tickle (unchanged):** `{"t":"msg"}` — kept as the fallback when the sender cannot build a preview
  (rare) and for any path that must degrade; keeps its collapsing `Topic`.

### Sender / send path (`src/`)

1. `src/services/messaging.ts` — where a message is sealed for a peer (`sealForChat` /
   `openMessage` counterparts): after deriving `mk_N` to seal the body, also `buildPreview(payload)` →
   `sealPushPreview(mk_N, header, preview)` and return the sealed preview alongside the wire frame.
2. `src/db/queries.ts` — the send orchestration (incl. group pairwise fan-out `:627-641`): thread the
   sealed preview through so it is attached to the WS send.
3. `src/services/api.ts` / WS send — include `pushPreview` (opaque b64) in the `msg` frame sent to the
   server. Groups: one preview per pairwise recipient (each has its own `mk_N`).

### Server (`server/`)

4. `internal/ws/hub.go` — the `msg` frame gains an optional `PushPreview []byte` (`frame` struct
   `:109-119`). At the notify point (`:1296`), the preview push MUST pass the SAME `AllowPush(class, prid,
   sender, prefs)` gate (spec 1050, `push.go:301`) as the tickle — a muted `prid` / classes-off yields NO
   push at all, tickle OR preview (FR-016; true muting, no silent wake). When the gate permits AND a
   preview is present, fire a new inline notify variant carrying `id`, sender, header, previewAEAD; when the
   gate permits but there's no preview (rare), fall back to the tickle. The preview is used transiently here
   — **not** stored in the relay row.
5. `internal/push/push.go` — `previewPushPayload(msgId, from string, header, previewAEAD []byte) []byte`
   builds the `{"t":"msgx",...}` JSON; set `RecordSize` to a single **constant** (replacing the
   `len+128` of `recordSizeFor` `:184-186`) so every preview push is byte-identical; omit the `Topic`
   header on the inline path (keep it on tickles).
6. **`notified` receipt (new state, FR-013):** new `POST /v1/relay/notified` (`relay_handlers.go` +
   `router.go`) that, per id: looks up the sender from the relay row, stamps `notified_at` on the row, and
   `Hub.Send(sender, {status:"notified", id})` — **without** `DeleteRelay` (reuses the no-dequeue pattern
   in `relayPending` `:56-66`). The SW calls it fire-and-forget after a successful preview show. The
   existing `delivered` (fetch/ack in `relayPending`/`relayAck`) is unchanged and still dequeues on ack.
   *(Not marked at send time — that would lie if iOS drops the push.)* Migration: one `NNNN_relay_notified_at.sql`
   adding a nullable `notified_at timestamptz` to the relay queue table (ZK-neutral timestamp).

### Client SW (`src/`)

7. `src/sw.ts` — `pushKind` (`:454-466`) recognizes `msgx`/`postx`. In `dispatchPush` (`:945+`), an
   inline arm runs under `runGuardedWake` (`sw-inbox.ts:204-236`) so every wake ends visibly.
8. `src/services/sw-inbox.ts` — `previewInline(frame): SwNote[]`: `sessionKeyForPeer(chats, frame.from)`
   (`:275`) → `openPushPreview(chatId, frame.h, frame.p)` → render through `noteForPayload` (`:321-687`)
   **passing the recipient's own hidden set + prefs sourced exactly as `previewPending` does** (FR-014 —
   hidden chat → content-free generic, "Show preview" off → hide sender+body, muted/content-none/
   web-push-off/master-off → suppress; never default these to empty/permissive) → `aggregate` (`:692`) →
   `richNoteOptions` (`:88`, no `renotify`). Fire `postNotified(id)` on successful DECRYPT (FR-015),
   independent of the display outcome (no mute/hidden leak). Best-effort `markShown(id)` so an on-open warm
   does not double-notify (a failed write only risks a duplicate, never a desync).
9. Show + fallback: on success `showNotes(notes)` (`sw.ts:281`) + best-effort `markShown(id)` +
   fire-and-forget `postNotified(id)` (the new `notified` receipt). On ANY failure →
   `showGeneric('preview-fallback')` (`sw.ts:151`), rich on open (FR-005). Never silent, never dropped.
   Legacy iOS (`isLegacyIOS`, spec 2044) short-circuits to the lite path BEFORE any decrypt.
10. **Best-effort warm tail (FR-011/FR-012).** After the preview show, call the EXISTING
    `tryAuthoritativeDrain(ctx)` (`sw.ts:605`, spec 1032) — the same fetch+persist+ack path iOS-17+ uses
    today, now moved OFF the critical display path. It self-gates on 1032 eligibility (returns `'degrade'`
    → skip, DB warms on open). The only new wiring: the drain must NOT re-notify ids the preview already
    showed — the preview's `markShown(id)` already feeds the shown ledger (`sw-inbox.ts:308`,
    `drainPersistPending` filters/`markShown` at `sw.ts:616-619`), so ensure a preview-shown id is
    persisted + acked but not re-surfaced by `showNotes` (persist/ack silently). The peek (discarded
    `mk_N`, no lock) and the warm's authoritative open (real `mk_N`, session Web Lock in `sw-drain.ts:215`)
    are serialized by `serializeNotify` and do not collide. Ordering invariant: **show → warm**, so a
    suspend/hang in the warm cannot cause a silent wake.

## Padding — constant size (SC-004)

`RecordSize` is set to a single fixed value `PREVIEW_RECORD_SIZE` (header cap + 256 B body + AEAD tag
+ json overhead + record overhead), well under the ~4 KB constrained-endpoint ceiling (spec 2046). The
webpush library pads every preview record up to it → identical encrypted length for all previews. No
ladder, no per-message size decision.

## Testing

- **Server (`go test`):** `previewPushPayload` shape; `RecordSize` constant across inputs (identical
  byte length); inline path omits `Topic`, tickle keeps it; hub attaches preview when present and routing
  permits, else tickle; **a muted `prid` (in `MutedPrids`) or a classes-off class yields NO push at all —
  neither tickle nor preview (FR-016)**; `POST /v1/relay/notified` stamps `notified_at`, relays a `notified`
  receipt to the sender, and does NOT dequeue (relay row survives); `delivered`+ack still dequeues. Fake store.
- **Client (vitest):** `buildPreview` truncation (UTF-8 byte budget on a char boundary; kind labels for
  media/reaction/call); `derivePreviewKey` determinism + domain separation; `sealPushPreview`/
  `openPushPreview` round-trip; `openPushPreview` leaves NO persisted session (assert `saveSession` not
  called); **FS test** — after the message is opened authoritatively (mk_N gone), `openPushPreview` fails
  (SC-006); `previewInline` renders rich note with no fetch; decrypt failure → empty → caller shows generic
  (FR-005); muted chat → quiet downgrade; group frame (groupId in preview) → group note; reaction → reaction
  note; dedupe id == msg_id; **hidden chat → content-free generic (no sender/body); "Show preview" off →
  generic title + "New message"; muted/content-none → suppressed (FR-014, parity with fetch path)**;
  `postNotified` fires on decrypt regardless of shown/generic/suppressed outcome (FR-015, no mute/hidden
  leak); an incoming `notified` receipt maps a sent message to the same visual as `delivered`; warm tail
  after a preview show persists+acks but does NOT re-notify an already-shown id (FR-012). New
  `crypto/push-preview.test.ts`, `sw-inline.test.ts` (+ `sw-quiet.test.ts` edits).
- **Typecheck:** `npm run build` (vue-tsc).
- **Device:** locked iPhone 15 Pro, app closed → short 1:1, group, reaction → each shows real
  sender + preview, no fetch; photo → "Photo" label; open app → full messages present, no dup
  notification; prod DB → no `410` prune after a locked burst; sender sees "delivered" without the
  device opening.

## Files to touch

- `src/services/crypto/` — `derivePreviewKey`, `sealPushPreview`, `openPushPreview`, `buildPreview`
  (new `push-preview.ts` or extend `message.ts`); reuse `ratchet.ts` key derivation
- `src/services/messaging.ts` — produce the sealed preview alongside the frame
- `src/db/queries.ts` — thread preview through send + group fan-out
- `src/services/api.ts` — include `pushPreview` in the WS `msg` frame
- `src/sw.ts` — `pushKind` `msgx`/`postx`, inline dispatch arm under `runGuardedWake`
- `src/services/sw-inbox.ts` — `previewInline`, wiring to `openPushPreview` + `noteForPayload`
- `src/services/push.ts` — `postNotified(id)` fire-and-forget helper (the new `notified` receipt)
- receipt handling (sender side) — map an incoming `notified` receipt to the same visual as `delivered`
- `src/sw.ts` — also enable the warm tail by default for non-legacy devices (flip `sw.fullPersist`
  default on, still gated by 1032 eligibility)
- `server/internal/ws/hub.go` — `PushPreview` on the msg frame; inline-vs-tickle notify; `notified` receipt relay
- `server/internal/push/push.go` — `previewPushPayload`, constant `RecordSize`, omit `Topic` on inline
- `server/internal/api/relay_handlers.go` + `router.go` — `POST /v1/relay/notified` (stamp `notified_at`, no dequeue)
- `server/internal/store/relay.go` — `notified_at` stamp helper; `internal/db/migrations/NNNN_relay_notified_at.sql`
- tests: `crypto/push-preview.test.ts`, `sw-inline.test.ts`, `sw-quiet.test.ts`, `push_test.go`,
  `relay_handlers_test.go`
- `package.json` — bump 1.0.9 → 1.0.10 (first change of the new cycle; release guard)

## Risks & mitigations

- **New crypto surface (preview key)** → domain-separated KDF from `mk_N`, header bound as AD, no
  standing key, FS test (SC-006); on the ZK checklist for explicit security review before implement.
- **Topic collapsing drops burst content** → preview pushes send NO Topic; SW-side per-chat tag still
  coalesces the notifications.
- **Sender preview leaks recipient-hidden content?** No — the preview is E2EE to the recipient device;
  the SW applies the recipient's hide-preview/mute prefs at render, exactly as with a full fetch today.
- **Peek mutates in-memory state** → always operate on a freshly `loadSession`'d copy, never `saveSession`;
  never peek against a shared live state object (research caveat).
- **Double-notify (push shows, open re-shows)** → best-effort `markShown(id)`; worst case a duplicate,
  never a desync or lost message.
- **Constant size too large for a constrained endpoint** → `PREVIEW_RECORD_SIZE` is a `go test` constant
  far under the 2046 ceiling; easy to tune down.
- **iOS still throttles very rapid bursts** (OS-level) → subscription stays alive, throttled messages
  arrive on next wake/open, not lost (unchanged from spec 2048).

## Out of scope

- Calls (own fast ring path, spec 2031/2034).
- Making rich previews work on iOS ≤16 (spec 2044 lite path stands).
- A user-facing toggle (default-on by decision; no setting).
- Store-from-push / changing the authoritative open/drain store+ack path (untouched — inline consumes
  nothing; the full message always warms over WS on open).
- Any standing/long-lived notification content key (explicitly rejected for FS — FR-010).
