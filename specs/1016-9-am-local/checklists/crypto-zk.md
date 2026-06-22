# Checklist: Crypto / Zero-Knowledge — 9-AM-Local Version-Announcement Push

**Purpose**: Validate that the REQUIREMENTS (spec.md + plan.md + NFR-ZK + Zero-Knowledge
Impact) are complete, unambiguous, and tight on the zero-knowledge boundary and metadata
minimization. Required by Constitution Principle I (Zero-Knowledge) + Principle IX (Data
Minimization). This feature adds NO new cryptography, so items target the metadata surface,
not cipher/forgery/replay mechanics.

**Created**: 2026-06-22
**Feature**: [spec.md](../spec.md)

## Content-Free Push (no content crosses the push service)

- [x] CHK001 - Do the requirements state explicitly that the push payload carries no release
  notes, version text, location, or user data — only a type marker? [Clarity, Spec §NFR-ZK-001]
- [x] CHK002 - Is it specified that the human-readable "what's new" / version name is fetched
  by the device from the already-public configuration at delivery time, not carried in the
  push? [Completeness, Spec §FR-010]
- [x] CHK003 - Are the requirements consistent that time-shifting WHEN the push is sent does
  not change WHAT it contains (still content-free)? [Consistency, Spec §FR-010/§NFR-ZK-001]

## Metadata Minimization (exactly what the server stores)

- [x] CHK004 - Do the requirements enumerate the EXACT new per-device fields (installed
  version, coarse UTC-offset-minutes, last-announced-version) and nothing more? [Completeness,
  Spec §NFR-ZK-002 / Data Model]
- [x] CHK005 - Is "timezone" pinned to a COARSE UTC offset in whole minutes (not an IANA zone
  name, not coordinates), with only the local HOUR ever used? [Clarity, Spec §NFR-ZK-002,
  Research R2]
- [x] CHK006 - Do the requirements explicitly EXCLUDE IANA zone name, precise location, and
  per-user behavioral/engagement history from what is stored? [Completeness, Spec §NFR-ZK-002]
- [x] CHK007 - Is the installed-version field characterized as already-public information
  (not newly-sensitive), so its storage doesn't widen the trust model? [Clarity, Spec §ZK
  Impact]
- [x] CHK008 - Is it stated that the offset is reported/refreshed via the EXISTING
  subscribe exchange (no new always-on reporting channel that could carry more)? [Coverage,
  Spec §FR-013, Research R1]

## Single-Purpose / No Repurposing

- [x] CHK009 - Do the requirements limit the new metadata's use to exactly two decisions —
  "is this device behind?" and "is it ~9 AM there?" — and nothing else? [Clarity,
  Spec §NFR-ZK-003]
- [x] CHK010 - Is there an explicit prohibition on repurposing the metadata for analytics,
  profiling, or other tracking? [Completeness, Spec §NFR-ZK-003]
- [x] CHK011 - Are the requirements internally consistent that no NEW endpoint or query
  exposes the per-device version/offset back to clients or third parties? [Consistency,
  Spec §Contracts / §FR-013]

## Boundary Unchanged Elsewhere

- [x] CHK012 - Do the requirements affirm that messages, posts, profiles, and media remain
  opaque ciphertext and this feature adds nothing to what the server can read about them?
  [Completeness, Spec §ZK Impact, Boundary]
- [x] CHK013 - Is it clear that removing the old immediate broadcast (Research R7) does not
  itself relax any zero-knowledge guarantee? [Consistency, Research R7]

## Logging & Observability (no profile-building leak)

- [x] CHK014 - Do the requirements/plan state that the new metadata and the scheduler MUST
  NOT be logged in a way that builds a per-user timezone or behavioral profile beyond the
  coarse stored fields? [Gap, Spec §NFR-ZK-003]
- [x] CHK015 - Is it specified that scheduler/delivery logs avoid recording per-device local
  times or send-history in a form that reconstructs user routines? [Coverage, Gap]

## Dedup-on-Send / No Delivery Tracking

- [x] CHK016 - Is once-per-release dedup specified as keyed on SEND (last-announced-version),
  explicitly NOT requiring delivery/open receipts? [Clarity, Spec §FR-006/§FR-015, Research R5]
- [x] CHK017 - Do the requirements confirm that NO delivery-confirmation or open-tracking
  metadata is collected (which would be extra surveillance surface)? [Completeness, Gap,
  Spec §NFR-ZK-002]
- [x] CHK018 - Is the short-TTL / expire-by-midday behavior tied to the no-overnight goal
  WITHOUT introducing any new per-device delivery state beyond last-announced-version?
  [Consistency, Spec §FR-015, Research R5]

## Coverage, Edge Cases & Measurability

- [x] CHK019 - Are the "no new data beyond X" guarantees expressed as a verifiable success
  criterion (inspectable), not just prose? [Measurability, Spec §SC-006]
- [x] CHK020 - Is the "no timezone reported" case covered such that absence of data simply
  excludes the device (no fallback that infers location)? [Edge Case, Spec §FR-012]
- [x] CHK021 - Are requirements consistent that a user with multiple devices yields only
  per-device coarse data, never a merged cross-device profile? [Consistency, Spec §FR-008]
- [x] CHK022 - Does the spec's Zero-Knowledge Impact section answer all constitution-required
  prompts (what new data is visible, why each is unavoidable, what is NOT collected, boundary
  unchanged)? [Completeness, Constitution Principle I]

## Notes

- All product/crypto-relevant decisions are settled (content-free payload reused from #313;
  offset-not-zone per R2; dedup-on-send + short TTL per R5; broadcast removed per R7).
- This checklist validates requirement QUALITY; the implementation-level zero-knowledge
  behavior is additionally guarded by unit tests (no content in payload, only the listed
  columns) per plan.md Verification.
