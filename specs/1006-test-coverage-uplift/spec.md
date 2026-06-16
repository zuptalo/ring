# Feature Specification: Test Coverage Uplift

**Feature Branch**: `feat/1006-test-coverage-uplift`

**Created**: 2026-06-16

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "I'd like to increase the test coverage everywhere so we have excellent, meaningful tests for every little thing that can be tested to verify the expected functionality is properly captured and any breaking changes can be quickly and cheaply discovered."

## Overview

Ring has solid coverage on the crypto core (client) and `auth`/`config`/`secrets`
(server), plus an e2e suite for behavior. But many pure, testable units across the
client services/utilities and server stores/handlers lack direct tests, so
regressions surface late (in e2e or manually) instead of cheaply at the unit level.

This effort systematically raises **meaningful** coverage: add fast unit tests for
pure logic across client (`src/services`, `src/db` query helpers, `src/utils`,
composables' pure parts) and server (`internal/store`, `internal/api` handlers
against the in-memory fake store), and extend e2e for user-facing flows not yet
covered. Then **ratchet the coverage floors** so they can't regress.

The bar is "meaningful" — tests that assert real behavior and would catch real
breaks — not coverage-number padding.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pure client logic is unit-tested (Priority: P1)

Pure, deterministic client logic (message/status reducers, query filters, text/
time/bytes utils, the new concurrency limiter, warm stores, chat filters, release
notes, connection/request reconciliation) has direct unit tests.

**Independent Test**: `npm run test:unit` exercises these modules with table-style
cases covering happy paths, edge cases, and known past bugs.

**Acceptance Scenarios**:

1. **Given** a pure module with branching logic, **When** the suite runs, **Then**
   its branches/edge cases are asserted (not just imported).
2. **Given** a previously-fixed bug, **When** practical, **Then** a regression test
   pins it so it can't silently return.

---

### User Story 2 - Server stores/handlers are unit-tested (Priority: P1)

Server handlers and store logic are tested against the in-memory fake store
(no DB), following the existing one-`_test.go`-per-file pattern, covering success,
auth failures, and edge cases (incl. connections/contacts/directory logic).

**Acceptance Scenarios**:

1. **Given** a handler, **When** tested, **Then** success + error/auth paths are
   asserted against the fake store.

---

### User Story 3 - Key user flows have e2e coverage (Priority: P2)

User-facing flows lacking e2e get coverage (or existing specs are extended),
especially the flows touched by recent specs (tab transitions, hints, friendship,
media stability) so breaking changes are caught.

**Acceptance Scenarios**:

1. **Given** a primary user flow without e2e, **When** the suite runs, **Then** a
   spec drives it through `window.__ringTest` / the UI and asserts the outcome.

---

### User Story 4 - Floors ratchet so coverage can't regress (Priority: P2)

Coverage floors are raised to lock in the gains; CI fails if coverage drops below
the new floor.

**Acceptance Scenarios**:

1. **Given** the raised floors, **When** a change lowers coverage below them,
   **Then** CI fails.

### Edge Cases

- Tests MUST be deterministic (no flakiness): avoid time/random/order coupling; a
  flaky test is a defect to fix, not retry-mask.
- DOM/Ionic-heavy components that the node-env vitest can't render are covered via
  e2e or by extracting pure logic to test directly (don't fake the framework).
- Floors are a ratchet: they may only rise; never lower an existing floor.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Add meaningful unit tests for pure client logic across `src/services`,
  `src/db` query helpers, `src/utils`, and the testable parts of composables.
- **FR-002**: Add unit tests for server `internal/store` + `internal/api` handlers
  against the in-memory fake store, per the existing `_test.go` pattern.
- **FR-003**: Extend the e2e suite for user-facing flows lacking coverage, prefer
  extending existing specs over duplicating setup.
- **FR-004**: Raise the gated coverage floors (client crypto core + server
  auth/config/secrets, and any newly-covered modules folded into the gate) to lock
  in gains; floors only ratchet up.
- **FR-005**: All tests MUST be deterministic and assert real behavior (no
  coverage-padding, no flakiness); where a component can't be unit-rendered, extract
  pure logic or cover via e2e.
- **FR-006**: Tests MUST run within the existing harnesses (`npm run test:unit`,
  `go test ./...`, `npm run test:e2e`) with no new test framework.

## Zero-Knowledge Impact *(mandatory)*

- Tests only; no production code behavior change, no wire/server/data-model change.
  Tests MUST NOT weaken zero-knowledge invariants (e.g. no test that persists or
  logs plaintext in a way real code wouldn't); crypto tests keep using the real core.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Measurable, meaningful coverage increase across the targeted client
  and server modules (new test files exist and assert behavior, not just imports).
- **SC-002**: The raised coverage floors pass in CI and would fail on a regression.
- **SC-003**: The full suite stays green and deterministic (no new flakes) across
  repeated runs.
- **SC-004**: At least the flows from recent specs (1001/1003/2002 and 0002/1004/1005
  as they land) have direct unit and/or e2e coverage.

## Assumptions

- This is incremental and ongoing; the spec defines the bar and the first
  substantial batch, and the floors ratchet thereafter.
- Prefer extracting pure logic from DOM-heavy components so it's unit-testable in the
  node-env vitest, rather than adding a heavy component-test runner.
- Sequenced last among the current initiative so it also covers the new code from
  0002 (friendship), 1004 (menu), 1005 (scroll), and 2002 (media).
