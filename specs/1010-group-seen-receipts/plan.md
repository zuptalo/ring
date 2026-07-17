# Implementation Plan: Group "Seen" Receipts — Durable, Private, and Counted

**Branch**: `feat/1010-group-seen-receipts` | **Date**: 2026-06-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1010-group-seen-receipts/spec.md`

## Summary

Make group receipts complete and correct on top of machinery that mostly exists.
Four changes: (1) **rename `read → seen` everywhere** as a hard cutover, with a
one-time client IndexedDB migration; (2) make per-member **seen durable** by
mirroring the existing delivered store (a new server `seen` table + check
endpoint + reconcile on reconnect), so "Seen X/N" survives the sender being
offline; (3) wire the currently-**inert privacy toggle** as a reciprocal "Seen
receipts" switch, enforced entirely client-side; and (4) surface progress — a
compact **"Delivered/Seen X/N" counter** on the group bubble (complete-the-tier,
recipients-only N, partial-only) and a **"Not yet delivered"** list with avatars
in message info. The per-member roster, the group info lists, and the
delivered durability/reconcile path already exist and are extended, not rebuilt.

## Technical Context

**Language/Version**: TypeScript (Vue 3 + Ionic 8, Vite) client; Go 1.26 server
(`ringd`, stdlib `net/http`, pgx v5).

**Primary Dependencies**: No new dependency. Reuses the existing receipt/relay
machinery, the `deliveries` durable-store pattern, and the 1009 settings-gate
pattern (`applyActivityPref`/`setActivityIndicatorsEnabled`).

**Storage**:
- **Client**: IndexedDB `messages` store — `DB_VERSION 5 → 6` with a forward
  migration mapping `status 'read'→'seen'`, `readAt→seenAt`, and
  `receipts[].readAt→seenAt` on existing rows. No new object store (receipts stay
  embedded).
- **Server**: a **new `seen` table** (next numbered migration) mirroring
  `deliveries` — `(sender, recipient, msg_id, seen_at)`, PK `(sender, recipient,
  msg_id)`, same retention/cleanup as `deliveries`.

**Testing**: `go test ./...` (in-memory fake store) for the seen store + relay;
`vitest` for the status reducers + counter derivation; Playwright (`e2e/`,
multi-account) for counter climb, offline durability, toggle reciprocity, and the
rename migration.

**Target Platform**: Installable PWA + `ringd`, single container.

**Project Type**: Web — Vue 3 PWA client + Go server.

**Performance Goals**: Counter updates within the existing receipt latency; the
client migration runs once on upgrade over the local message set; seen reconcile
mirrors delivered (3-day window, 500-id cap).

**Constraints**: Zero-knowledge — the `seen` store holds the *same metadata shape
already stored for delivered* (routing ids + timestamp; no message content), and
the privacy preference is client-enforced (server never told). Forward-only
migrations (client + server). Hard wire cutover (`read`→`seen`) with an accepted
transient skew for un-refreshed clients. Stock Ionic + theme tokens; LTR/RTL +
light/dark.

**Scale/Scope**: 1:1 (unchanged) + groups; counter denominator N = recipient
members (sender excluded); avatar stack capped (~5 + "+N").

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Zero-Knowledge Boundary (NON-NEGOTIABLE) | ✅ PASS | New `seen` store mirrors the existing `deliveries` metadata shape `(sender, recipient, msg_id, seen_at)` — **no new class** of server-visible metadata, no message content. Privacy preference enforced client-side; server never holds opted-out seen. ZK Impact section present. **`/speckit-checklist` REQUIRED.** |
| II. Spec-Driven Development | ✅ PASS | specify → clarify → plan → … pipeline; spec id 1010. |
| III. Test-Driven Development | ✅ PASS | `tasks.md` will order failing tests first: server seen-store tests (record/SeenFor; relay records on seen; offline-without-send stores nothing) and the e2e scenarios before implementation. |
| IV. Crypto Discipline | ✅ PASS (untouched) | Seen receipts are **status metadata**, already plaintext like delivered/read today — not E2EE message bodies. `messaging.ts` and the crypto core are not touched; no primitive change. |
| V. Offline-First Data Integrity | ✅ PASS | `DB_VERSION 5→6` with a **forward migration** in `onupgradeneeded` that preserves all existing message data (status/timestamps mapped, never dropped); no status regression. |
| VI. Stateless Server & Forward-Only Migrations | ✅ PASS | One **new numbered, forward-only** migration for the `seen` table; no edits to shipped migrations; all state stays in Postgres. |
| VII. Quality Gates | ✅ PASS | `npm run build`, `go build/vet/test`, vitest, e2e are the definition of done. |
| VIII. Traceable, Auto-Closing Delivery | ✅ PASS | `/speckit-taskstoissues` then `Closes #N` on the PR. |
| IX. Privacy & Data Minimization | ✅ PASS | Client-side suppression (off ⇒ never send ⇒ never stored); seen metadata minimized + symmetric to delivered; no telemetry. |
| X. Accessibility & Internationalization | ✅ PASS | Counter + lists localizable; avatar stack mirrors in RTL; settings is a schema data edit. |
| XI. Ionic-First UI | ✅ PASS | Counter is text + the existing tick icon; info lists use `ion-list`/`ion-avatar`; the toggle is a `src/settings/schema.ts` data edit. Existing theme tokens reused. |

**Result**: No violations. **Complexity Tracking empty.** `/speckit-checklist`
required (Principles I, V, VI).

## Project Structure

### Documentation (this feature)

```text
specs/1010-group-seen-receipts/
├── plan.md            # this file
├── spec.md            # /speckit-specify + /speckit-clarify
├── research.md        # Phase 0
├── data-model.md      # Phase 1
├── quickstart.md      # Phase 1
├── contracts/
│   └── seen-receipts.md   # wire frame + /v1/seen/check + relay/store contract
├── checklists/
│   └── requirements.md    # passing
└── tasks.md           # /speckit-tasks (later)
```

### Source Code (repository root)

Edits existing files + one new server migration/store; **no new client object
store**.

```text
# Client (Vue 3 + Ionic)
src/
├── db/
│   ├── types.ts          # EDIT: MessageStatus 'read'→'seen'; Receipt.readAt→seenAt; scalar readAt→seenAt
│   ├── idb.ts            # EDIT: DB_VERSION 5→6 + onupgradeneeded v6 forward migration (read→seen, readAt→seenAt, receipts[].readAt→seenAt)
│   └── queries.ts        # EDIT: receipts roster uses seenAt; collectUnconfirmedOutgoing flags group msgs missing seenAt
├── services/
│   ├── message-status.ts # EDIT: reducers rename; group derivation over seenAt; counts (delivered/seen) helpers
│   ├── sync.ts           # EDIT: applyReceipt 'seen'
│   ├── api.ts            # EDIT: checkSeen() (mirror checkDeliveries)
│   └── transport.ts      # EDIT: ReceiptFrame status 'read'→'seen'
├── composables/
│   └── useSync.ts        # EDIT: sendReadReceipts→sendSeenReceipts (+ emit gate); reconcileSeen; applySeenPref/gate (mirror 1009 applyActivityPref)
├── views/detail/
│   ├── ChatDetailPage.vue   # EDIT: statusIcon/.tick.seen; group counter "X/N" (recipients, partial-only); reciprocity display gate
│   └── MessageInfoPage.vue  # EDIT: "Seen by"; NEW "Not yet delivered" (participantIds − delivered); avatar stack (cap 5 +N)
└── settings/
    └── schema.ts         # EDIT: privacy.readReceipts → privacy.seenReceipts ("Seen receipts", default on; drop always-for-groups footer)

e2e/
└── group-seen-receipts.spec.ts  # NEW: counter climb, offline durability, toggle reciprocity, migration

# Server (Go)
server/internal/
├── db/migrations/NNNN_seen.sql  # NEW: seen table (sender, recipient, msg_id, seen_at), PK (sender,recipient,msg_id)
├── store/seen.go                # NEW: RecordSeen (upsert), SeenFor(sender, msgIds)
├── ws/hub.go                    # EDIT: "receipt" case accepts 'seen'|'downloaded'; RecordSeen on 'seen' (durable, like ack→RecordDelivery)
├── api/relay_handlers.go        # EDIT: POST /v1/seen/check (mirror deliveriesCheck) + router wiring
└── ws/seen_test.go, api/*_test.go, store fake  # NEW/EDIT: tests
```

**Structure Decision**: Reuse the existing client/server layout. Durable seen is a
**parallel of the delivered store** (table → store → relay-record → check endpoint
→ client reconcile); the rename is a sweeping but mechanical edit + one client
migration; the counter and not-yet-delivered list are **derivations over the
existing `receipts[]` roster** and the existing `participantIds`. No new
subsystem, no new client object store.

## Complexity Tracking

> No Constitution Check violations — intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | — |
