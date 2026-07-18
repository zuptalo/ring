# Implementation Plan: Push zombie subscriptions & silent-wake strikes

**Branch**: `fix/2043-push-zombie-subscriptions` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/2043-push-zombie-subscriptions/spec.md`

## Summary

Web-push notifications fail fleet-wide because subscriptions go "zombie": iOS/Chromium
silently revoke delivery after ~3 push wakes that don't end in `showNotification`, yet the
push service keeps returning 201, so the server never prunes and the device never wakes.
Measured on prod: 13/37 subscriptions (35%) carry relay frames the device never drained; a
fresh iPhone went zombie within an hour of a 5-message burst.

Two-front fix, all client-side plus one metadata-only server endpoint:
1. **Stop creating zombies** — replace the module-global "last shown" stamp in the SW push
   guard with a **per-event** context so one push's notification can't suppress another's
   fallback (the burst stamp-bleed), and enforce "every wake shows something" as a
   backstop rather than an assumption.
2. **Recover existing zombies** — a foreground-triggered, wake-independent self-heal that
   reads server queue age from a new side-effect-free `GET /v1/relay/status` and
   force-rotates a subscription the server proves is dead (fires even when the device never
   woke — the case the existing decrypted-evidence rotation can't handle), with a 10-minute
   zombie bar and its own 2-hour retry cap.
3. **Observability** — a server zombie-fleet gauge in the sweep loop, a content-free
   on-device wake ledger, and an opt-in production diagnostic that surfaces fallback reason
   codes.

## Technical Context

**Language/Version**: TypeScript (ES modules, Vue 3 `<script setup>`); Go 1.26 (stdlib `net/http`)

**Primary Dependencies**: Ionic, libsodium (unchanged here); server `pgx` v5, VAPID Web Push

**Storage**: IndexedDB (client settings store for wake stamps/ledger); PostgreSQL `relay_queue` + `push_subscriptions` (server)

**Testing**: vitest (client unit), Playwright (`e2e/`), `go test` against the in-memory fake store

**Target Platform**: Installable PWA (iOS 16+/WebKit, Chromium engines) + `ringd` container

**Project Type**: Web application (Vue PWA client + Go server, single image)

**Performance Goals**: The push guard stays under iOS's ~30s SW-event budget (existing 20s deadline); `/relay/status` is one indexed count query; the foreground self-heal probe is throttled to once / 5 min

**Constraints**: Zero-knowledge boundary (Principle I) — no new surface may carry plaintext; offline-first; PWA stays `registerType: 'prompt'`

**Scale/Scope**: 37 live subscriptions today (majority iOS); the fix targets the 13 currently-zombie devices and every future one

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary (NON-NEGOTIABLE)** — PASS. See the spec's **Zero-Knowledge
  Impact** section. `/relay/status` returns only a server timestamp + count (no payload, no
  sender); the wake ledger stores only enum kind, enum outcome, count, timestamp; the
  diagnostic surfaces internal reason codes, never sender or body; the force-rotation is a
  subscribe/unsubscribe dance carrying no message data. No log line, metric, or error
  payload gains plaintext.
- **II. Spec-Driven Development** — PASS. Numbered hotfix spec (`2043`, band `2001+`), branch
  `fix/2043-push-zombie-subscriptions`, pipeline specify → clarify → plan (here) → tasks →
  analyze → checklist (required, see below) → taskstoissues → implement.
- **III. Test-Driven Development** — PASS. This is a `2001+` bug fix, so it begins with a
  failing regression test: `src/services/sw-guard.test.ts` reproduces the burst stamp-bleed
  (a sibling event's show must not suppress this event's fallback) before the per-event ctx
  landed. New pure logic is unit-tested (`shouldRotateForQueueAge` in `push.rotate.test.ts`;
  the `/relay/status` handler + no-side-effect assertion in `relay_handlers_test.go`). The
  SC-001 burst behavior is covered by a drive/e2e scenario (Phase 2 task).
- **IV. Crypto Discipline** — N/A. No crypto primitives, key exchange, or ratchet touched;
  the SW's existing decrypt path is unchanged.
- **V. Offline-First Data Integrity** — PASS. New settings keys (`push.lastForceRotateAt`,
  `push.wakeLedger`) live in the existing `settings` object store; no new store, so no
  `DB_VERSION` bump / `onupgradeneeded` change is required.
- **VI. Stateless Server & Forward-Only Migrations** — PASS. No schema change (reuses
  `relay_queue.created_at` and `push_subscriptions`); no new migration. New handler is
  stdlib `net/http` behind a small interface (`ws.RelayStore`) and tested against the fake
  store. Does not touch `SECRETS_KEY`.
- **VII. Quality Gates** — PASS. `npm run build`, `go build/vet/test`, and vitest all green
  (1174 client + full server unit tests). Commit will be `fix(notifications): …` with
  plain-language release-note copy.
- **VIII. Traceable Delivery** — PASS. `ROADMAP.md` regenerated; tasks → issues; the PR will
  list `Closes #N`.
- **IX. Privacy & Data Minimization** — PASS. The wake ledger and zombie metric collect the
  minimum (enums/counts), reveal no identity/contacts/behavior, and the diagnostic is
  off by default.
- **X / XI. Accessibility & Ionic-First UI** — PASS. The only UI is one `toggle` added to
  `src/settings/schema.ts` (a data edit rendered by the stock settings page) — no bespoke
  component.

**Gate result: PASS — no violations, Complexity Tracking left empty.**

## Project Structure

### Documentation (this feature)

```text
specs/2043-push-zombie-subscriptions/
├── plan.md              # This file
├── spec.md              # Feature spec (+ Clarifications, + Zero-Knowledge Impact)
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — settings keys + server metadata shapes
├── quickstart.md        # Phase 1 — how to verify (unit, drive/e2e, prod before/after)
├── contracts/
│   └── relay-status.md  # GET /v1/relay/status contract
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── sw.ts                       # per-event WakeCtx threaded through dispatchPush; guardedPush → runGuardedWake; diagnostic reason gate; recordWake
├── services/
│   ├── sw-inbox.ts             # runGuardedWake + WakeCtx/WakeResult; wake ledger (recordWake/readWakeLedger)
│   ├── push.ts                 # shouldRotateForQueueAge, healZombieIfLikely, ensurePushSubscription({forceRotate})
│   ├── api.ts                  # fetchRelayStatus
│   ├── testhook.ts             # pushWakeLedger() accessor (dev-only)
│   ├── sw-guard.test.ts        # NEW — per-event guard regression tests
│   └── push.rotate.test.ts     # + shouldRotateForQueueAge truth table
├── composables/useSync.ts      # wire healZombieIfLikely() into online + visibilitychange
└── settings/schema.ts          # diagnostics.pushReasonText toggle

server/
├── internal/store/relay.go            # OldestPendingForRecipient, CountZombieFleet
├── internal/api/relay_handlers.go     # relayStatus handler
├── internal/api/router.go             # GET /v1/relay/status route
├── internal/api/relay_handlers_test.go# TestRelayStatus
├── internal/ws/hub.go                 # RelayStore interface += OldestPendingForRecipient
└── cmd/ringd/main.go                  # "push: zombie fleet" gauge in the sweep loop
```

**Structure Decision**: Existing Vue-PWA-client + Go-server layout; no new top-level
directories. Changes are localized to the push/notification path on both sides.

## Complexity Tracking

> No Constitution Check violations — table intentionally empty.
