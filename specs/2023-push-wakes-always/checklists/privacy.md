# Checklist: Zero-Knowledge & Notification Privacy — Requirements Quality

**Purpose**: Validate that spec 2023's requirements bound every privacy-relevant
behavior (quiet-note content, hidden-chat disclosure, wire silence, gate
fail-direction) completely, clearly, and measurably before implementation.
**Created**: 2026-07-09
**Feature**: [spec.md](../spec.md) · Principle-I-adjacent (constitution gate)

## Quiet-Note Content Bounds

- [x] CHK001 - Is the quiet note's information content explicitly bounded as a
      requirement (no sender, no chat identity, no message content) in every
      NEW situation it appears, not just described narratively?
      [Clarity, Spec §FR-003, §Key Entities]
- [x] CHK002 - Is the bound stated relative to an existing reference class
      ("exactly the information the push tickle itself reveals") so it can be
      objectively compared? [Measurability, Spec §Zero-Knowledge Impact]
- [x] CHK003 - Is it explicit that this spec changes WHERE the quiet note
      appears but never WHAT it contains? [Consistency, Spec §Key Entities]

## Hidden-Chat Disclosure

- [x] CHK004 - Is the disclosure delta on silence-unsafe platforms enumerated
      (observer learns: a generic "New message" occurred) AND is what must NOT
      be learnable stated (which chat, from whom, that hidden chats exist at
      all)? [Completeness, Spec §Edge Cases]
- [x] CHK005 - Is the trade explicitly scoped to silence-unsafe platforms
      only, with zero-trace preserved elsewhere? [Consistency, Spec §Edge
      Cases, §FR-003]
- [x] CHK006 - Is the superseded spec-1027 FR-012 zero-trace requirement
      cross-referenced from BOTH sides (2023 → 1027 and 1027 → 2023), the way
      FR-008 already mandates for spec 1034? [Traceability, Gap]
- [x] CHK007 - Is the justification for the trade recorded with its
      alternative ("permanent notification loss") so a future reader cannot
      re-relax it as an oversight? [Completeness, Spec §Edge Cases, §Why]

## Wire & Protocol Silence

- [x] CHK008 - Does a requirement-level statement cover that NOTHING new
      crosses the wire: no server change, no push-payload change, and no new
      page↔SW message types or fields? [Completeness, Spec §Zero-Knowledge
      Impact, Gap — protocol constraint currently lives only in plan.md]
- [x] CHK009 - Is "no new data collection" (telemetry/logging of UA
      classification results) addressed or excluded? [Coverage, Gap]

## Platform-Gate Fail Direction

- [x] CHK010 - Is the safe direction defined for EVERY misclassification mode
      (unknown UA, spoofed UA, future browser, empty string), not just listed
      as examples? [Coverage, Spec §FR-002, §Edge Cases]
- [x] CHK011 - Can "confidently Chromium-engine" be objectively verified from
      the requirements (explicit token allow-list plus explicit iOS-skin
      deny-list)? [Measurability, Spec §FR-002, data-model.md]
- [x] CHK012 - Is the asymmetric cost of each error direction stated (false
      "unsafe" = one extra silent note; false "safe" = permanent subscription
      loss), so reviewers can weigh future gate edits? [Clarity, Spec
      §Clarifications, research.md D2]

## Timing & Exception Flows

- [x] CHK013 - Is the deadline for the post-claim quiet note specified
      (within the same wake, before the push event settles — inside the
      platform's silent-push window)? [Clarity, Spec §FR-003, Gap]
- [x] CHK014 - Are requirements defined for the quiet note itself failing
      (propagation to the guarded fallback) and for the fallback also failing
      (permission revoked — nothing further possible, no path reports
      success)? [Exception Flow, Spec §FR-005, §Edge Cases]
- [x] CHK015 - Is notification-center residue bounded (silent, self-replacing
      tag, cleared by existing foreground cleanup; at most one entry)?
      [Clarity, Spec §Edge Cases, §Assumptions]

## Consistency & Traceability

- [x] CHK016 - Do FR-001's licensed-silence conditions and the wake-outcomes
      contract's master rule express the same policy with no wake kind
      falling outside both? [Consistency, Spec §FR-001,
      contracts/wake-outcomes.md]
- [x] CHK017 - Is the spec-1034 amendment one-directional and explicit (2023
      supersedes 1034 FR-001; 1034 gains a pointer)? [Traceability, Spec
      §FR-001, §FR-008]
- [x] CHK018 - Is the UA-sniffing assumption validated by stating what
      happens when it is wrong (misclassification lands in the safe
      direction)? [Assumption, Spec §Assumptions, §Edge Cases]
