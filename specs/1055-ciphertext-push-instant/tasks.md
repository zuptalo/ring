# Tasks: Instant rich notifications (bounded encrypted preview in push)

**Spec**: `specs/1055-ciphertext-push-instant/spec.md` · **Plan**: `./plan.md`
**Branch**: `feat/1055-ciphertext-push-instant`

Constitution: TDD (red → green), zero-knowledge boundary intact, tests against the fake store / vitest.
Legend: `[P]` = parallelizable (different files, no incomplete-dep). Story labels map to spec user stories.

**GitHub issues** (feature→develop PR must `Closes` each): Phase 1 #1059 · Phase 2 #1052 · Phase 3 #1053 ·
Phase 4 #1054 · Phase 5 #1055 · Phase 6 #1056 · Phase 7 #1057 · Phase 8 #1058.

## Phase 1: Setup

- [ ] T001 Bump `package.json` version 1.0.9 → 1.0.10 (first change of the new cycle; release guard)
- [ ] T002 [P] Add embedded migration `server/internal/db/migrations/NNNN_relay_notified_at.sql` — nullable
  `notified_at timestamptz` on the relay queue table (ZK-neutral timestamp; new DBs create it, existing DBs alter)

## Phase 2: Foundational — crypto primitives (BLOCKS every story)

**Tests first (red):**

- [ ] T003 [P] Write `src/services/crypto/push-preview.test.ts`: `derivePreviewKey(mk)` is deterministic and
  domain-separated (different label/mk → different key); `sealPushPreview`/`openPushPreview` round-trip;
  `openPushPreview` throws on a tampered header (AD binding) or wrong key
- [ ] T004 [P] Add to `push-preview.test.ts` the **forward-secrecy** test (SC-006): after the message is opened
  authoritatively (its `mk_N` consumed/deleted), `openPushPreview` for that frame fails — a captured preview
  cannot be decrypted post-processing
- [ ] T005 [P] Add `buildPreview(payload)` tests: truncate text to a UTF-8 byte budget (~256 B) on a character
  boundary (multi-byte/emoji cannot overflow); text-less payloads (media, reaction, call-event, game) map to a
  kind label ("Photo"/"Voice message"/…); output carries no recipient-specific data

**Implementation (green):**

- [ ] T006 Implement `derivePreviewKey(mk) = KDF(mk, "ring-push-preview")` in `src/services/crypto/push-preview.ts`
  (libsodium KDF; single domain-separated purpose), reusing `ratchet.ts` message-key derivation
- [ ] T007 Implement `sealPushPreview(mk_N, header, preview) → previewAEAD` (AEAD under `pk_N`, ratchet `header`
  bound as associated data) and `buildPreview(payload)` (bounded truncation + kind labels) in `push-preview.ts`
- [ ] T008 Implement `openPushPreview(chatId, header, previewAEAD) → preview` in `push-preview.ts`: `loadSession`
  a FRESH copy, peek-derive `mk_N` from `header` (existing preview derivation, never `saveSession`),
  `derivePreviewKey`, AEAD-open with `header` as AD; throw → caller falls back (FR-005). Assert (unit) no
  `saveSession` call (FR-004 consumes nothing)

## Phase 3: US1 — Locked phone shows real sender + preview instantly (P1) 🎯 MVP

**Sender side (tests → impl):**

- [ ] T009 [P] [US1] Test `src/services/messaging.ts`: sealing message N also produces a sealed push-preview
  from the same `mk_N` alongside the wire frame (round-trips with `openPushPreview`)
- [ ] T010 [US1] Implement in `messaging.ts`: after deriving `mk_N` to seal the body, `buildPreview(payload)` →
  `sealPushPreview(mk_N, header, preview)`; return the sealed preview beside the wire frame
- [ ] T011 [US1] Thread the sealed preview through send + group pairwise fan-out in `src/db/queries.ts`
  (`:627-641`) — one preview per pairwise recipient (each has its own `mk_N`)
- [ ] T012 [US1] Include `pushPreview` (opaque b64) in the WS `msg` frame in `src/services/api.ts` (+ WS send path)

**Server side (tests → impl):**

- [ ] T013 [P] [US1] Test `server/internal/ws/hub.go`: the `msg` frame carries optional `PushPreview`; when
  `AllowPush` permits and a preview is present → inline notify variant fired; no preview → tickle
- [ ] T014 [US1] Add `PushPreview []byte` to the `frame` struct (`hub.go:109-119`); at the notify point
  (`:1296`) fire the inline notify variant (id, sender, header, previewAEAD) transiently — NOT stored in the
  relay row — gated by `AllowPush` (see T024)
- [ ] T015 [P] [US1] Test `server/internal/push/push.go`: `previewPushPayload(msgId, from, header, previewAEAD)`
  builds the `{"t":"msgx",...}` JSON with `from`/`id` inside the (push-encrypted) body
- [ ] T016 [US1] Implement `previewPushPayload` + the inline `attempt` variant in `push.go` (omit `Topic` on
  inline — see T022)

**SW side (tests → impl):**

- [ ] T017 [P] [US1] Test `src/services/sw-inbox.ts` `previewInline(frame)`: renders a rich per-chat note from an
  in-payload frame with NO fetch; decrypt failure → empty (caller shows generic, FR-005); dedupe id == msg_id;
  group frame (groupId in preview) → group note; reaction → reaction note
- [ ] T018 [US1] Implement `previewInline(frame)` in `sw-inbox.ts`: `sessionKeyForPeer` → `openPushPreview` →
  render via `noteForPayload` (recipient's hidden set + prefs — see T027) → `aggregate` → `richNoteOptions`
- [ ] T019 [US1] In `src/sw.ts`: `pushKind` recognizes `msgx`/`postx` (`:454-466`); add the inline dispatch arm
  in `dispatchPush` under `runGuardedWake`; on success `showNotes` + `markShown(id)` + `postNotified(id)`; on
  any failure `showGeneric('preview-fallback')` (FR-005); `isLegacyIOS` short-circuits to the lite path first
- [ ] T020 [US1] Test + wire the **best-effort warm tail** (FR-011/012): after the show, call
  `tryAuthoritativeDrain(ctx)` (`sw.ts:605`); ensure a preview-shown id is persisted + acked but NOT re-notified
  (dedupe via the shown ledger); flip `sw.fullPersist` default ON for non-legacy devices (still gated by 1032
  eligibility). Test: warm runs after show, no duplicate notification (FR-012, SC-008)

## Phase 4: US2 — Media / no-text messages still notify (P1)

- [ ] T021 [US2] Test + confirm (covered by T005/T007 `buildPreview`): a media-only payload yields a kind-label
  preview; `previewInline` renders "Sender: Photo"; if no useful preview can be built, the sender omits
  `pushPreview` and the server sends the tickle (SW show-first) — no regression (SC-003)

## Phase 5: US3 — Push provider learns nothing (constant size) (P1)

- [ ] T022 [P] [US3] Test `push.go`: every preview push is byte-identical in length across message lengths/kinds
  (constant `PREVIEW_RECORD_SIZE`); inline path omits the `Topic` header, tickle keeps it (SC-004, FR-003)
- [ ] T023 [US3] Set `RecordSize` to the single constant `PREVIEW_RECORD_SIZE` for the inline path (replacing the
  `len+128` of `recordSizeFor` `:184-186`), sized under the 2046 constrained-endpoint ceiling; omit `Topic` inline

## Phase 6: Cross-cutting — muting gate, notified/delivered receipts, privacy parity

**Muting (FR-016):**

- [ ] T024 [P] Test `hub.go`/`push.go`: a muted `prid` (∈ `MutedPrids`) or a classes-off class yields NO push at
  all — neither tickle nor preview (`AllowPush` gates the preview identically to the tickle) (SC-011); and the
  muted frame gets NO `notified`/`delivered` receipt until it is genuinely received (WS/ack) — the server never
  fabricates a receipt for a dropped push (muted stays `sent`, indistinguishable from offline)
- [ ] T025 Wire the preview notify through the SAME `AllowPush(class, prid, sender, prefs)` gate as the tickle
  (`push.go:301`) so muted/classes-off drop the preview (implements the T024 red)

**`notified` receipt (FR-013/FR-015):**

- [ ] T026 [P] Test `server/internal/api/relay_handlers.go`: `POST /v1/relay/notified` stamps `notified_at`,
  relays a `notified` receipt to the sender via `Hub.Send`, and does NOT `DeleteRelay` (row survives);
  `delivered`+ack still dequeues
- [ ] T027 Implement `POST /v1/relay/notified` (`relay_handlers.go` + `router.go` + `store/relay.go` stamp helper)
  reusing the no-dequeue pattern (`relayPending:56-66`); `src/services/push.ts` `postNotified(id)` helper
- [ ] T028 [P] Test + implement sender-side receipt mapping: an incoming `notified` receipt maps a sent message to
  the SAME visual state as `delivered` (the delivery-status update path); `postNotified` fires on DECRYPT
  regardless of shown/generic/suppressed outcome (FR-015 — no mute/hidden leak)

**Privacy parity (FR-014, SC-010):**

- [ ] T029 [P] Test in `sw-inline.test.ts` (via `noteForPayload`): hidden chat → content-free generic (no
  sender/body, tap → Chats); "Show preview" off → generic title + "New message"; muted-sync-gap/content-none →
  suppressed → on iOS a silent generic (not nothing). Assert `previewInline` sources the recipient's hidden set +
  prefs (never defaults them permissive) (FR-014)

## Phase 7: Post / wall activity (extends "all text-class")

- [ ] T030 [P] Test + implement `postx` preview for post/wall activity: seal a bounded preview under `K_post`
  (non-ratchet, stateless — `openReceivedPost`/`openPostEngagement`), `{"t":"postx","post":id,"p":…}`, no `Topic`,
  same constant size; SW `previewInline` post-branch renders it; gated by `AllowPush("post"/"activity", …)`

## Phase 8: Verify

- [ ] T031 `npm run build` (vue-tsc typecheck) green; full vitest green (existing 1194+ unaffected, SC-007)
- [ ] T032 `cd server && go build ./... && go vet ./... && go test ./...` green
- [ ] T033 Update spec `**Status**:` → in-review; `make roadmap`; ride the branch
- [ ] T034 Device pass (locked iPhone 15 Pro, app closed): short 1:1 / group / reaction → real sender + preview,
  no fetch; photo → "Photo"; open app → full messages present, no dup notification; muted chat → nothing; hidden
  chat → generic; prod DB → no `410` prune after a locked burst; sender sees "delivered" without the device opening

## Dependencies

- Phase 2 (crypto) blocks Phase 3–7.
- T014 (hub notify) depends on T025 (AllowPush gate) — wire the gate first or together.
- T018 (previewInline) depends on T008 (openPushPreview) and T027 (noteForPayload prefs sourcing).
- T020 (warm tail) depends on T019 (inline arm shows first).
- MVP = Phase 1–3 (US1). US2/US3/receipts/parity harden it; Phase 7 extends to posts.
