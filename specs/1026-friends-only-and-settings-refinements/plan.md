# Implementation Plan: Friends-only messaging with privacy, settings and help refinements

**Branch**: `feat/1026-friends-only-and-settings-refinements` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1026-friends-only-and-settings-refinements/spec.md`

## Summary

Make direct (1:1) messaging friends-only by default and retire the redundant "Block unknown account
messages" toggle, then clear several adjacent rough edges: a simpler Privacy screen, real in-app Help
guides, a confirmation before resetting auto-download, an emoji that never renders as a broken image,
and roomier settings captions. The approach is entirely client-side and additive to existing modules
— no server, protocol, storage, or data-model changes. The single real risk (breaking call setup
between participants who are not mutual contacts) is structurally avoided because call signalling
travels a separate inbound path from direct messages.

## Technical Context

**Language/Version**: TypeScript (ES modules), Vue 3 `<script setup>` + Ionic; no Go/server changes.

**Primary Dependencies**: Ionic components, existing IndexedDB layer (`src/db/idb.ts`), the
declarative settings tree (`src/settings/schema.ts`), the message pipeline (`src/db/queries.ts` →
`src/services/messaging.ts`), the call stack (`src/composables/useCall.ts`,
`src/services/call/signalling.ts`), own-data sync (`src/services/ownsync.ts`).

**Storage**: IndexedDB (no schema/`DB_VERSION` change; no new object store). The connection ledger
(`connectedPeers`) and contacts store already exist.

**Testing**: `npm run build` (vue-tsc typecheck), `npm run test:unit` (vitest), `npm run test:e2e`
(Playwright, drives via `window.__ringTest`).

**Target Platform**: Installable PWA (iOS/Android/desktop browsers).

**Project Type**: Client-only change to the existing Vue 3 + Ionic PWA.

**Performance Goals**: No new hot paths; the gate is one extra IndexedDB lookup per inbound 1:1
message (contact/ledger reads already happen immediately after).

**Constraints**: Offline-first; zero-knowledge boundary intact; Ionic-first UI (Principle XI);
settings changes are data edits to `schema.ts`, not new components.

**Scale/Scope**: 6 independent slices; ~5 client files touched + 1 e2e spec reworked + new how-to
content nodes; no migrations.

## Constitution Check

*GATE: must pass before Phase 0 and again after Phase 1.*

- **I. Zero-Knowledge Boundary (NON-NEGOTIABLE)**: PASS. No plaintext crosses the boundary; no new
  server-visible metadata; no new server capability. See the spec's Zero-Knowledge Impact section.
- **II. Spec-Driven Development**: PASS. This spec is being created and taken through the full pipeline
  (specify → clarify → plan → tasks → analyze → taskstoissues → implement). Branch/commits/issues will
  be traceable to spec 1026.
- **III. Test-Driven Development**: PARTIAL → addressed in tasks. Changed store logic (the
  friends-only gate in `queries.ts`) and changed user-facing behavior require coverage: the e2e spec
  is reworked (`e2e/friends-only.spec.ts`), and unit coverage for the emoji fallback and link-preview
  gating is added/verified in `tasks.md`. (Retroactive note: implementation preceded some tests; the
  tasks list backfills them so the suite proves every user story.)
- **IV. Crypto Discipline**: PASS (N/A). No crypto primitives or ratchet logic change; the gate acts
  on an already-decrypted inbound payload. No new sealed formats are introduced.
- **V. Offline-First Data Integrity**: PASS. No object store added/altered; no `DB_VERSION` bump.
- **VI. Stateless Server & Forward-Only Migrations**: PASS. No server or migration changes.
- **VII. Quality Gates Are the Definition of Done**: PASS (planned). Typecheck + unit + e2e green
  before done; user-facing commit subjects written as plain-language release notes.
- **VIII. Traceable, Auto-Closing Delivery**: PASS (planned). One issue per task; the feature→develop
  PR will list `Closes #N` for each.
- **IX. Privacy & Data Minimization**: PASS. Net privacy improvement (unsolicited DMs blocked by
  default); a settings key is removed from sync (less synced data).
- **X. Accessibility & i18n**: PASS. Help content and settings rows use stock Ionic list items with
  wrapping text; bidi rendering unchanged.
- **XI. Ionic-First UI**: PASS. Help how-tos and the moved toggle are data edits to `schema.ts`
  rendered by the existing `SettingDetailPage.vue`; the only CSS is a scoped padding variable.

**Result**: No unjustified gate violations. Proceed.

## Project Structure

### Documentation (this feature)

```text
specs/1026-friends-only-and-settings-refinements/
├── spec.md              # Feature spec (with Clarifications + Zero-Knowledge Impact)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec-quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root) — files touched

```text
src/db/queries.ts                       # US1: unconditional friends-only gate in handleIncoming
src/settings/schema.ts                  # US2/US3/US4: remove Advanced+blockUnknown, move
                                        #   link-preview, add help-* how-to nodes, add confirm to
                                        #   reset-autodownload
src/services/ownsync.ts                 # US2: drop privacy.blockUnknown from synced key allowlist
src/components/Emoji.vue                 # US5: native-glyph fallback when no image asset / no FE0F
src/views/detail/SettingDetailPage.vue  # US6: scoped --inner-padding-bottom for captions/notes
e2e/friends-only.spec.ts                # US1: reworked from e2e/block-unknown.spec.ts
```

No changes under `server/`.

## Complexity Tracking

No constitution gate violations requiring justification. The change deliberately avoids new
components (settings-as-data), new stores, and any server surface, keeping complexity flat.

## Phase 0 / Phase 1 outputs

- `research.md` — the key design questions and how the implementation answers them (chiefly: why the
  friends-only gate cannot break calls).
- `data-model.md` — the (pre-existing) entities the gate reads; confirms no new/changed stores.
- `quickstart.md` — how to manually verify each user story.
