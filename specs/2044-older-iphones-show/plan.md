# Implementation Plan: Legacy-iOS lite push path

**Branch**: `fix/2044-older-iphones-show` | **Date**: 2026-07-19 | **Spec**: [spec.md](./spec.md)

## Summary

iPhone 8 (iOS 16.7) proves the failure shape: the SW wakes and fetches (delivered
receipts fire) but dies silently in the decrypt/store/present stage — SW-context
IndexedDB on iOS ≤ 16 hangs/throws — and iOS strikes the subscription out. Fix on two
fronts: (1) an all-device safety fix bounding the IDB read spec 2043 placed inside the
last-resort `showGeneric` (on a hung DB it could hang the guard's own fallback), and
(2) a **lite wake path** gated by a pure `isLegacyIOS(ua)` detector (iOS ≤ 16): show a
visible generic FIRST from IDB-free primitives, then fire delivered receipts via one
bounded token read + the bounded pending fetch, and skip decrypt/store/ledger/settle/
badge entirely. Cold open accepted on that tier. Modern devices' path is byte-identical
apart from the strictly-safer bounded read.

## Technical Context

**Language/Version**: TypeScript (SW context, Workbox injectManifest); no server changes

**Storage**: reuses existing IndexedDB stores read-only-less (the lite path performs at
most one bounded `keystore` read after the show); no schema/DB_VERSION change

**Testing**: vitest (`sw-legacy.test.ts` UA truth table + `withTimeout` hung-read pin);
device pass on iPhone 8; modern-corpus isolation pin

**Target Platform**: legacy = installed-PWA WebKit UAs with iOS major ≤ 16
(`LEGACY_IOS_MAX_MAJOR`); everything else (incl. unparseable UAs) = modern, unchanged

## Constitution Check

- **I. Zero-Knowledge** — PASS. No new wire surface; the lite path transmits strictly
  less (no decrypt attempted). Spec carries the Zero-Knowledge Impact section.
- **II. Spec-Driven** — PASS. Hotfix spec 2044, full artifact set, issues + PR traceable.
- **III. TDD** — PASS. Bug fix starts with the failing detector/bounded-read tests
  (`sw-legacy.test.ts`) written before the implementation; 1182 tests green.
- **IV. Crypto** — N/A (the lite path *removes* crypto work on the affected tier; the
  crypto core is untouched).
- **V. Offline-First** — PASS. No store changes; the page's durable WS drain on open is
  unchanged and is exactly the lite tier's source of truth.
- **VI. Stateless Server** — PASS. Zero server changes.
- **VII. Quality Gates** — PASS. `npm run build`, vitest 1182, `go build/vet` green.
- **VIII–XI** — PASS. Roadmap regenerated; no UI besides existing notifications.

**Gate result: PASS.**

## Project Structure

```text
src/sw.ts                        # bounded showGeneric read; dispatchLiteWake + isLegacyIOS branch
src/services/sw-inbox.ts         # iosMajorVersion, isLegacyIOS, LEGACY_IOS_MAX_MAJOR, withTimeout
src/services/sw-legacy.test.ts   # NEW — UA truth table + hung-read bound pin
specs/2044-older-iphones-show/   # spec, plan, tasks, checklists/zero-knowledge.md
package.json                     # 1.0.5 → 1.0.6 (new release cycle)
```

## Design decisions (from research/recon)

- **Show primitive**: `showQuietNote`/`quietNote` is the only fully IDB-free show; the
  msg lite path uses `showGeneric` (audible) now hang-proofed by the bounded read.
- **Delivered receipts without decryption**: the server emits `delivered` on
  `GET /v1/relay/pending` fetch itself (`relay_handlers.go:56-66`), no ack needed — so
  fetch-only preserves sender ticks.
- **Detector fails toward modern**: unparseable UA ⇒ rich path; iPadOS-Macintosh UAs
  undetectable ⇒ keep modern path (documented limit, matches today's behavior).
- **`stampPushWake` kept** (already 1.5s-bounded): its `push.lastWakeAt` keeps the
  spec-2043 zombie heal honest; worst case on a hung put is one 2h-capped rotation.
- **Reminder call tickle re-rings generically** on legacy (no `readRingShown` IDB
  dedup): an extra ring beats a missed call there.

## Complexity Tracking

> No violations — intentionally empty.
