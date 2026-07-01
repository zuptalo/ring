# Implementation Plan: App-wide UX polish and fixes

**Branch**: `feat/1025-app-ux-polish` | **Date**: 2026-07-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1025-app-ux-polish/spec.md`

## Summary

Nine independent, mostly client-side UX fixes. Grounded in a codebase survey, most items are small
wiring or presentation changes against existing infrastructure (router history, notification
surfaces, settings schema, media thumbnail tiers, call records). Two spec assumptions were resolved
during research: in-app vibration is a no-op on the PWA (remove the toggle), and per-call data-usage
bytes are already captured/stored (only a totals *summary* is new). The Help self-test turned out to
be a real crypto verification, so it is kept; the actual cleanup is the stale hardcoded version.

## Technical Context

**Language/Version**: TypeScript (ES modules), Vue 3 `<script setup>` + Ionic; Go 1.26 server (not touched here).

**Primary Dependencies**: Vue Router, Ionic components, IndexedDB via `src/db/idb.ts`, existing
notification surfaces (`src/sw.ts`, `src/services/sw-inbox.ts`, `src/services/notify.ts`), call
stack (`src/composables/useCall.ts`), media thumbnail tiers (`Media` in `src/db/types.ts`).

**Storage**: IndexedDB only. No new object store and no `DB_VERSION` bump — Calls totals are derived
on-device from existing `Call` records (`durationSec`, `bytes`).

**Testing**: `npm run build` (vue-tsc typecheck), `vitest` unit, Playwright e2e (`e2e/`). New/changed
user-facing behavior adds or extends an e2e spec (constitution III).

**Target Platform**: Installable PWA (iOS Safari primary, Android Chrome), served by `ringd`.

**Project Type**: Single web client (repo root `src/`) + Go server (`server/`, untouched by 1025).

**Performance Goals**: No regressions; media-viewer poster must be crisp on high-density displays;
animations toggle takes effect without reload.

**Constraints**: Offline-first; zero-knowledge boundary; Ionic-first UI (stock components).

**Scale/Scope**: 9 UI/wiring items across ~10 client files; no server, crypto, or migration changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary (NON-NEGOTIABLE)**: PASS. Every item is client-side. No new server
  field, no plaintext to the server; push tickles stay content-free. Calls totals are derived from
  local records. **Zero-Knowledge Impact**: none — no data crosses the client/server boundary that
  did not already, and nothing new is stored server-side.
- **II. Spec-Driven Development**: PASS. Spec + this plan on `feat/1025-app-ux-polish`; `/analyze`
  will be run clean before implement; taskstoissues will make each task traceable.
- **III. Test-Driven Development**: PASS with intent. Behavioral items (deep-link back-nav, show-
  preview genericization + hidden precedence, animations honored, calls totals/date/format) get
  e2e coverage written before/with the change; unit tests for the new date + totals helpers.
  Pure-visual items (media poster size, ttl spacing, hidden-row background) are verified via build +
  the drive harness where an e2e assertion would be brittle; the e2e added still covers their DOM
  wiring where practical.
- **IV. Crypto Discipline**: N/A — no crypto change (self-test is kept as-is).
- **V. Offline-First Data Integrity**: PASS — no store/`DB_VERSION` change.
- **VI. Stateless Server & Forward-Only Migrations**: N/A — no server change.
- **VII. Quality Gates**: PASS — full CI (build + vitest + e2e, server unchanged) must be green;
  user-facing commit subjects will be plain-language release-note copy.
- **XI. Ionic-First UI**: PASS — reuse stock Ionic components (`ion-item-sliding`, `ion-list`,
  `ion-modal`, settings schema link/toggle/stat items); only presentation/wiring changes.

No violations → Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/1025-app-ux-polish/
├── plan.md              # This file
├── research.md          # Phase 0 output (assumptions resolved)
├── data-model.md        # Phase 1 output (entities: Call totals, media tiers — no new store)
├── quickstart.md        # Phase 1 output (manual verification steps)
├── checklists/
│   └── requirements.md  # spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── main.ts                              # (1) cold-start base-history seed
├── App.vue                              # (1) routeRelevant seeds /tabs/chats before deep link
├── directives/autoplay-visible.ts       # (3) honor chats.animGifs (not only prefers-reduced-motion)
├── settings/schema.ts                    # (3) drop one Animations entry; (4) drop Vibrate toggle; (7) version -> __APP_VERSION__
├── services/
│   ├── notify.ts                         # (4) drop vibrate; (5) genericize title when preview off
│   └── sw-inbox.ts                       # (5) genericize title when preview off (background)
├── components/
│   ├── MediaViewer.vue                   # (2) video poster prefers large tier
│   ├── VideoPlayer.vue                   # (2) .vid-el fills frame
│   └── ChatListItem.vue                  # (6) hidden-row opaque background for clean swipe
├── views/
│   ├── detail/
│   │   ├── ChatDetailPage.vue            # (2) viewer thumb tier; (8) ttl spacing + incoming placement
│   │   └── CallDetailPage.vue            # (9) swap Video/Message buttons; ISO date
│   └── tabs/CallsPage.vue                # (9) ISO date; totals summary
└── utils/time.ts                         # (9) formatDay (YYYY-MM-DD); + call totals helper (utils/call-totals.ts)

e2e/
├── deeplink-back.spec.ts                 # (1) back from cold-start deep link → Chats
├── notification-preview.spec.ts          # (5) preview off genericizes; hidden always generic
├── animations-setting.spec.ts            # (3) single entry; animGifs honored
└── calls-summary.spec.ts                 # (9) ISO dates, button order, totals
```

**Structure Decision**: Single web client. Changes are localized edits to existing components,
services, the settings schema, and small pure helpers (date + totals) that get unit tests. No new
IndexedDB store, no server or crypto changes.

## Complexity Tracking

No constitution violations — section intentionally empty.
