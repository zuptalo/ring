# Tasks: Messages store on push so the app opens warm

**Input**: Design documents from `specs/1032-store-messages-push/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/sw-receive.md

**Tests**: TDD is constitutionally mandated (Principle III). Every phase orders failing
tests before the implementation that satisfies them. Crypto changes additionally carry the
Principle IV adversarial suites (forgery, replay, out-of-order, skipped-key).

**Organization**: Foundational lock/transaction plumbing first (it is a strict safety
improvement even with the flag off), then user stories in priority order.

## Phase 1: Setup

- [ ] T001 Define the internal rollout flag: add the `sw.fullPersist` settings-store key
      (typed constant + default-absent read helper) where SW-safe settings constants live,
      alongside its read in `src/services/sw-inbox.ts` style — no Settings UI entry
      (`src/services/sw-inbox.ts` / shared constants module)
- [ ] T002 Extend the dev-only test hook with `drainPending()` and a settings setter for
      the flag in `src/services/testhook.ts` (stripped from production builds; mirrors the
      existing `previewPending`/`disconnect`/`reconnect` hooks)

## Phase 2: Foundational (blocking — cross-context safety plumbing)

**Purpose**: the lock discipline, atomic transaction, and reactivity bridge every story
depends on. Ships safely even with the flag off.

- [ ] T003 [P] Write failing unit tests for the named-lock helpers in
      `src/services/cross-lock.test.ts`: exclusive ordering across two simulated contexts
      (fake `navigator.locks`), `ring:inbound` vs `ring:session:<chatId>` never inverted,
      SW-side timeout raises typed `LockTimeoutError`, missing-API fallback runs the
      in-context path
- [ ] T004 Implement `src/services/cross-lock.ts`: `withInboundLock`, `withSessionLock`
      (KeyedMutex FIFO composed with `navigator.locks.request`, AbortSignal timeout),
      `locksAvailable()`; import-clean (no DOM/Ionic) per contracts/sw-receive.md
- [ ] T005 [P] Write failing unit tests for the atomic multi-store transaction helper in
      `src/db/idb.transact.test.ts`: all-or-nothing commit across
      `sessions`+`messages`+`chats`+`settings`, abort → zero writes and zero
      notifications, notify fires once per touched store after commit
- [ ] T006 Implement `transact(stores, fn)` in `src/db/idb.ts` (one native IDB transaction;
      notifications deferred to commit)
- [ ] T007 [P] Write failing unit tests for the BroadcastChannel bridge in
      `src/db/idb.bridge.test.ts`: `notify()` posts the store name on
      `BroadcastChannel('ring:idb')`, a received name fires local listeners only, no echo
      loop, graceful no-op where BroadcastChannel is absent
- [ ] T008 Implement the `ring:idb` BroadcastChannel bridge in `src/db/idb.ts`
- [ ] T009 [P] Write failing ratchet tests in the crypto suite
      (`src/services/crypto/ratchet.staged.test.ts`): staged authoritative open returns
      advanced state (incl. DH step) without persisting; after the caller persists it, a
      subsequent seal on the reloaded state produces ciphertext the peer decrypts
      (send-chain integrity); replay of the same packet fails; forged ciphertext fails;
      out-of-order >50-frame backlog decrypts via the skipped-key cache
- [ ] T010 Implement `openPacketStaged(chatId, from, ciphertext)` in
      `src/services/messaging.ts` per contracts/sw-receive.md (full open incl. DH steps,
      persists nothing, returns `{payload, sessionToPersist, metaWrites}`; first-contact
      X3DH/prekey re-init NOT staged — throws a typed `DeferFrame` signal)
- [ ] T011 Replace `sessionMutex.run(chatId, …)` with `withSessionLock(chatId, …)` at the
      three call sites in `src/services/messaging.ts` (seal ~:117, open ~:197, preview
      ~:277) and rewrite the two-mode rationale comments at ~:240-266 and ~:294-300
      (preview stays same-chain-only as the fallback; authoritative SW open under lock is
      the new normal)
- [ ] T012 Wrap the page's inbound chain step in `withInboundLock` in `src/db/queries.ts`
      (~:4515, `receiveIncoming`), falling back to the bare chain when locks are absent;
      confirm `wasInboundSeen` short-circuit stays first inside the lock

**Checkpoint**: `npx vitest run` green; `npm run build` green; behavior unchanged with the
flag off (existing e2e suites still pass).

## Phase 3: User Story 1 — The app opens warm (P1) 🎯 MVP

**Goal**: push wake → eligible frames decrypted, committed atomically, acked; app opens
with correct chats list/unread/badges from local data alone.

**Independent test**: B offline, A sends 2 messages, `drainPending()` → rows + unread=2 +
empty server queue BEFORE reconnect; reconnect → no duplicates.

- [ ] T013 [P] [US1] Write failing unit tests for the eligibility classifier in
      `src/services/sw-drain.test.ts`: table over every payload type (plain text, media
      ref, group message → eligible; first-contact, cards, reaction, edit, erase, poll
      vote, rekey/control → defer), unknown sender → defer, unresolvable chat → defer
- [ ] T014 [P] [US1] Write failing unit tests for the apply path in
      `src/services/sw-drain.test.ts`: applied frame = message row + chat RMW
      (unread+1/lastMessage/lastMessageTime) + ledger mark + session in ONE transaction and
      its id queued for ack; replay of an applied frame = re-ack only (unread stays 1);
      transaction abort → no ledger mark, no ack; ack POSTed only after commit;
      media-by-reference persists `pendingMedia` without any fetch
- [ ] T015 [US1] Implement `src/services/sw-drain.ts` per contracts/sw-receive.md: gate
      composition, `/v1/relay/pending` fetch (reuse sw-inbox helpers), per-frame
      `withInboundLock` loop (ledger check → classify → `openPacketStaged` under
      `withSessionLock` → `transact` commit → collect ack id), notifications built from
      committed data via the existing `noteForPayload` path, single
      `POST /v1/relay/ack {ids}` as the wake's last step
- [ ] T016 [US1] Route the push handler in `src/sw.ts`: behind the gate (flag on + locks
      present + device-unlock + no client claimed via existing `pageWillNotify`), call
      sw-drain; on ANY throw or degrade reason fall back to `previewPending()`; adjust
      badge math so applied frames aren't double-counted (`unreadCount()` already includes
      them; add deferred-only pending count)
- [ ] T017 [P] [US1] Add `touch('chats'); touch('messages')` to the visibility-resume
      handler in `src/composables/useSync.ts` (~:472) so a frozen page repaints on resume;
      confirm `resumePendingMediaJobs()` (~:246) covers SW-persisted `pendingMedia` rows
      on reconnect
- [ ] T018 [US1] Write the warm-open e2e in `e2e/sw-persist.spec.ts`: offline B receives
      2 messages → `drainPending()` → assert rows exist, unread=2, `/v1/relay/pending`
      empty, icon-badge count = in-app total; `reconnect()` → exactly one copy of each
      message, unread unchanged

**Checkpoint**: US1 independently deliverable — warm open works end-to-end behind the flag.

## Phase 4: User Story 2 — Privacy behavior is unchanged (P2)

**Goal**: every privacy posture produces byte-identical notification behavior; locked
devices never decrypt or store in the SW.

**Independent test**: PIN-locked B gets a generic notification, nothing stored, frame
stays queued; hidden chat stays generic.

- [ ] T019 [P] [US2] Write failing unit tests in `src/services/sw-drain.test.ts`: locked
      posture (device-unlock fails) → gate returns `reason:'locked'`, zero writes, zero
      acks; hidden-chat / generic-preview rules produce the same notification payloads as
      the preview path (share the fixtures from `sw-inbox` tests)
- [ ] T020 [US2] Implement the posture guards in `src/services/sw-drain.ts` + `src/sw.ts`:
      gate short-circuits before any fetch-decrypt when locked; notification construction
      delegates to the exact same privacy/suppression helpers `previewPending` uses (no
      forked copy)
- [ ] T021 [US2] Extend `e2e/sw-persist.spec.ts`: enable PIN lock → send → generic
      notification, no local rows, frame still pending server-side; unlock + open → message
      arrives via page drain exactly once. Add a hidden-chat scenario asserting generic
      content

**Checkpoint**: privacy parity proven for default, generic, hidden, and locked postures.

## Phase 5: User Story 3 — Nothing is lost, nothing is doubled (P3)

**Goal**: every failure/ineligible path degrades to today's behavior; exactly-once holds
under interleaving.

**Independent test**: interrupted drain, stranger first-contact, and drain-vs-reconnect
race all end with each message exactly once and correct unread.

- [ ] T022 [P] [US3] Write failing unit tests in `src/services/sw-drain.test.ts`:
      lock-timeout (`LockTimeoutError`) degrades the wake to preview-only (no ack, no
      writes); missing Web Locks → gate off; decrypt failure on one frame defers that
      frame and continues the loop; kill-between-commit-and-ack simulation → next wake
      re-acks via ledger without re-applying
- [ ] T023 [US3] Implement the degrade ladder in `src/services/sw-drain.ts`/`src/sw.ts`
      (typed reasons `flag-off | locked | no-locks | lock-timeout | no-frames` surfaced in
      the drain result for the test hook), ensuring deferred frames keep flowing through
      `swNotifiedIds`/`swShownSummary` exactly as today
- [ ] T024 [US3] Extend `e2e/sw-persist.spec.ts`: (a) stranger's first-contact message →
      drain defers → page reconnect applies it once (friend-gate behavior intact);
      (b) concurrent `drainPending()` + `reconnect()` → exactly one row, one unread;
      (c) flag OFF run of the whole suite asserting byte-for-byte today's behavior
- [ ] T025 [US3] Run the existing regression suites with the flag on and off —
      `e2e/sw-decrypt.spec.ts` (preview assertions updated only if the flag-on path
      legitimately changes them) and the `e2e/call-*.spec.ts` suites (message push landing
      mid-call must not disturb signalling; lock contention path)

**Checkpoint**: all three stories complete; exactly-once and degrade-to-today proven.

## Phase 6: Polish & Cross-Cutting

- [ ] T026 [P] Update the stale server comment in `server/internal/store/relay.go`
      (~:50-56, `SweepRelayOlderThan`): the SW *can* now ack behind the flag; the sweep
      rationale (never-returning recipients) is unchanged. Comment-only, no behavior
- [ ] T027 [P] Rewrite the header design-note in `src/services/sw-inbox.ts` (~:1-19,
      "Choice A") to describe the two-mode world (authoritative sw-drain behind the flag;
      preview as fallback/deferred path), and cross-reference `specs/1032-store-messages-push/`
- [ ] T028 Walk `specs/1032-store-messages-push/quickstart.md` end-to-end on the dev stack
      (`make start`), including the degrade checklist and the DevTools kill-mid-drain
      probe; fix anything that drifted
- [ ] T029 Full gates: `npm run build`, `npx vitest run` (coverage floors hold),
      `cd server && go build ./... && go vet ./... && go test ./...`,
      `npm run test:e2e` — all green with the flag defaulted off
- [ ] T030 Flip spec `**Status**` to `in-review` in
      `specs/1032-store-messages-push/spec.md` and run `make roadmap`

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → Phase 3**: strictly sequential phases (foundational plumbing
  blocks every story; US1 builds the module US2/US3 harden).
- **US1 (Phase 3) is the MVP**: independently shippable behind the flag.
- **US2 (Phase 4) and US3 (Phase 5)** both extend sw-drain from US1 — start US2 first
  (privacy is the higher bar); their e2e tasks (T021, T024) are mutually parallel once
  T020/T023 land.
- Within phases, `[P]` tasks touch different files and may run in parallel; test tasks
  always precede their implementation task (Red → Green).

### Parallel example (Phase 2)

```
T003 (cross-lock tests) ─┐
T005 (transact tests)   ─┼─ in parallel, then T004 → T006 → T008 …
T007 (bridge tests)     ─┤
T009 (ratchet tests)    ─┘
```

## Implementation Strategy

Ship in two PR-sized slices if review size demands it: (1) Phase 1–2 — pure safety
plumbing, flag-off no-op, zero behavior change; (2) Phase 3–6 — the sw-drain feature
behind the flag. Otherwise one feature PR is fine: the flag keeps production behavior
byte-identical until the dev-deployment soak (quickstart.md) passes, after which a
follow-up release flips the default.
