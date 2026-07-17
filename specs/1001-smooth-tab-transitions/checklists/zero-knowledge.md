# Zero-Knowledge & Privacy Requirements Checklist: Smooth Tab Transitions

**Purpose**: Validate that the zero-knowledge / privacy requirements for this
feature are complete, clear, consistent, and measurable BEFORE implementation.
Required by Constitution Principle I (this spec introduces an in-memory cache of
decrypted user content). This tests the *requirements writing*, not the code.
**Created**: 2026-06-15
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [data-model.md](../data-model.md)
**Audience / timing**: Reviewer at PR / pre-implementation gate. Depth: Standard.

## Zero-Knowledge Boundary Completeness

- [x] CHK001 Are the requirements explicit that no new data crosses the client/server wire as a result of this feature? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK002 Is it specified that no new server-side log line, metric, or error payload is introduced by the warm-cache change? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK003 Are the data categories held in the warm cache (own-profile name/avatar, chat/call/contact lists) each enumerated as user content subject to the boundary? [Completeness, Data-model §In-memory warm stores]
- [x] CHK004 Is there a requirement stating that no migration, object store, or `DB_VERSION` change is introduced (so no new at-rest surface is created)? [Completeness, Plan §Technical Context]

## Plaintext-at-Rest Prohibition (the core decision)

- [x] CHK005 Is the requirement that decrypted profile/list values live **in memory only** stated unambiguously (not "should", not implied)? [Clarity, Spec §Zero-Knowledge Impact / FR-ZK-1]
- [x] CHK006 Is the prohibition on persisting any warm-cache plaintext to clear storage (IndexedDB, localStorage, sessionStorage, SW caches) stated as a testable invariant? [Measurability, Spec §FR-ZK-1 / Data-model §Validation/invariants]
- [x] CHK007 Is the rejected alternative (a cleartext-at-rest cache) documented with its rationale, so the decision is traceable? [Traceability, Research §D2]
- [x] CHK008 Is "clear storage" defined or scoped enough that a reviewer can objectively check no excluded medium (e.g., service-worker cache, in-flight serialization) leaks plaintext? [Ambiguity → resolved, Spec §FR-ZK-1 enumerates media + reload/cross-origin scope]

## Lifecycle: Warm & Clear-on-Lock

- [x] CHK009 Is the trigger for warming the cache (keystore unlock / `isUnlocked` → true) specified precisely enough to be verifiable? [Clarity, Contracts/warm-stores.md §Wiring]
- [x] CHK010 Is the requirement that the cache is fully cleared on lock/teardown stated, including "no decrypted residue reachable in memory"? [Completeness, Spec §FR-ZK-2 / Data-model §lifecycle]
- [x] CHK011 Is "fully cleared" measurable — does a requirement define what evidence proves no residue remains (e.g., refs reset to cold initial values)? [Measurability, Spec §FR-ZK-3 / SC-006]
- [x] CHK012 Are requirements defined for the sign-out / account-removal path (not just lock) to ensure the warm cache does not outlive the session? [Coverage, Spec §FR-ZK-2 / Tasks §T006]
- [x] CHK013 Is behavior specified for the locked state (app open but keystore locked) — that the cache stays cold and falls back to the non-identifying placeholder? [Coverage, Spec §FR-ZK-5]

## Consistency With Existing Crypto/Privacy Invariants

- [x] CHK014 Do the warm-cache requirements stay consistent with reading secrets only through the existing `getSecret` path (no new decryption route)? [Consistency, Spec §FR-ZK-7 / Research §D2]
- [x] CHK015 Is it consistent that the warm stores still subscribe to the `idb` change bus, so a profile edit or list change propagates without re-introducing stale plaintext or a reload? [Consistency, Data-model §lifecycle]
- [x] CHK016 Are the privacy/data-minimization requirements aligned — i.e., the feature collects/transmits nothing new (Constitution IX)? [Consistency, Spec §Zero-Knowledge Impact]
- [x] CHK017 Do the requirements avoid conflict between "show real identity on first paint" (FR-005) and "never reveal plaintext at rest" — resolved explicitly via the in-memory path? [Conflict → resolved, Spec §FR-005 + §FR-ZK-1/FR-ZK-7]

## Acceptance Criteria & Verifiability

- [x] CHK018 Is there a measurable acceptance criterion that an inspection of clear storage after using all tabs reveals no profile/list plaintext? [Measurability, Spec §SC-006 / Tasks §T025b]
- [x] CHK019 Is the zero-knowledge invariant represented in the task list with an explicit verification step (not only prose in the spec)? [Traceability, Tasks §T025b, §T026]
- [x] CHK020 Is the unit-test obligation for "clearWarm leaves no decrypted residue" captured as a requirement, with a definition of pass/fail? [Measurability, Spec §FR-ZK-3 / Tasks §T003]

## Edge Cases & Failure Modes

- [x] CHK021 Are requirements defined for a failed/aborted unlock — that warming does not run and no partial plaintext is cached? [Edge Case, Spec §FR-ZK-4]
- [x] CHK022 Is behavior specified if `getSecret` decryption fails mid-warm (does the cache stay cold/empty rather than caching a partial or fallback value as if real)? [Exception Flow, Spec §FR-ZK-4 / Tasks §T003]
- [x] CHK023 Are requirements defined for app backgrounding/resume so the warm cache's plaintext lifetime matches the intended unlocked-session scope (re: "Returning after backgrounding" edge case)? [Coverage, Spec §FR-ZK-2/FR-ZK-5 — lifetime bound to unlocked session, cleared on lock]
- [x] CHK024 Is the multi-tab / multi-window PWA case considered — does any requirement address whether warm plaintext could be shared or leaked across contexts? [Coverage, Spec §Assumptions — per-context singleton, no cross-context sharing]

## Scope Boundary & Assumptions

- [x] CHK025 Is the assumption that "no server/wire/data-model change is required" stated and validated against the actual design (warm cache is purely client-side)? [Assumption, Spec §Assumptions]
- [x] CHK026 Are the surfaces that consume own-profile (call tiles, group lists, reply quotes, media captions) in-scope for the same in-memory guarantee, or explicitly out of scope? [Boundary, Spec §FR-ZK-6 / Contracts/warm-stores.md §useSelfProfile]
- [x] CHK027 Is it documented that this feature does not weaken the existing AEAD-at-rest wrapping of secrets (only adds an in-memory read cache on top)? [Clarity, Spec §FR-ZK-7]

## Notes

- Check items off as completed: `[x]`. Record findings inline.
- An unchecked item is a requirements-quality gap to fix in spec/plan/data-model
  before `/speckit-implement` — not an implementation bug.
- This checklist intentionally tests the *requirements*, not the code; behavioral
  verification lives in the e2e/unit tasks (T003, T026).
