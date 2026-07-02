# Implementation Plan: Harden Hidden Chats + One-Hidden-One-Visible Per Person

**Branch**: `feat/1027-harden-hidden-chats` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1027-harden-hidden-chats/spec.md`

## Summary

Fix and harden the shipped Hidden Chats feature (spec 1019). The central defect:
inbound routing (`receiveIncomingInner` → `startDirectChat`) refuses hidden chats,
so hiding your only 1:1 with a peer makes their next message resurrect a *visible*
chat, land content in it, fire spurious re-keys, and orphan the hidden thread.
The fix is a peer-aware inbound routing rule plus a per-person invariant: at most
one hidden and one visible chat per person, where two coexisting threads are
always two distinct crypto channels (the plain 1:1 Double Ratchet thread and a
group-modeled "pair conversation" using the existing sender-key mechanism —
`startHiddenChat`'s channel, finally wired into real UI via `startDirectChat`).
Also fixed: peer-keyed reset block on the live relay path, badge correctness
without collateral suppression (page + SW), relock kick-out + route guard,
fully-silent non-push notification paths, and the raw NUL byte in `queries.ts`.
Everything client-side; zero server changes. All design decisions and their
rationale: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5 (ES modules, `@/` → `src/`), Vue 3 `<script setup>` + Ionic 8; no server changes (Go untouched)

**Primary Dependencies**: libsodium-wrappers-sumo (existing X3DH / Double Ratchet / sender keys — reused, never modified), Vue Router, existing `idb` wrapper

**Storage**: IndexedDB via `src/db/idb.ts` — existing stores only (`chats`, `messages`, `sessions`, `senderkeys`, `settings`, `tombstones`); **no new object store, no `DB_VERSION` bump** (new data = new `settings` keys + new `tombstones` rows in existing stores)

**Testing**: vitest (unit; fake idb), Playwright `e2e/` (hermetic stack, real WebRTC), `drive/` scenarios (live dev stack) — Playwright is the primary behavioral gate per FR-022

**Target Platform**: installable PWA (iOS Safari 16.4+, Android Chrome, desktop); service-worker web push constraints are load-bearing (see FR-012)

**Project Type**: web app (client-only change within the existing monorepo)

**Performance Goals**: no regression to chat-list query time (`listChats` stays a single pass); badge computation stays O(chats)

**Constraints**: zero-knowledge boundary (no new wire data), fail-closed hidden filtering without collateral suppression, no PIN oracle, reveal state memory-only

**Scale/Scope**: ~10 client files touched + tests; the crypto core (`src/services/crypto/`) is NOT modified — only channel *selection* changes

## Constitution Check

*GATE: evaluated against constitution v1.2.0 — re-checked after Phase 1 design: PASS.*

| Principle | Status | Notes |
|---|---|---|
| I. Zero-Knowledge Boundary | ✅ | No new client→server request/field/payload. Pair conversations are ordinary opaque conversations the server already relays. Spec has the mandatory ZK Impact section. |
| II. Spec-Driven Development | ✅ | Spec 1027 (ad-hoc band), pipeline followed: specify → clarify (3 Qs) → plan (this) → tasks → analyze → taskstoissues → implement. |
| III. Test-Driven Development | ✅ | tasks.md will order failing tests first; B1/B3/B4 get regression tests before fixes; e2e extended for every changed user-facing behavior. |
| IV. Crypto Discipline | ✅ | No new primitives or schemes — channel *selection* between the two existing channels (per-peer ratchet, sender-key groups). `messaging.ts` untouched and stays crypto-only; `queries.ts → messaging.ts` direction preserved. `/speckit-checklist` REQUIRED (Principle I/IV spec) and will be run before implement. Security review requested on the PR. |
| V. Offline-First Data Integrity | ✅ | No store/schema change; writes stay on `idb.ts` + change bus; `useLiveQuery` reactivity via existing `touch()` pattern. |
| VI. Stateless Server & Migrations | ✅ | Server untouched. |
| VII. Quality Gates | ✅ | `npm run build`, vitest + floors, `go build/vet/test` (unchanged but run), e2e for changed behavior. Release-note-style commit subjects. |
| VIII. Traceable Delivery | ✅ | `make roadmap` run; taskstoissues will open issues; PR lists `Closes #N`. |
| IX. Privacy & Data Minimization | ✅ | Strictly reduces what the device shows; nothing new collected. |
| X. Accessibility & i18n | ✅ | Blocked Hide/Unhide reasons are plain copy on stock components; no new text surface with direction risk. |
| XI. Ionic-First UI | ✅ | Disabled action-sheet buttons + caption text; no custom widgets. |

No violations → Complexity Tracking not needed.

## Project Structure

### Documentation (this feature)

```text
specs/1027-harden-hidden-chats/
├── plan.md              # This file
├── research.md          # Phase 0 — audit + design decisions R1-R10
├── data-model.md        # Phase 1 — entities, keys, state machine
├── quickstart.md        # Phase 1 — implementation slices
├── contracts/
│   └── internal-api.md  # Phase 1 — module contracts (no HTTP API changes)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── hidden-pair.ts             # NEW — pure per-person invariant + routing rule (R8)
│   ├── hidden-pair.test.ts        # NEW
│   ├── hidden-chats.ts            # unchanged API; doc comments updated
│   ├── hidden-chats-start.ts      # absorbed: pair-conversation creation reused by startDirectChat
│   ├── hidden-chats-reset.ts      # + peer-keyed localOnly blocks (R4)
│   ├── hidden-state.ts            # + registered relock navigation hook (R6)
│   ├── notify.ts                  # remove backgrounded generic bridge (B6/R7)
│   └── sw-inbox.ts                # unreadCount honors badge pref + hidden set (B4/R5)
├── db/
│   ├── queries.ts                 # rule-R inbound resolver; startDirectChat pair path;
│   │                              #   countUnread badge cache; NUL → \u0000 (B1/B3/B4)
│   ├── hidden-calls.ts            # unchanged (verified by tests)
│   └── tombstones.ts              # unchanged (reused: hiddenPeer:<id> localOnly rows)
├── composables/
│   └── useHiddenChats.ts          # relock triggers kick-out hook
├── components/
│   └── ChatActionsSheet.vue       # canHide/canUnhide gating + blocked reasons
├── router/
│   └── index.ts                   # hidden-chat route guard (R6)
└── views/tabs/ChatsPage.vue       # unchanged reveal gesture (covered by tests)

e2e/
└── hidden-chats.spec.ts (+ new: hidden-coexist.spec.ts, hidden-privacy.spec.ts,
                             hidden-call.spec.ts, hidden-reset.spec.ts)

drive/scenarios/
└── (+ hidden-coexist.mjs, hidden-reset-relay.mjs, hidden-kickout.mjs; existing six kept)
```

**Structure Decision**: single-project client change inside the existing monorepo
layout; the one new module (`hidden-pair.ts`) is a pure leaf so the invariant is
unit-testable without IndexedDB and importable from both `queries.ts` and UI
without cycles (same pattern as `hidden-state.ts`).

## Design (Phase 1 summary — details in data-model.md / contracts/)

### D1. Channels and roles (R3)

Per peer there is at most one **plain 1:1** channel (ratchet session keyed by that
chat's id) and at most one **pair conversation** (group-modeled, `isGroup: true`,
`participantIds: [peer]`, sender keys, routed by `groupId`). *Hidden* and
*visible* are roles laid over whichever channel each thread happens to be.

- **Hide** = `addHidden(chatId)` after `canHide` passes. No migration, no wire
  traffic, nothing the peer or server can observe.
- **Fresh visible chat** when a hidden chat with that peer exists =
  `startDirectChat` creates a **pair conversation** (reusing
  `createGroup('', [peer])` exactly as `startHiddenChat` does today) instead of a
  second plain 1:1. The peer sees a new conversation appear — inherent to
  coexistence and accepted in the spec.
- **Unhide** = `removeHidden(chatId)` after `canUnhide` passes (no visible chat
  with the same peer).

### D2. Inbound routing rule R (fixes B1)

`receiveIncomingInner` replaces its blind `startDirectChat` call with a
two-stage resolver (`payload.groupId` is inside the sealed payload, so a frame's
group membership is only known post-decrypt):

- **Stage 1 — session resolution (pre-decrypt)**; every frame rides the per-peer
  1:1 ratchet: visible plain 1:1 with the peer if it exists; else hidden plain
  1:1 (never creates a row, never un-hides); else if `hiddenPeer:<peer>` block
  exists → ack + drop, no rekey, no trace; else create a fresh visible 1:1
  (genuinely new peer — unchanged).
- **Stage 2 — content routing (post-decrypt)**: `payload.groupId` → that
  conversation (unchanged); otherwise the stage-1 chat (silent per FR-012 when
  hidden).

Because frames are queued while locked (`isUnlockedNow()` gate already in place),
the resolver always runs with the master key available, so the hidden set is
decryptable — no new fail-open window. If `ensureHiddenLoaded()` still cannot
produce a known set, the frame is re-queued (fail closed) rather than resolved
against an unknown set.

### D3. Reset block (fixes B3) — R4

`resetHiddenChats` additionally writes `hiddenPeer:<peerId>` localOnly tombstones
for each hidden plain-1:1 peer and keeps id tombstones for pair/group threads;
`ensureGroupChat`/`handleGroupCard` consult group-id tombstones. `startDirectChat`
lifts the peer block (`clearTombstone`) on explicit user re-engagement.

### D4. Badge (fixes B4) — R5

- Page `countUnread`: persist last successful result to `badge.lastCount`
  (device-local, added to the own-sync exclusion list next to the hidden keys);
  return it — not 0 — when the set is unknown in `never`/`revealed` modes.
- SW `unreadCount`: apply `privacy.hiddenChatsBadge`; `revealed` behaves as
  `never` in the SW (reveal is page-memory-only); unclassifiable frames are not
  counted (privacy over accuracy); fall back to `badge.lastCount` when locked.

### D5. Relock kick-out + guard (fixes B5) — R6

Router registers a hook with `hidden-state` (leaf stays import-light): on
`setRevealed(false)`/`clearHiddenState`, if the active route is a hidden
conversation → `router.replace('/tabs/chats')`. Plus a `beforeEach` guard:
`/chat/:id` where id is hidden and not revealed → redirect. Covers grace expiry,
keystore auto-lock, manual relock, deep links, and back-stack restoration.

### D6. Notification paths (fixes B6) — R7

Remove the `notify.ts` backgrounded-but-connected generic bridge; assert the SW
generic note is byte-identical to the previews-off generic; pin branch ordering
(hidden before mention/mute/content) with a regression test. Calls: no changes —
add the e2e asserting full-identity ring (knock-knock) and relocked call-history
exclusion.

### D7. Cleanups

NUL byte → `\u0000` escape (same runtime string — SHA-256 input unchanged, so
contact-card dedup hashes stay stable). Biometric dangling references per R9.
1019's unreachable `hidden-chats-start.ts` path becomes genuinely used (D1) —
its "test-harness-only" status resolves itself.

## Zero-Knowledge & Crypto Review Notes (Principle I/IV gate)

- Nothing new crosses the wire; no new ciphertext shape; no new key material
  except none at all — both channels already exist.
- The peer block and badge cache are device-local; `badge.lastCount` is a single
  integer equal to what the OS badge already displays.
- `messaging.ts` is untouched; `queries.ts → messaging.ts` stays one-directional.
- `/speckit-checklist` will be generated for this spec (required: touches
  Principle I & IV) and a security review requested on the PR (constitution IV).

## Testing strategy (FR-022/FR-023 — Playwright-first)

Red → Green ordering enforced in tasks.md:

1. **Failing regression tests first** for B1 (hide → inbound lands hidden,
   silently, no resurrect/rekey), B3 (reset → live inbound leaves no trace), B4
   (badge modes incl. cold-open correctness), B5 (kick-out + guard), B6 (silent
   non-push background).
2. **Unit (vitest)**: `hidden-pair` predicates + rule R as pure functions; SW
   `unreadCount` modes; reset peer-block; notify-policy ordering; NUL-escape hash
   stability.
3. **e2e (Playwright, hermetic)**: coexistence journey (hide → message lands
   hidden → fresh visible pair chat → cross-thread isolation ≥ both directions →
   Hide blocked with reason → delete visible → unhide), knock-knock 2-person call
   with full identity while messages stay generic/silent, badge across all three
   modes, reset + relay re-materialization block, cold-open no-flash with correct
   visible badge, relock kick-out.
4. **drive scenarios (live stack)**: `hidden-coexist.mjs`, `hidden-reset-relay.mjs`,
   `hidden-kickout.mjs` + keep the existing six green.

## Complexity Tracking

No constitution violations — table intentionally empty.
