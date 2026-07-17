# Implementation Plan: Multi-Size Image Thumbnails + Album-View Overhaul

**Branch**: `feat/1014-image-thumbnails-album` | **Date**: 2026-06-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1014-image-thumbnails-album/spec.md`

## Summary

Give shared chat images three purpose-fit, persisted thumbnail tiers — **bubble (512)**, **grid
(320)**, **strip (128)** — so the chat bubble, all-media grid, and full-screen viewer strip each
render a right-sized preview instead of decoding the full image. The **sender transmits the bubble
tier inline in the existing E2EE `MediaRef.poster`** (already used for video posters); both sides
**derive grid/strip locally** by downscaling it and persist all three, so a recipient sees previews
**before/without downloading the full image**. Videos get grid/strip downscaled from their existing
poster; existing on-device media is **backfilled** in the background. Cleanup becomes thumbnail-aware
(accounting + deletion of all tiers, a "free space, keep previews" action, per-chat + global). And the
**album view is overhauled** for robustness (index/empty/cleared/large-album/zoom), fluidity
(counter, keyboard, focus, strip centering, return-scroll), and a11y/RTL/theme. Client-first; the
server relays the same opaque sealed envelope.

## Technical Context

**Language/Version**: TypeScript (ESM), Vue 3 `<script setup>` + Ionic 8; Node 22 toolchain.
**Primary Dependencies**: existing media pipeline — `media-encode.ts`, `media-meta.ts`
(`generateImageThumb`/`generateVideoPoster`, `posterLimiter`), `media-transfer.ts`
(`prepareOutgoingMedia`/`receiveIncomingMedia`), `media-jobs.ts`; `crypto/message.ts` `MediaRef`
(E2EE `poster` data-URL); the `Media` IndexedDB store; `MediaViewer.vue`, `AllMediaPage.vue`,
`ChatDetailPage.vue` (bubble + in-bubble album grid), `StorageManagePage.vue`. No new runtime dep.
**Storage**: IndexedDB only — `Media` gains `posterGrid?`/`posterStrip?` Blobs (`posterBlob`
repurposed as the bubble/large tier); `DB_VERSION` **7 → 8** with a forward, additive migration. No
server/SQL/Postgres change.
**Testing**: vitest (pure thumbnail-derive/size math; `migrateMessageToV8`/`idb.migration.test.ts`);
Playwright e2e (thumbnails before-download + bubble/grid/strip tier usage; viewer robustness;
navigation; cleanup); manual `quickstart.md` for feel + backfill.
**Target Platform**: installable PWA (iOS Safari + Android Chromium; desktop PWA).
**Project Type**: single client app (`src/`); Go server untouched.
**Performance Goals**: smooth scroll on 100+ image chats (bubble tier, no full-res decode);
viewport-gated grid decode; bounded full-res memory in the viewer; thumbnail generation off the send
path and backfill throttled.
**Constraints**: preserve the zero-knowledge boundary (thumbnails ride the existing E2EE poster);
offline-first (additive migration + background backfill, no data loss); spec-1011/1012/1013 chat
scroll unchanged; LTR/RTL + light/dark; Ionic-first where a primitive exists.
**Scale/Scope**: 5 user stories across `Media`/`idb` (schema+migration), `media-meta`/`media-jobs`/
`media-transfer` (generation+wire), `ChatDetailPage` (bubble/grid), `AllMediaPage` (grid+cleanup),
`MediaViewer` (overhaul), `StorageManagePage` + `queries` (accounting/cleanup), settings.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1.*

| Principle | Verdict | How this plan satisfies it |
|---|---|---|
| **I. Zero-Knowledge (NON-NEGOTIABLE)** | ✅ Pass | Thumbnails ride the existing E2EE `MediaRef.poster` (already used for video); server relays opaque ciphertext; no new frame/endpoint/metadata. Spec has a **Zero-Knowledge Impact** section; **`/speckit-checklist` (ZK) REQUIRED** before implement. |
| **II. Spec-Driven** | ✅ Pass | specify → clarify → **plan** → tasks → analyze → checklist → taskstoissues → implement; spec id 1014 on every artifact. |
| **III. TDD** | ✅ Pass | Pure thumbnail-size/derive helpers + `migrateMessageToV8` → vitest first; new user-facing behavior (thumbnails, viewer robustness/nav, cleanup) → e2e first. |
| **IV. Crypto Discipline** | ✅ N/A | No crypto change; thumbnails use the existing media-encryption path; `messaging.ts` untouched. |
| **V. Offline-First Data Integrity** | ✅ Pass | `Media` += `posterGrid`/`posterStrip`; `DB_VERSION` 7→8 with a forward, additive migration preserving data; backfill is a bounded runtime job (not the migration); reads stay reactive via the idb bus. |
| **VI. Stateless Server / Migrations** | ✅ N/A | No server or SQL change. |
| **VII. Quality Gates** | ✅ Pass | DoD = build + vitest(+floors) + go (unchanged) + e2e green; Conventional Commits; PWA stays `registerType:'prompt'`. |
| **VIII. Traceable Delivery** | ✅ Pass | ROADMAP row; tasks→issues; PR lists `Closes #N`. |
| **IX. Privacy & Data Minimization** | ✅ Pass | Sends one small thumbnail (already done for video posters); cleanup is local; no telemetry; "free space, keep previews" reduces stored bytes. |
| **X. Accessibility & i18n** | ✅ Pass (net improvement) | The overhaul ADDS alt text/ARIA, keyboard nav + focus trap, RTL-correct navigation, and theme-aware viewer — fixing current gaps. |
| **XI. Ionic-First UI** | ⚠️ Pass w/ note | The full-screen `MediaViewer` is a pre-existing **custom** component (no Ionic primitive provides a zoomable swipe gallery + strip); justified in Complexity. New affordances (counter, buttons, placeholders) compose Ionic + theme tokens. |

**Initial gate (pre-Phase 0)**: PASS. **Post-design gate (after Phase 1)**: PASS — the only persisted
change is two additive blobs + a forward migration (V), and the wire reuses the existing E2EE poster
(I). See Complexity & Exceptions for the single-spec scope and the custom-viewer note.

## Project Structure

### Documentation (this feature)

```text
specs/1014-image-thumbnails-album/
├── spec.md · plan.md (this) · research.md (D1–D11) · data-model.md · quickstart.md
├── contracts/thumbnails-and-viewer.md
├── checklists/requirements.md   (+ zero-knowledge.md from /speckit-checklist — REQUIRED)
└── tasks.md                     (/speckit-tasks — next)
```

### Source code (files this feature touches)

```text
src/
├── db/
│   ├── types.ts             # Media += posterGrid?, posterStrip? (posterBlob = bubble tier)
│   ├── idb.ts               # DB_VERSION 7→8 + migrateMessageToV8 (additive) + onupgradeneeded
│   ├── idb.migration.test.ts# + v8 migration test
│   └── queries.ts           # storage accounting incl. thumbnails; delete-all-tiers; keep-previews; per-chat
├── services/
│   ├── media-meta.ts        # size-parameterized thumb gen + deriveTiers(posterBlob); separate img limiter
│   ├── media-transfer.ts    # send bubble tier as MediaRef.poster (images); store tiers on receive
│   └── media-jobs.ts        # background derive grid/strip + the one-time backfill pass
├── utils/
│   └── (thumb-size / derive math, pure)        # + unit tests
├── views/detail/
│   ├── ChatDetailPage.vue   # bubble → posterBlob; in-bubble album cells → posterGrid
│   ├── AllMediaPage.vue     # grid → posterGrid (persisted); viewport-gated decode; per-chat cleanup default
│   └── StorageManagePage.vue# thumbnail-aware totals + per-chat actions + keep-previews
├── components/
│   └── MediaViewer.vue      # robustness (index/empty/cleared/LRU/zoom), nav (counter/keyboard/focus/strip/return), a11y/RTL/theme; strip → posterStrip
└── settings/schema.ts       # storage/cleanup entries as needed

e2e/  # new specs: thumbnails (before-download + tiers), viewer robustness + navigation, cleanup
```

Server (`server/`) untouched.

## Phase plan (for /speckit-tasks)

1. **Setup/baseline** — green gates; confirm media test fixtures.
2. **Foundational (blocks the rest)** — `Media` fields + `DB_VERSION` 7→8 migration (+ failing
   migration test); pure thumb-size/derive helpers (+ failing vitest).
3. **US1 (P1) thumbnails** — generate bubble tier at send → `MediaRef.poster`; derive+persist
   grid/strip (send/receive); video grid/strip from poster; **backfill** job; switch bubble→posterBlob,
   grid→posterGrid, strip→posterStrip. (e2e: preview before download; tier usage; grid persistence.)
4. **US2 (P1) viewer robustness** — index clamp/empty/stale-player guards; cleared/undownloaded
   placeholder; nearby() bounds; per-item zoom reset; full-res LRU via `selectEvictions`. (e2e: delete
   mid-view; placeholder; bounded memory.)
5. **US3 (P2) navigation** — counter; keyboard + focus trap/restore; strip centering; zoom-exit
   affordance; return-to-scroll. (e2e: counter; keyboard; strip tracks; scroll restored.)
6. **US4 (P2) cleanup** — thumbnail-aware accounting; delete-all-tiers; "free space, keep previews";
   per-chat default + app-wide. (e2e: totals; no orphans; keep-previews; per-chat.)
7. **US5 (P2) a11y/RTL/theme + perf** — alt/ARIA; RTL-correct carousel; theme tokens; viewport-gated
   grid decode + separate limiter.
8. **Polish** — quickstart smoke (incl. backfill + real-device feel), DoD gate.

## Complexity & Exceptions

- **Single large spec (user-chosen)**: thumbnails + album-view overhaul were deliberately folded into
  one feature because they touch the same components and the strip tier ties directly into the viewer.
  Mitigated by prioritized, independently-testable user stories (US1/US2 are the P1 core; US3–US5
  layer on) so it ships incrementally.
- **Custom `MediaViewer` component (Principle XI)**: a zoomable, swipeable full-screen gallery with a
  thumbnail strip has no stock Ionic primitive; the component pre-exists and this spec hardens it
  (a11y, theme tokens, robustness) rather than introducing a new bespoke widget. New chrome composes
  Ionic + existing theme tokens. Justified.

No other waivers.

## Phase 1 agent-context update

`CLAUDE.md` SPECKIT plan pointer updated to `specs/1014-image-thumbnails-album/plan.md`.
