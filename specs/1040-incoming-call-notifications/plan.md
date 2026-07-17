# Implementation Plan: Incoming Call & Friend-Request Notifications — Identity, Badge, and Missed-Call Trace

**Branch**: `feat/1040-incoming-call-notifications` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1040-incoming-call-notifications/spec.md`

## Summary

Make the closed-app call experience truthful end to end: the ring notification
names the caller and call type, a ringing call adds exactly one app-badge unit
that hands over (never double-counts) to the missed state, opening the app
sweeps the notification and the unit, an unanswered ring is replaced by a
"Missed call from <name>" notification, and every unanswered call leaves the
existing call-log trace (chat row + Calls tab) even when the app never ran
during the ring. Vehicle: a new sealed `callEvent` system frame from the
caller over the existing pairwise Double Ratchet (`ring` at dial, `ended` at
outcome), which the service worker can already fetch and preview from
`GET /v1/relay/pending` — the push tickles stay content-free, the server
learns nothing new, and no new push type is needed (the outcome marker's own
msg tickle is the wake that retires the ring). Separately, the friend-request
acceptance bug is fixed at its root: the server's outgoing-connections query
never returns `accepted` rows, so the SW's existing "accepted your friend
request" renderer is dead code — return recently-accepted rows (24h window
inside the 48h dedup ledger) and neutralize the misleading placeholder copy.

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 `<script setup>` + Ionic 8) client;
Go 1.26 stdlib server (one small query change)

**Primary Dependencies**: existing E2EE messaging core
(`src/services/crypto/message.ts` `MessagePayload`, Double Ratchet via
`previewPacket`), SW inbox (`src/services/sw-inbox.ts`, `src/sw.ts`), call
orchestration (`src/composables/useCall.ts`), call log
(`src/db/queries.ts` `createCall`/`logCallToChat`), Web Push relay
(`server/internal/ws/hub.go` ring loops — read-only reference, unchanged)

**Storage**: IndexedDB — existing `calls` store and chat `kind:'call'` rows
(no new object store, no `DB_VERSION` bump); `settings` store gains two
namespaced keys (`sw.callBadge`, pending call events) following the existing
SW↔page shared-key pattern (`badge.lastCount`, `swShownSummary`)

**Testing**: vitest for the pure marker/reconcile/badge-unit logic and
`noteForPayload` additions; Go table tests against the fake store for the
connections query; e2e/drive verification of the friend-accept copy and call
log trace (SW push paths verified at unit level — headless push delivery is
not CI-testable)

**Target Platform**: installable PWA — Safari/iOS (SW visible-ending
three-strike rule applies), Chrome/Android, desktop browsers

**Project Type**: web app (client-heavy; one server query + tests)

**Performance Goals**: first ring alert latency unchanged (identity never
blocks it); missed-call replacement within one msg-tickle debounce of ring
end; SW pending-preview stays inside the existing 8s fetch bound

**Constraints**: zero-knowledge boundary (spec's ZK Impact section; tickles
stay content-free, identity rides E2EE); iOS rule that every SW wake ends
visibly; spec 1032 single-writer invariant (SW preview path never persists or
acks); hidden-chats exclusions fail closed

**Scale/Scope**: ~6 client files (message payload type, useCall send sites,
queries receive branch, sw-inbox notes/badge, sw.ts call+conn paths, badge
composables), 1 server file + test, new vitest modules, spec artifacts

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary** — PASS. Spec carries the required
  Zero-Knowledge Impact section. All identity crosses as sealed `callEvent`
  frames on the existing ratchet channel; push payloads remain type-only
  tickles; the server-side change returns rows whose state the server already
  stores (`connections.state`) to their own requester. No new plaintext, no
  new metadata field.
- **II. Spec-Driven Development** — PASS. Spec 1040 (ad-hoc band), pipeline
  followed: specify → clarify (1 Q integrated) → plan → tasks → analyze →
  taskstoissues → implement.
- **III. Test-Driven Development** — PASS (planned). New pure logic (marker
  reconcile, badge units, note builders) lands as vitest-first; the Go query
  change lands test-first against the fake store; tasks.md orders red before
  green.
- **IV. Crypto Discipline** — PASS with review flag. No new primitive and no
  ratchet change: `callEvent` is one more optional field inside the existing
  sealed `MessagePayload`, sealed/opened by unchanged code (the same pattern
  as `reaction`/`gameMove`). Because a Principle I surface is touched (a new
  E2EE frame kind), `/speckit-checklist` **is** mandated and will be run
  before implement.
- **V. Offline-First Data Integrity** — PASS. No schema change; writes go
  through `queries.ts` on the page/drain side only; the SW preview path stays
  read-only (spec 1032 invariant); marker processing is idempotent (keyed by
  `callId`) and never overwrites an existing record.
- **VI. Stateless Server & Forward-Only Migrations** — PASS. No migration; a
  `SELECT` predicate change only. Handlers stay stdlib; fake-store test
  updated alongside.
- **VII. Quality Gates** — PASS (planned): `npm run build`, vitest,
  `go build/vet/test`, e2e where behavior changed; release-note-style commit
  subjects.
- **VIII. Traceability** — PASS: branch `feat/1040-…`, issues via
  taskstoissues, PR lists `Closes #N`.
- **IX. Privacy & Data Minimization** — PASS. Markers carry the minimum
  (callId, kind, phase, optional roomId); nothing new is collected or stored
  server-side.
- **X–XI. A11y/i18n & Ionic-First** — PASS. No new UI surface: notification
  strings only (plain-language, emoji cues supplement text, not replace it);
  copy follows the app's voice (no em-dashes or semicolons in user copy).

## Project Structure

### Documentation (this feature)

```text
specs/1040-incoming-call-notifications/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0 (R1–R8)
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── call-event.md    # sealed callEvent frame contract
│   └── connections-api.md # GET /v1/connections outgoing change
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── crypto/message.ts        # MessagePayload.callEvent (type + docs)
│   ├── call-events.ts           # NEW pure module: marker build/reconcile/badge-unit logic
│   ├── sw-inbox.ts              # noteForPayload callEvent notes; call badge units; neutral conn placeholder data
│   └── notify.ts                # (reference only — hand-off unchanged)
├── composables/
│   ├── useCall.ts               # send ring/ended markers at dial, timeout, cancel, answer
│   ├── useAppBadge.ts           # foreground sweep also clears sw.callBadge units
│   └── useBadges.ts             # (reference — page badge already counts missed)
├── db/
│   └── queries.ts               # receiveIncomingInner callEvent branch + reconcile
└── sw.ts                        # call wake: marker preview → named ring; missed replace; badge units; neutral placeholder copy

server/internal/
├── store/connections.go         # OutgoingRequests: + accepted within 24h
└── api/connections_handlers_test.go  # fake-store + handler coverage

src/services/call-events.test.ts # vitest (pure logic)
src/services/sw-inbox.calls.test.ts # vitest (note building, badge units)
```

**Structure Decision**: single web-app monorepo as-is; one new pure client
module (`call-events.ts`) so the marker/reconcile/badge logic is testable
without IndexedDB or a SW, mirroring the crypto-core purity convention.

## Complexity Tracking

No constitution violations to justify. One scope note: SW-delivered push
behavior (named ring, missed replacement) cannot run in headless CI e2e —
covered by vitest at the note-builder/unit level plus manual device
verification via the quickstart; this mirrors how existing SW push behavior
(specs 1015/1032/1034/2023) is covered.
