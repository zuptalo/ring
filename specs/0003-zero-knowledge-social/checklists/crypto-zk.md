# Crypto / Zero-Knowledge Checklist: Zero-Knowledge Social Wall

**Purpose**: Validate that the spec/plan's cryptography and zero-knowledge requirements are complete,
clear, consistent, and adversarially scoped — BEFORE implementation. Required by constitution
Principle I (Zero-Knowledge) and Principle IV (Crypto Discipline). This tests the **requirements**, not
the code; each item asks whether something is adequately *specified*.
**Created**: 2026-06-21
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [research.md](../research.md) · [data-model.md](../data-model.md)

## Server-Plaintext Exclusion (Principle I)

- [ ] CHK001 Are the exact data classes that MUST remain unreadable by the server enumerated (post body, media, media keys, reaction emoji, comment text, view list, close-friends membership)? [Completeness, Spec §Zero-Knowledge Impact]
- [ ] CHK002 Is it specified that every new server column/field holding user content is opaque ciphertext or a capability id (no plaintext columns)? [Clarity, Data-model §Server, Spec §FR-014]
- [x] CHK003 Are requirements stated that no log line, metric, error payload, or migration may expose post/engagement plaintext to the server? [Resolved, Spec §NFR-ZK-3]
- [ ] CHK004 Is the post-payload encryption requirement unambiguous about WHAT is sealed (type, text, AND the media-ref/file key inside the sealed payload)? [Clarity, Research §R3/§R4]
- [ ] CHK005 Is it specified that the per-file media key never appears outside the K_post-sealed payload? [Completeness, Research §R4]

## New-Crypto Correctness & Adversarial Robustness (Principle IV)

- [ ] CHK006 Is the per-post content key (K_post) generation requirement specified (fresh, random, per post)? [Completeness, Research §R3]
- [ ] CHK007 Is the per-recipient K_post wrapping requirement specified as reuse of the existing Double Ratchet session (not a new scheme)? [Clarity, Research §R3, Constitution IV]
- [ ] CHK008 Are adversarial cases REQUIRED as acceptance criteria for the new crypto: forgery (non-member key), replay, out-of-order delivery, and skipped-key? [Coverage, Spec §NFR-ZK-2, Constitution IV]
- [ ] CHK009 Is the "only audience members can produce valid engagement ciphertext" property stated as a requirement (engagement sealed under K_post which non-members lack)? [Clarity, Spec §FR-035, Research §R5]
- [ ] CHK010 Are reaction conflict-resolution (last-write-wins per actor) and reaction caps specified as requirements, reusing existing semantics? [Consistency, Spec §FR-032, Research §R5]
- [ ] CHK011 Is comment ordering defined deterministically (timestamp + tiebreak) so independent devices converge? [Clarity, Data-model §PostEngagement]
- [ ] CHK012 Is it required that the new crypto lives in pure, IndexedDB-free helpers (`crypto/post.ts`) with `posts.ts` crypto-only and the `queries.ts → posts.ts` dependency one-directional (no cycle)? [Consistency, Plan §Structure, Constitution IV]

## Audience-Membership Privacy

- [ ] CHK013 Is it required that the server CANNOT distinguish the "all friends" vs "close friends" tier (it sees only a recipient set)? [Clarity, Data-model §ZK invariant 2, Spec §Zero-Knowledge Impact]
- [ ] CHK014 Is the requirement that an engager never learns the audience roster stated and measurable (SC-010)? [Measurability, Spec §SC-010, §FR-035]
- [ ] CHK015 Is it specified that the close-friend flag never crosses the client/server boundary (client-only, rides encrypted own-sync)? [Completeness, Spec §FR-041, Research §R2]
- [ ] CHK016 Is "audience frozen at post time" specified, including the consequence that later friend/close-friend changes affect only future posts? [Consistency, Spec §Edge Cases, Data-model §lifecycle]
- [ ] CHK017 Is the residual disclosure to the audience (co-engagers become visible; author sees viewers) explicitly bounded and distinguished from server disclosure? [Clarity, Spec §Zero-Knowledge Impact]

## Authorization & Access Control

- [ ] CHK018 Is it required that only members of a post's audience (or the author) may submit engagement, with the server enforcing membership? [Coverage, Spec §FR-035, Contracts §engagement]
- [ ] CHK019 Are blocked-user interactions specified across all new paths (no post delivery, no engagement, request suppression)? [Coverage, Spec §FR-036/§FR-005]
- [ ] CHK020 Is the author-only constraint on the view list specified (non-authors cannot read who viewed)? [Clarity, Spec §FR-037, Contracts §views]
- [ ] CHK021 Is author-only post deletion specified, including best-effort tombstone propagation and the no-clawback limitation? [Completeness, Spec §FR-015, §Edge Cases]
- [ ] CHK022 Is the seen-receipts reciprocity for view receipts specified precisely (receipts-off viewer is never listed AND receives no view lists)? [Clarity, Spec §FR-038, Research §R6]

## Metadata Minimization (Principle IX)

- [ ] CHK023 Is the metadata the server unavoidably learns enumerated and justified as the minimum to relay (author, recipient set, coarse size/expiry, that engagement occurred)? [Completeness, Spec §Zero-Knowledge Impact]
- [ ] CHK024 Is it required that new WS frames (`post-new`, `post-engagement`) are content-free nudges that only trigger a sync (no identity/content payload)? [Clarity, Contracts §WS, Constitution I]
- [ ] CHK025 Is coarse expiry (not exact-to-the-second timing) the specified granularity for server-side post lifetime? [Clarity, Data-model §posts, Spec §FR-012]
- [x] CHK026 Are quotas/abuse limits specified without introducing identity-revealing telemetry? [Resolved, Spec §FR-008, §NFR-ZK-3]

## Reuse, Consistency & Testability (Principles III, IV, VI)

- [ ] CHK027 Is it explicitly required that NO new cryptographic primitive or key-exchange/ratchet scheme is introduced (reuse libsodium core + existing patterns only)? [Consistency, Constitution IV, Research §R3]
- [ ] CHK028 Is the requirement to add unit tests for the new crypto (seal/open round-trip + the adversarial set) stated, with TDD ordering (red→green)? [Coverage, Constitution III, Spec §NFR-ZK-2]
- [ ] CHK029 Are server-handler authorization tests (audience/block/author-only) required against the in-memory fake store (no DB)? [Coverage, Constitution VI, Contracts]
- [ ] CHK030 Is the forward-only migration requirement stated (new `0021_posts.sql`, no edits to shipped migrations) with no `SECRETS_KEY` impact? [Consistency, Constitution VI, Plan §Structure]
- [ ] CHK031 Is the IndexedDB change (DB_VERSION bump + forward `onupgradeneeded` preserving data) specified for the new stores and the `closeFriend` field? [Completeness, Constitution V, Data-model §Client]

## Ambiguities & Conflicts to Resolve Before Implementation

- [ ] CHK032 Is there any conflict between "engager never learns roster" (SC-010) and any requirement that would require the client to address the audience directly? [Conflict, Spec §SC-010 vs §FR-013]
- [ ] CHK033 Is the meaning of "friend" defined consistently as an accepted connection (reusing `connections`), avoiding a second competing relationship model? [Consistency, Research §R1]
- [ ] CHK034 Is the security-review requirement (Principle IV) explicitly called out as a gate before `/speckit-implement`? [Traceability, Constitution IV, Spec §NFR-ZK-2]
- [ ] CHK035 Are the post-engagement tombstone semantics (who may delete what, and that delivered copies cannot be cryptographically recalled) unambiguous? [Ambiguity, Spec §FR-034, §Edge Cases]

## Notes

- Items are requirement-quality questions ("is X specified?"), not implementation tests. Resolve any
  unchecked item by amending spec/plan/research before `/speckit-tasks` → `/speckit-implement`.
- This checklist, plus a maintainer security review of the eventual crypto diff, satisfies the
  constitution's Principle I & IV gate for this spec.
