# Checklist: Zero-Knowledge & Requirements Quality — 1024

**Purpose**: Validate that the requirements for resilient posting + storage are written well enough
to implement without eroding the zero-knowledge boundary (Constitution Principle I / IV). Unit tests
for the English, not the code.

**Created**: 2026-06-30 · **Focus**: Zero-Knowledge (required) + completeness/clarity/edge-cases ·
**Audience**: Reviewer (pre-implementation gate)

## Zero-Knowledge & Crypto (Principle I / IV)

- [x] CHK001 Does the spec explicitly state what (if anything) NEW crosses the client/server boundary, and confirm it is unchanged? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK002 Is the at-rest treatment of the cached working blobs specified (plaintext, same class as the existing `media` store, not separately AEAD-wrapped)? [Clarity, Spec §ZK Impact / FR-011]
- [x] CHK003 Are requirements clear that only sealed ciphertext + opaque blob ids are uploaded — no new fields, endpoints, or recipient metadata? [Clarity, Spec §FR-011, contracts/outbox.md]
- [x] CHK004 Is it specified that per-item confirmation adds NO new server-visible metadata (rides existing responses)? [Completeness, Spec §ZK Impact / FR-014]
- [x] CHK005 Is the deletion guarantee for cached plaintext blobs defined (none lingering after finalize/cancel)? [Edge Case, Spec §FR-008 / SC-006]
- [x] CHK006 Do timestamp requirements stay client-set on the sealed envelope (no new server timestamp authority)? [Consistency, Spec §ZK Impact / FR-004]
- [x] CHK007 Is `/speckit-checklist` (this gate) recorded as a required pre-implementation step? [Traceability, Spec §ZK Impact / tasks T021]

## Requirement Completeness

- [x] CHK008 Are all pending-post states and transitions (uploading → finalized / failed / canceled) fully specified? [Completeness, data-model.md]
- [x] CHK009 Is "the post is made" defined unambiguously (every item confirmed AND the envelope confirmed)? [Clarity, Spec §FR-004]
- [x] CHK010 Is the new `outbox` store + `DB_VERSION` bump captured as a requirement (offline-first integrity)? [Completeness, plan §Constitution Check V]
- [x] CHK011 Is the storage-exhaustion mid-flight outcome specified (failed + free-space hint, no partial post)? [Completeness, Spec §FR-010]

## Requirement Clarity / Measurability

- [x] CHK012 Are auto-retry semantics quantified ("once", guarded by attempts, before asking)? [Clarity, Spec §FR-013]
- [x] CHK013 Is "resume only unconfirmed items" backed by a defined per-item confirmation signal? [Clarity, Spec §FR-014]
- [x] CHK014 Is the storage headroom quantified (×2.5, 50 MB floor) rather than "enough space"? [Measurability, research D6]
- [x] CHK015 Is "dismisses immediately" given a measurable target? [Measurability, Spec §SC-001]

## Consistency

- [x] CHK016 Are chat + Wall outbox requirements consistent (same worker, same resume path)? [Consistency, Spec §FR-012]
- [x] CHK017 Does the disappear-timer-at-confirmation requirement align across spec, plan, and research? [Consistency, Spec §FR-004 / research D2]

## Edge Cases & Scope

- [x] CHK018 Is the behavior for a corrupt/unreadable cached blob on resume specified? [Edge Case, Spec §Edge Cases]
- [x] CHK019 Is degraded behavior specified when `navigator.storage.estimate` is unavailable (no-op, never block)? [Edge Case, Spec §Assumptions / FR-009]
- [x] CHK020 Is the out-of-scope boundary explicit (no SW background-upload queue, no edit-after-Share, no cross-device handoff)? [Clarity, Spec §Out of Scope]

## Evaluation result

All 20 items **pass** against the current spec/plan/research (every item traces to an existing,
quantified requirement). No gaps to remediate → **ZK gate clear for `/speckit-implement`.**
