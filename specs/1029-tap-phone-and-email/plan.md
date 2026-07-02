# Implementation Plan: Tap a Phone Number or Email in Messages & Posts

**Branch**: `feat/1028-robust-audio-and` (shared with 1028) | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

## Summary

Detect phone numbers and email addresses in already-decrypted **message** and **Wall
post** text and render each as a tappable element; a tap opens an action sheet that
hands off to the OS — Call (`tel:`), Message (`sms:`), Email (`mailto:`), plus Copy.
The correctness lives in a **pure, heavily unit-tested detector** (`src/utils/linkify.ts`)
that returns typed segments; the two renderers (chat `bodyParts`, `EmojiText.vue`)
consume it and stay token-based (XSS-safe by construction — no HTML strings). No
server change, no new wire data.

## Technical Context

**Language/Version**: TypeScript 5, Vue 3 `<script setup>` + Ionic 8 (pure PWA, no Capacitor)
**Primary Dependencies**: none new — the browser handles `tel:`/`sms:`/`mailto:` schemes; reuse `appToast` (`src/services/toast.ts`) + `actionSheetController`
**Storage**: none (entities are derived at render time, never stored)
**Testing**: vitest (the pure detector — where correctness lives) + a lean Playwright e2e (renders tappable, action sheet appears, Copy works, `tel:`/`mailto:` targets are correct)
**Target Platform**: PWA; the OS owns the actual call/SMS/email
**Constraints**: token-based rendering stays injection-safe; detection conservative (no false Call/Email affordances); coexist with existing URL links + `@mentions`; no new server data
**Scale/Scope**: 1 new pure util + 1 small action helper + integration into 2 renderers + tests

## Constitution Check

*GATE: constitution v1.2.0 — PASS.*

| Principle | Status | Notes |
|---|---|---|
| I. Zero-Knowledge | ✅ | No new client→server data; detection is client-only over already-decrypted text; OS hand-off is local. ZK Impact section present. |
| II. Spec-Driven | ✅ | Spec 1029 (ad-hoc); pipeline followed (clarify folded in — the 3 scoping Qs are answered in Clarifications; no residual ambiguity). |
| III. TDD | ✅ | The pure detector is unit-first (the bulk of the feature); the user-facing render/action gets a lean e2e. |
| IV. Crypto Discipline | ✅ (n/a) | No crypto touched; `/speckit-checklist` NOT required (spec touches neither Principle I wire boundary with new data nor IV). |
| V. Offline-First | ✅ | No store/schema change. |
| VI. Stateless Server | ✅ | Server untouched. |
| VII. Quality Gates | ✅ | build + vitest + e2e where behaviour changed. |
| X. Accessibility & i18n | ✅ | Tappable entities are real focusable controls with labels; RTL-safe (token order preserved); action-sheet copy is plain. |
| XI. Ionic-First | ✅ | `actionSheetController` for the menu; no bespoke widgets; the tappable span reuses the existing `.msg-link` styling pattern. |

## Design

### D1. Pure detector `src/utils/linkify.ts`
```ts
type Seg = { text: string } | { kind: 'email'|'phone'; raw: string; value: string };
// segmentContacts(text): Seg[] — splits a PLAIN text run (URL/@mention already
//   handled by the caller) into text + email + phone segments, non-overlapping,
//   left-to-right, longest-first (email before phone so a@1.com isn't half-eaten).
export function segmentContacts(text: string): Seg[];
export function telValue(raw: string): string;    // dial-safe: keep leading +, digits only
export function telHref(raw): string; smsHref(raw): string; mailtoHref(raw): string;
```
- **EMAIL_RE**: conservative RFC-ish (`local@label(.label)+`), local part `[A-Za-z0-9._%+-]+`, domain with ≥1 dot and a 2+ alpha TLD; trailing punctuation excluded.
- **PHONE_RE**: conservative — optional `+`, then 7–15 digits allowing spaces/dashes/dots/parens between groups, bounded so it won't grab long id/hash runs; require a digit count in [7,15] after stripping separators; not immediately adjacent to `@` (so it won't fire inside an email) or to other alphanumerics.
- No HTML built; returns data only.

### D2. Action sheet `src/services/entity-actions.ts`
`presentEntityActions(seg)` → `actionSheetController` with, for phone: Call → `telHref`, Message → `smsHref`, Copy; for email: Email → `mailtoHref`, Copy. Copy = `navigator.clipboard.writeText(raw)` + `appToast('Copied')`. Scheme open via a new `openScheme(uri)` in `src/utils/external.ts` (transient anchor, no `target=_blank` for these schemes) with a graceful no-op if unhandled (Copy always available).

### D3. Message integration `ChatDetailPage.vue`
Extend `BodySeg` with `email?`/`phone?`(+`value`); in `bodyParts`, within each non-URL, non-mention text run, run `segmentContacts` and emit email/phone segments; render them as tappable spans (`.msg-link` style) → `@click.stop.prevent="presentEntityActions(...)"`. Order: URL → mention → **contacts** → emoji (contacts before emoji, after mention, so it never eats a URL/@handle).

### D4. Post integration `EmojiText.vue`
Currently emoji-only. Add `segmentContacts` over each text run before emoji segmentation, rendering email/phone as tappable → `presentEntityActions`. Used by WallPage + PostDetailPage + comments, so posts and comments both gain the feature. (URL linkification in posts stays out of scope — separate concern.)

## Testing strategy
1. **Unit (the core)**: `linkify.test.ts` — a large corpus: phone formats (plain/+/spaces/dashes/parens/dots), emails (plain/sub-addressed/dotted/multi-label), trailing-punctuation trimming, multiple entities in one string, non-overlap with an embedded `@` (email not phone), NON-matches (order numbers, hashes, times, code) → zero false positives (SC-005), and `telValue`/href normalization.
2. **e2e (lean)**: a message with a phone + an email renders two tappable elements; tapping opens the action sheet; Copy places the value on the clipboard; assert the rendered `tel:`/`mailto:` targets (native open itself isn't invocable headless).
3. Keep existing message/emoji tests green.

## Complexity Tracking
No violations. The only judgement call is the conservative phone regex; mitigated by the large NON-match corpus in the unit tests (SC-005).
