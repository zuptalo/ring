# Crypto / Zero-Knowledge Checklist: Message and Post Audience Insight

**Purpose**: Validate that the spec/plan's cryptography and zero-knowledge requirements are complete,
clear, consistent, and adversarially scoped — BEFORE implementation. Required by constitution
Principle I (Zero-Knowledge) and Principle IV (Crypto Discipline). This tests the **requirements**, not
the code; each item asks whether something is adequately *specified*.
**Created**: 2026-07-30
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [research.md](../research.md) · [data-model.md](../data-model.md) · [contracts](../contracts/engagement-and-views.md)

## Server-Plaintext Exclusion (Principle I)

- [x] CHK001 Are the data classes that MUST remain unreadable by the server enumerated for this feature (comment text, reply text, reaction emoji, parent reference)? [Completeness, Plan §Zero-Knowledge Impact]
- [x] CHK002 Is it specified that no new server column holding user content is added, and that the parent reference rides inside the existing opaque payload? [Clarity, Data-model §2, Contracts §3]
- [x] CHK003 Is the reuse of the existing per-post key and domain separator specified, rather than new key material or a new exchange? [Clarity, Plan §Constitution IV, Research §R7]
- [x] CHK004 Is it required that the cleartext `notify` hint never reaches server-side logs, metrics, or error payloads? [Gap → Resolved, Spec §FR-031b, Contracts §2]
- [x] CHK005 Is it specified that the wake hint is not persisted on the engagement row? [Completeness, Contracts §2, Data-model §2]

## The Named Exception: scope, bounds, and honesty (Principle I / IX)

- [x] CHK006 Is the single cleartext addition named explicitly, with the reason it cannot be sealed? [Clarity, Spec §FR-031b, Plan §Complexity Tracking]
- [x] CHK007 Are the bounds on the exception stated as requirements rather than intentions (audience validation, a numeric cap, actor stripping, no persistence)? [Measurability, Contracts §2]
- [x] CHK008 Is the rejected alternative documented with its own cost, so the tradeoff is auditable later? [Traceability, Spec §Clarifications, Plan §Complexity Tracking]
- [x] CHK009 **Does the spec acknowledge that the presence of a wake hint naming someone other than the post author reveals that a comment IS a reply?** [Conflict → Resolved, Spec §FR-031c]
- [x] CHK010 Is the derived leak of approximate per-person reply volume acknowledged (the server can count replies addressed to a given person on a given post)? [Gap → Resolved, Spec §FR-031c]
- [x] CHK011 Is it specified that the hint cannot be used to wake someone outside the post's audience? [Coverage, Contracts §2]
- [x] CHK012 Are existing rate limits identified as the control that stops the hint becoming a nuisance-wake primitive? [Dependency, Research §R8]

## Indistinguishability & side channels

- [x] CHK013 Is it required that no new `kind` value is introduced, so a reply and a comment are the same row type to the server? [Clarity, Research §R7, Contracts §3]
- [x] CHK014 Is the ciphertext-length side channel on reactions identified, and is constant-length padding required as the mitigation? [Completeness, Research §R7, Contracts §3]
- [x] CHK015 **Is the padded length specified as a concrete constant, and is the behaviour defined when a payload would exceed it?** [Gap → Resolved, Spec §FR-031d, Data-model §3]
- [x] CHK016 Is it stated that padding the plaintext to a constant yields a constant ciphertext length under the AEAD in use? [Clarity, Data-model §3]
- [x] CHK017 Is it specified that padding applies to **every** reaction, including post-level ones, so the two cannot be told apart? [Consistency, Contracts §3]
- [x] CHK018 Is the decision NOT to pad comment bodies justified (their length already varies by orders of magnitude)? [Clarity, Research §R7]
- [x] CHK019 Is it required that the emoji-bearing local row id never leaves the device? [Completeness, Research §R7, Data-model §1]
- [x] CHK020 Is the local id scheme for comment reactions specified so it cannot collide with a post reaction by the same person? [Clarity, Data-model §1]
- [x] CHK021 **Is it required that deleting a comment does NOT emit a cleartext tombstone per comment reaction, which would publish the reaction-to-comment mapping?** [Conflict → Resolved, Spec §FR-029c]

## Sealed parent reference correctness

- [x] CHK022 Is the one-level nesting invariant specified as a storage rule (a parent always points at a top-level comment) rather than a render-time behaviour? [Clarity, Data-model §1, Spec §FR-025]
- [x] CHK023 Are requirements defined for a reply whose parent is not yet present locally (held and attached, never orphaned, never dropped)? [Coverage, Spec §FR-028]
- [x] CHK024 Is behaviour specified for a reply whose parent the viewer cannot decrypt? [Edge Case, Spec §Edge Cases]
- [x] CHK025 Is it specified that a parent reference is meaningless to anyone outside the audience, since it names an id only resolvable with the post key? [Clarity, Research §R7]
- [x] CHK026 Are deterministic ordering rules specified for replies so independent devices converge on the same thread order? [Consistency, Spec §FR-005, §FR-025]

## Author-only enforcement

- [x] CHK027 Is author-only access to the viewer list required to be enforced server-side rather than hidden in the client? [Clarity, Spec §FR-033, Research §R11]
- [x] CHK028 Is the distinction between the strict author check and the looser audience check made explicit, so a future refactor cannot silently widen it? [Clarity, Research §R11, Contracts §4]
- [x] CHK029 Is it specified that the view **count** carries the same author-only restriction as the list, on every surface? [Coverage, Spec §FR-012]
- [x] CHK030 Is reaction attribution's visibility rule stated precisely, including the deliberate comment-author exception? [Consistency, Spec §FR-018, §FR-022a]
- [x] CHK031 Is it required that reaction attribution be enforced where the data is served, not only where it is rendered? [Gap → Resolved, Spec §FR-033a]
- [x] CHK032 Is the reciprocity gate on view reporting specified, including that it is client-enforced on both sides and unknown to the server? [Clarity, Spec §FR-015, Research §R11]

## Metadata delta from feed-based view reporting

- [x] CHK033 **Is it acknowledged that counting feed impressions widens what the server learns from "posts deliberately opened" to "posts scrolled past"?** [Gap → Resolved, Spec §FR-014a]
- [x] CHK034 Is it specified that a post is reported at most once per person for all time, bounding both the traffic and the metadata? [Measurability, Spec §FR-017a]
- [x] CHK035 Is it required that the author never appears in their own viewer list or count? [Completeness, Spec §FR-017b]
- [x] CHK036 Are requirements defined for a view observed while offline, including which moment is recorded? [Coverage, Spec §Edge Cases]

## Service-worker decryption inside a guarded wake

- [x] CHK037 Is the new requirement to decrypt comment payloads in the service worker stated, along with why it is now necessary? [Completeness, Research §R12]
- [x] CHK038 Is behaviour specified when the post key is unavailable in the worker, so a wake still ends visibly rather than failing? [Edge Case, Research §R12, §R9]
- [x] CHK039 Is the "every wake ends visibly" invariant identified as a hard constraint that bounds the notification design? [Dependency, Research §R9, Plan §Constraints]
- [x] CHK040 Is the added decryption cost bounded against the existing wake deadline? [Measurability, Research §R12, Spec §FR-035]
- [x] CHK041 Is it required that a decryption failure results in silence-or-generic rather than a wrong or leaky notification? [Coverage, Research §R12]

## Adversarial cases (Principle IV)

- [x] CHK042 Are forgery expectations stated: a non-audience member cannot produce a readable reply, comment reaction, or parent reference? [Coverage, Plan §Constitution IV]
- [x] CHK043 Is replay behaviour specified for engagement, given that reaction state is last-write-wins on a sealed timestamp? [Consistency, Research §R6]
- [x] CHK044 Are out-of-order and partial-page arrivals specified as safe, given paged fetching? [Coverage, Research §R6, Contracts §1]
- [x] CHK045 Is it specified that a malicious client cannot use the wake hint to probe whether a stranger is in a post's audience? [Gap → Resolved, Contracts §2]
- [x] CHK046 Are display-time clock clamps specified as display-only, leaving stored values untouched? [Clarity, Data-model §4]

## Measurability & traceability

- [x] CHK047 Is there an objectively checkable success criterion that inspects stored server data for leaked content? [Measurability, Spec §SC-007, Quickstart §ZK check]
- [x] CHK048 Is the uniform-reaction-payload-length property stated in a way that can be checked with a single query? [Measurability, Quickstart §ZK check]
- [x] CHK049 Does every accepted deviation appear in the plan's Complexity Tracking with a rejected alternative? [Traceability, Plan §Complexity Tracking]
- [x] CHK050 Are the ZK-relevant requirements individually identified so implementation tasks can cite them? [Traceability, Spec §FR-030 … §FR-033a]

## Findings from the first pass, and how they were resolved

The checklist was run against the spec, plan, research, data-model, and
contracts as they stood after `/speckit-plan`. Five items failed. All five are
now resolved in the artifacts, and the boxes above reflect the post-fix state.

**F1 (CHK009, CHK010) — the plan contradicted itself.** The Zero-Knowledge
Impact table claimed the server still could not tell a reply from a plain
comment. That was wrong the moment the wake hint was accepted: a top-level
comment names only the post author, while a reply names someone else, so the
hint's contents distinguish the two. The server can further count replies
addressed to a given person on a given post, which is per-person reply volume.
Sealing the parent still hides *which* comment was answered and the size of any
individual thread. Fixed by adding **FR-031c**, which states the derived
disclosures plainly, and by correcting the plan's table rather than leaving a
comfortable but false claim in it.

**F2 (CHK021) — comment deletion would have leaked the reaction graph.**
FR-029 requires that deleting a comment removes its reactions. The existing
deletion mechanism is a tombstone carrying a **cleartext** target id. Emitting
one tombstone per comment reaction would have published exactly the
reaction-to-comment mapping the sealed parent exists to hide, and would have
done so at comment granularity, which is worse than the accepted exception.
Fixed by adding **FR-029c**: deleting a comment emits the single existing
tombstone for the comment itself, and each device drops that comment's
reactions locally by reading their sealed parent. No new tombstones.

**F3 (CHK015) — padding was asserted but never specified.** "Padded to a
constant length" is not implementable without the constant and without a rule
for what happens when the plaintext would exceed it (a long grapheme-cluster
emoji plus a parent id is not hypothetical). Fixed by **FR-031d**: a single
named constant applied to every reaction, a bounded emoji length so the budget
cannot be exceeded by legitimate input, and a defined refusal rather than a
silent truncation or an over-long payload if it ever were.

**F4 (CHK033) — a metadata widening went unacknowledged.** Counting feed
impressions means the server records a row for every post a person scrolls
past, not only the ones they deliberately open. That is a genuine broadening of
what the view table reveals about browsing, and it is a direct consequence of
FR-014. It is defensible and bounded, but it was not written down. Fixed by
**FR-014a**.

**F5 (CHK031) — attribution was specified as a UI rule only.** FR-018 and
FR-022a described who may *see* attribution without saying where that is
enforced. Since the underlying engagement rows are already readable by the whole
audience, this one genuinely cannot be enforced server-side, and pretending
otherwise would be worse than stating the limit. Fixed by **FR-033a**, which
records that reaction attribution is a client-side presentation rule over data
the audience already holds, in deliberate contrast to the viewer list, which is
enforced by the server.

**Not a finding, recorded for the reviewer**: CHK004's requirement that the wake
hint never be logged is new wording, but the underlying obligation already
follows from Principle I. It is stated explicitly because a recipient list is
exactly the kind of field that ends up in a request log by accident.
