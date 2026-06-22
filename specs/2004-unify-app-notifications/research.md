# Research: Unify in-app notifications/toasts + user-friendly "What's new"

All decisions below were locked in the feature input; this records the rationale and the
alternatives considered so the plan is self-contained.

## R1 — Render the update prompt through the existing banner overlay (not a new component)

- **Decision**: Add an `'action'` notification kind to the existing in-app overlay
  (`notify.ts` + `NotificationBanners.vue`) and route the app-update prompt through it.
- **Rationale**: The overlay already positions message/request/system cards correctly on iOS
  (rounded, below the header). The bug is that the update prompt is the *one* surface still
  on an Ionic toast whose `::part(container)` offset/`--border-radius` hack doesn't take on
  iOS. Reusing the overlay fixes position+corners once and guarantees the four kinds stay
  visually identical (FR-001, FR-004, SC-002).
- **Alternatives**: (a) Keep the toast, try harder CSS — rejected: the iOS `::part`
  behavior is exactly what's broken and brittle. (b) Build a third notification component —
  rejected: defeats the "fix once" goal and re-introduces drift.

## R2 — Persistent, replace-on-reprompt action card

- **Decision**: The action card uses a fixed identity (`url: 'app-update'`) so a re-prompt
  replaces rather than stacks, and is pinned (exempt from `MAX_BANNERS` and the `BANNER_MS`
  auto-dismiss) so it stays until the user acts.
- **Rationale**: FR-003 + the re-prompt edge case. The overlay already dedups by `url`
  (`pinnedUrls`), so this is reuse, not new machinery.
- **Alternatives**: A separate persistent-banner store — rejected as redundant.

## R3 — One shared `appToast()` helper for functional/error toasts

- **Decision**: New `src/services/toast.ts` exporting `appToast({message, duration?, color?,
  icon?})`; one `cssClass: 'app-toast'` styled in `App.vue`. Migrate the ~24 confirmation/
  error `toastController.create` call sites.
- **Rationale**: FR-005/FR-006, SC-003 — consistent position/rounding/duration tuned in one
  place; functional toasts stay simple transient toasts (not avatar cards).
- **Alternatives**: Route confirmations through the banner overlay too — explicitly rejected
  by the locked decisions (don't force confirmations into the avatar-card component).
- **Documented exceptions**: App.vue's sticky failed-sends toast (own buttons/lifecycle) and
  the update prompt (now a banner) stay special-cased — recorded so SC-003's "drops to zero"
  is measured excluding them.

## R4 — Harden `prettify` to strip references carrying extra detail

- **Decision**: Broaden `TRAILING_REF` from `\(spec\s*\d+\)` to also match
  `\(spec\s*\d+[^)]*\)` (e.g. `(spec 1013 US2/US3)`), keep `#\d+`/`gh-\d+`, and strip a
  trailing `(+ …)` parenthetical. Add `prettify` unit tests (failing-first per Principle III).
- **Rationale**: FR-007, SC-004 — the current regex misses refs with trailing detail, which
  is the reported jargon leak. This is display-time cleanup of *already-shipped* subjects.
- **Alternatives**: Rewrite history — impossible/undesirable. The cleanup + the governance
  rule (R5) together cover historical and future notes.

## R5 — Governance: user-facing release-note subjects (constitution + CLAUDE.md)

- **Decision**: Amend constitution Principle VII (Quality Gates) to require that user-facing
  commit types (`feat`/`fix`/`perf`/`security`) have plain-language, benefit-focused,
  jargon-free, reference-free subjects (they become "What's new"); bump the constitution
  `1.1.0 → 1.2.0` (Sync Impact header + footer). Add matching guidance + a good/bad example
  to CLAUDE.md's "Commit messages" section.
- **Rationale**: FR-008, SC-005 — the "What's new" line is *solely* the prettified subject,
  so the durable fix is the subject phrasing; prettify (R4) is the safety net for history.
- **Alternatives**: CLAUDE.md only — rejected: the constitution is the governing authority a
  spec is checked against, so the rule belongs there with a version bump.

## TDD / verification note

- The one unit-testable change (R4 `prettify`) gets a FAILING test first.
- The banner/toast **rendering** is not unit-testable in this harness (no DOM-screenshot in
  vitest); verified via `drive/` screenshots against the live `make start` stack — a
  recorded, justified deviation from adding an e2e spec. (See quickstart.md.)
