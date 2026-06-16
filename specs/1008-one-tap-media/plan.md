# Implementation Plan: One-Tap Media Open & Inline Quick-React Bar

**Branch**: `feat/1008-one-tap-media` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1008-one-tap-media/spec.md`

## Summary

Re-wire the chat message interaction (reworking spec 1004): a **single tap** on
image/video/album opens the media directly; the **full action menu** moves to
**long-press**; and the quick-react emoji moves out of the menu into a
**direction-aware bottom-row button** that opens a transient popover of the **7
most-used emoji + "+"** (all visible, no scrolling). Popups are mutually exclusive and
auto-dismiss when the chat view is left. Client-only; reactions use the existing E2EE
path and the existing on-device usage tally.

## Technical Context

**Language/Version**: TypeScript (ES modules), Vue 3 `<script setup>`; Go unaffected.

**Primary Dependencies**: Ionic Vue (`ion-popover`, `ion-icon`, `ion-list`/`ion-item`),
existing `quickReactEmojis` tally (`src/db/queries.ts`), the emoji picker and media
viewer already in `ChatDetailPage.vue` / `MessageActions.vue` / `MediaViewer.vue`.

**Storage**: No new store. Reuses the `emojiUsage` setting (IndexedDB) behind
`quickReactEmojis`. No `DB_VERSION` bump.

**Testing**: `vue-tsc` typecheck + `vite build`; Playwright e2e via `window.__ringTest`
and real taps/long-press in the chat view.

**Target Platform**: Installable PWA (iOS Safari + Chromium), touch-first.

**Project Type**: Client (repo root `src/`); no server/`server/` change.

**Performance Goals**: 60fps interaction; popover open is instant; no extra media
decode (one-tap-open reuses the existing viewer path).

**Constraints**: Offline-capable (no network needed for any of this); RTL + LTR;
light/dark themes; long-press must coexist with the existing swipe-to-reply gesture.

**Scale/Scope**: One view (`ChatDetailPage`) + 1–2 small components; ~no data layer.

## Constitution Check

*GATE: re-checked after design below.*

- **I. Zero-Knowledge (NON-NEGOTIABLE)**: PASS — client-only UI/gesture change.
  Reactions ride the existing E2EE reaction path unchanged; the emoji usage tally is a
  local preference, never sent. Zero-Knowledge Impact section present in the spec.
- **III. TDD**: PASS — behavior is covered by new e2e (one-tap open per media kind,
  quick-react popover shows 7 + "+", apply + custom, long-press opens full menu, popup
  auto-dismiss on leave). Extend `e2e/message-menu.spec.ts` / add `e2e/quick-react.spec.ts`.
- **V. Offline-First**: PASS — no new object store, no `DB_VERSION` change; reuses the
  reactive message store and the existing usage setting.
- **IX. Privacy & Data Minimization**: PASS — usage tally stays on-device.
- **X. Accessibility & Internationalization**: GATE — long-press needs an accessible
  equivalent and must not trap keyboard/AT users; the reaction button and menu items
  carry `aria-label`s; the bottom row must mirror correctly in RTL. Addressed in design.
- **XI. Ionic-First UI**: PASS — quick-react and full menu are `ion-popover`s composed
  of stock `ion-icon`/`ion-list`/`ion-item` + existing `--ring-*`/palette tokens; no
  hand-rolled widgets. The reaction button is an `ion-icon` (`add-circle-outline`).

No violations → Complexity Tracking not required.

## Phase 0 — Research / Decisions

1. **Long-press detection.** Reuse the proven pattern already in `VideoNote.vue`
   (pointerdown → 500ms timer → emit; suppress the subsequent click if it fired).
   **Decision**: extract it into a tiny `useLongPress` composable
   (`src/composables/useLongPress.ts`) and apply it to the bubble, so VideoNote and the
   text/media bubbles share one implementation. The timer MUST cancel on `pointermove`
   beyond a small threshold so a horizontal **swipe-to-reply** (existing
   `onSwipeStart/Move/End`) never also triggers the menu, and on `pointerup/cancel`.
   *Alternative rejected*: Ionic `gesture` / `@ionic/core` press gesture — heavier and
   duplicates what the 500ms timer already does cleanly here.

2. **Tap vs long-press vs swipe coexistence.** Bubble keeps `@click` for the tap action
   (media → `openMediaViewer`; text → no-op) but the click is ignored when a long-press
   just fired (the composable exposes a suppress flag). Swipe-to-reply continues to own
   horizontal drags; the long-press timer is cancelled once a drag is detected.
   **Decision**: single shared pointer pipeline on the bubble root.

3. **Quick-react popover.** A small `ion-popover` anchored to the reaction button,
   rendering a new `QuickReactBar.vue` (7 emoji buttons via the existing `Emoji`
   component + a trailing `add-circle-outline` "+"). Source the 7 from
   `quickReactEmojis(7)`. **Decision**: fixed 7, single non-scrolling flex row so all
   are visible (kills the 1004 sliding problem). "+" reuses the existing emoji picker
   (`openEmojiPicker`).

4. **Full menu = MessageActions minus the emoji row.** Remove the inline quick-react row
   from `MessageActions.vue` (it now lives in the bottom-row button); keep all actions
   (reply/forward/edit/save/saveAll/copy/select/delete/info/reactions/**view**). Open it
   from long-press instead of single tap.

5. **Exclusivity + auto-dismiss.** Track the open popover; opening either one dismisses
   the other first. On `onIonViewWillLeave` (covers back button AND swipe-back) dismiss
   any open popover via `popoverController.dismiss()`. **Decision**: a single
   `dismissOpenPopovers()` helper called on leave and before opening either popup.

6. **Direction-aware bottom row.** Restructure the bubble's `.time` span into a flex row
   `.msg-foot` containing the reaction button and the time+tick, ordered by
   `m.outgoing` (sent: react left, time+tick right; received: time left, react right),
   slightly taller. Albums get the same foot. RTL handled by logical layout.

## Phase 1 — Design

**Components / files to change** (client only):

- `src/composables/useLongPress.ts` *(new)* — shared long-press (cancel on move/up),
  exposes a handler set + a "suppress next click" flag.
- `src/components/QuickReactBar.vue` *(new)* — popover content: 7 most-used emoji +
  "+"; emits `{ emoji }` or `more`.
- `src/components/MessageActions.vue` — drop the emoji row; keep the action list.
- `src/components/VideoNote.vue` — switch its inline long-press to `useLongPress`
  (no behavior change), so there's one implementation.
- `src/views/detail/ChatDetailPage.vue` —
  - bubble: tap → `openMediaViewer` for media / no-op for text; long-press → full menu;
  - new `.msg-foot` direction-aware row with the `add-circle-outline` reaction button;
  - `openQuickReact(message, event)` → quick-react popover; wire emoji apply + "+";
  - `openMenu` becomes long-press-triggered and uses the trimmed MessageActions;
  - `dismissOpenPopovers()` on `onIonViewWillLeave` + before opening either popup;
  - album bubble gets the same foot + gestures.

**Data model**: N/A (no entities; reuses the `emojiUsage` setting). No migration.

**Contracts**: N/A (no API/wire change).

**Quickstart / test scenarios**: see [quickstart.md](./quickstart.md).

### Constitution re-check (post-design)

Still PASS. A11y addressed (aria-labels on the reaction button + menu items; long-press
keeps the menu reachable, tap/react are simple targets; RTL via logical layout).
Ionic-First upheld (popovers + stock components). No new persistence (Offline-First).

## Project Structure

### Documentation (this feature)

```text
specs/1008-one-tap-media/
├── plan.md        # this file
├── spec.md        # feature spec (specified + clarified)
├── quickstart.md  # Phase 1: e2e/test scenarios
└── tasks.md       # /speckit-tasks output (next)
```

(`research.md`, `data-model.md`, `contracts/` intentionally omitted — research/design
folded above; no data model or external contract for a client-only gesture change.)

### Source Code (repository root)

```text
src/
├── composables/
│   └── useLongPress.ts          # new: shared long-press
├── components/
│   ├── QuickReactBar.vue        # new: 7 most-used + "+" popover content
│   ├── MessageActions.vue       # change: drop inline emoji row
│   └── VideoNote.vue            # change: use useLongPress
└── views/detail/
    └── ChatDetailPage.vue       # change: gestures, .msg-foot, quick-react, dismissal
e2e/
├── message-menu.spec.ts         # update: long-press opens menu; media tap opens viewer
└── quick-react.spec.ts          # new: 7+"+" popover, apply, custom, auto-dismiss
```

**Structure Decision**: Single client project (repo root `src/`), no server changes;
the feature is concentrated in `ChatDetailPage.vue` plus two small new files.

## Complexity Tracking

No constitution violations — none required.
