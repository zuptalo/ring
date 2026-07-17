# Implementation Plan: Ephemeral Activity Indicators (Typing & Recording)

**Branch**: `feat/1009-activity-indicators` | **Date**: 2026-06-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1009-activity-indicators/spec.md`

## Summary

Show a chat peer an ephemeral, transient indicator while the user is composing —
**"typing…"**, **"recording audio…"** (voice message), or **"recording video…"**
(video note) — in the 1:1 chat header, the chats-list row, and per-sender in
group chats. The signal is delivered as a **live, relay-only control frame
modeled on read receipts** (not server-computed presence): client-originated,
addressed to the peer, the server stamps the authenticated sender and fans only
to the peer's currently-connected sockets, dropping it if the peer is offline.
It is never durably queued, persisted, pushed, or written to any store, and adds
**no new server-visible metadata** beyond the sender↔recipient relay path the
server already sees. The activity *kind* rides inside sealed ciphertext so even
"typing vs recording" stays opaque to the server. A single combined,
reciprocal privacy toggle ("Typing & recording indicators", default on) gates
emission client-side.

## Technical Context

**Language/Version**: TypeScript (Vue 3 `<script setup>` + Ionic 8), built with
Vite; Go 1.26 server (`ringd`) on stdlib `net/http`.

**Primary Dependencies**: Client — Vue 3, Ionic, `libsodium-wrappers-sumo`
(reused for sealing the activity kind; no new primitive). Server — stdlib
`net/http`, the existing `internal/ws` Hub. No new dependency is added.

**Storage**: **None new.** Activity signals are never persisted — no IndexedDB
object store (no `DB_VERSION` bump), no Postgres table, and **no SQL migration**.
State exists only in transit and in volatile in-memory UI state.

**Testing**: Server `go test ./...` (in-memory fake store) for the relay
behavior; `vitest` for the client composable; Playwright (`e2e/`, real
multi-account WebSocket) for the cross-account scenarios SC-001…006.

**Target Platform**: Installable PWA (modern browsers) served by `ringd`; single
container; WebSocket authenticated via `?token=`.

**Project Type**: Web — Vue 3 PWA client + Go server, shipped as one image.

**Performance Goals**: Indicator appears at the peer within ~1s while both are
connected; auto-expires ~6s after the last signal; outgoing emission is
debounced/coalesced (no per-keystroke burst; ~3s keepalive while active).

**Constraints**: Zero-knowledge (no new server-visible metadata; activity kind
sealed); ephemeral (live-only relay, dropped if peer offline; never queued,
persisted, or pushed); reciprocal client-side gating; stock Ionic + existing
theme tokens; LTR/RTL + light/dark correct.

**Scale/Scope**: 1:1 and small group chats. Group fan-out is client-driven, one
frame per recipient member, bounded/rate-limited (the server holds no group
object), mirroring the existing group-call invite fan-out.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Zero-Knowledge Boundary (NON-NEGOTIABLE) | ✅ PASS | Relay-only ephemeral frame; server sees only `{t, to, from}` — the same tuple message/receipt relay already exposes. Activity kind sealed in ciphertext. No new metadata, no server-computed/aggregated signal. ZK Impact section present in spec. **`/speckit-checklist` REQUIRED** (this principle is touched). |
| II. Spec-Driven Development | ✅ PASS | Following specify → clarify → plan → tasks → analyze → taskstoissues → implement. Spec id `1009`. |
| III. Test-Driven Development | ✅ PASS | `tasks.md` will order failing tests first: server relay `_test.go` (fan-out, from-stamping, nothing queued/persisted) and e2e specs before implementation. New user-facing behavior → new `e2e/` spec. |
| IV. Crypto Discipline | ✅ PASS (light touch) | Seals the tiny activity kind with the existing AEAD + HKDF under a per-peer derived "activity key" — **no new primitive, no ratchet scheme, no Double-Ratchet advance** (D3 resolved; the call-key precedent advances the ratchet and is deliberately NOT copied for keepalive-frequency signals). Pending human security sign-off. `messaging.ts` stays crypto-only and is untouched. |
| V. Offline-First Data Integrity | ✅ PASS | No object store added; nothing persisted; no `DB_VERSION` bump. Activity is explicitly volatile. |
| VI. Stateless Server & Forward-Only Migrations | ✅ PASS | Pure in-memory live relay in the existing Hub; **no migration**, no new persistent state. |
| VII. Quality Gates | ✅ PASS | `npm run build`, `go build/vet/test`, vitest, and e2e all planned as the definition of done. |
| VIII. Traceable, Auto-Closing Delivery | ✅ PASS | `/speckit-taskstoissues` will open issues; feature→develop PR will `Closes #N`. |
| IX. Privacy & Data Minimization | ✅ PASS | Minimal payload, no telemetry; client-side suppression means nothing is sent when disabled. |
| X. Accessibility & Internationalization | ✅ PASS | Indicator text is localizable and bidi-correct (FR-015); setting is a data edit to `src/settings/schema.ts`. |
| XI. Ionic-First UI | ✅ PASS | Setting uses `ion-toggle` (schema data edit); the indicator is text in existing surfaces (chat header subtitle, list row preview) — no bespoke widget. Existing theme tokens (`--app-*`/`--ion-*`) reused. |

**Result**: No violations. **Complexity Tracking is empty.** A `/speckit-checklist`
is required after planning (Principle I/IV touched).

## Project Structure

### Documentation (this feature)

```text
specs/1009-activity-indicators/
├── plan.md              # This file (/speckit-plan)
├── spec.md              # Feature spec (/speckit-specify + /speckit-clarify)
├── research.md          # Phase 0 output (/speckit-plan)
├── data-model.md        # Phase 1 output (/speckit-plan)
├── quickstart.md        # Phase 1 output (/speckit-plan)
├── contracts/
│   └── activity-frame.md  # Phase 1 — WS frame + relay contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (already passing)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

This feature edits existing files and adds one client composable + one server
test; it adds **no new directory**, no store, and no migration.

```text
# Client (Vue 3 + Ionic PWA)
src/
├── services/
│   ├── transport.ts          # EDIT: add ActivityFrame to the `Frame` union; sealed-kind helpers
│   └── sync.ts               # EDIT (or useSync live branch): apply inbound activity frames
├── composables/
│   ├── useSync.ts            # EDIT: extend `live` fast-path predicate; sendLive() emit helper; clear on offline/logout
│   ├── useTyping.ts          # NEW: in-memory reactive activity map + ~6s self-expiry (modeled on usePresence.ts)
│   └── usePresence.ts        # REFERENCE: the ephemeral-state model to mirror (no change)
├── views/detail/
│   └── ChatDetailPage.vue    # EDIT: emit (composer input debounce + recording start/stop/cancel); render statusLine override
├── components/
│   └── ChatListItem.vue      # EDIT: render activity over `.preview` last-message subtitle
└── settings/
    └── schema.ts             # EDIT: add one combined privacy toggle (next to privacy.readReceipts) + reciprocity footer

e2e/
└── activity-indicators.spec.ts   # NEW: multi-account typing/recording/expiry/toggle/group scenarios

# Server (Go, stdlib net/http)
server/internal/ws/
├── hub.go                    # EDIT: new frame discriminator case in handleFrame; relay like call-control (stamp from, Hub.Send, no EnqueueRelay/notify/buffer)
└── activity_test.go          # NEW: relay fan-out + from-stamping + asserts nothing queued/persisted
```

**Structure Decision**: Reuse the existing client/server layout (CLAUDE.md
"Monorepo layout"). The feature is realized as: a new client composable
(`useTyping.ts`) mirroring `usePresence.ts` for ephemeral in-memory state; a new
frame variant relayed live by the existing `internal/ws` Hub exactly like
read-receipt / call-control frames; emission wired into the existing chat
composer and recording flows; rendering in the existing chat header and list-row
surfaces; and a single settings-schema toggle. No new subsystem, store, or
migration.

## Complexity Tracking

> No Constitution Check violations — this section is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | — |
