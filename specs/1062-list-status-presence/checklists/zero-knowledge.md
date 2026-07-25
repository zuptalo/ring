# Checklist: Zero-Knowledge & Privacy (spec 1062)

**Purpose**: Validate that the *requirements* for zero-knowledge and privacy are complete, clear, consistent, and measurable — as required by Constitution Principle I. This tests the spec's wording, not the implementation.
**Created**: 2026-07-24
**Feature**: [spec.md](../spec.md)

## Boundary — What Crosses the Wire

- [ ] CHK001 Is the requirement that **no new data crosses the client/server boundary** stated explicitly and unambiguously? [Clarity, Spec §ZK-Impact, §FR-018]
- [ ] CHK002 Is it clearly specified that group presence is composed **client-side from already-received contact-gated presence**, rather than fetched via any new request? [Completeness, Spec §FR-017]
- [ ] CHK003 Are the existing presence frames the feature relies on (`presence-sub`/`presence`) named as the *only* wire mechanism, with a requirement that no new frame type is introduced? [Clarity, Spec §ZK-Impact]
- [ ] CHK004 Is the optional bounded open-group subscription bounded in requirements to the *currently-open* group only, with an explicit prohibition on whole-list group-member subscription? [Consistency, Spec §FR-017]

## Server Knowledge & Metadata

- [ ] CHK005 Is there an explicit requirement that the **server gains no knowledge of group membership**? [Completeness, Spec §FR-018, §ZK-Impact]
- [ ] CHK006 Is the prohibition on **new server endpoint / table / log / metric** stated, not merely implied? [Clarity, Spec §FR-018, §ZK-Impact]
- [ ] CHK007 Is the "no new server-visible metadata" claim tied to a **verifiable** success criterion? [Measurability, Spec §SC-006]
- [ ] CHK008 Does the spec state *why* a true "N of M members online" is deliberately **not** attempted (would require server group knowledge)? [Completeness, Spec §ZK-Impact, §Out-of-Scope]

## Ephemerality & Persistence

- [ ] CHK009 Is the requirement that presence stays **ephemeral (never persisted to IndexedDB, never synced)** stated for this feature's new uses, not just assumed from existing behavior? [Completeness, Spec §FR-019]
- [ ] CHK010 Is the derived group-online view specified as **computed on demand / never stored**, consistent with the ephemerality rule? [Consistency, Spec §Key-Entities, §FR-019]
- [ ] CHK011 Is the denormalized `Chat.lastTick` field's persistence scope clarified (device-local, derivable, not synced) so it isn't mistaken for synced user data? [Clarity, Data-model]

## Contact-Gating & Counting

- [ ] CHK012 Is it unambiguous that a **non-contact co-member is never counted and never dotted**? [Clarity, Spec §FR-011, §FR-022, §FR-025]
- [ ] CHK013 Are the "all contacts" vs "mixed group" labeling rules defined precisely enough to be objectively evaluated? [Measurability, Spec §FR-012, §FR-013]
- [ ] CHK014 Is the zero/unknown case specified to render **nothing** (no "0 online"), consistently across header, row, and tile? [Consistency, Spec §FR-014, §SC-005]
- [ ] CHK015 Is consistency between the header count and the per-member dots required (dots == counted members)? [Consistency, Spec §FR-022, §SC-007]

## Reciprocity & Privacy Settings

- [ ] CHK016 Is honoring **`privacy.seenReceipts`** reciprocity stated for the list/tile "seen" tier (caps at delivered when off)? [Completeness, Spec §FR-004]
- [ ] CHK017 Is honoring **`privacy.online` / `privacy.lastSeen`** reciprocity stated for all new presence surfaces (dots, counts)? [Completeness, Spec §FR-020]
- [ ] CHK018 Are the reciprocity requirements consistent with the existing rule that a user who doesn't share can't see others (no new visibility path)? [Consistency, Spec §FR-020]

## Edge Cases & Ambiguities

- [ ] CHK019 Is the "unknown vs offline" distinction specified so neither contributes to a count nor implies presence the client can't actually see? [Edge Case, Spec §Edge-Cases]
- [ ] CHK020 Is the inbound-only contact-edge case (someone added you but isn't in your contacts) addressed in requirements without creating a new leak? [Coverage, Spec §FR-017]
- [ ] CHK021 Is there any residual wording that could be read as requiring server-side group awareness or a broad new subscription (potential conflict to resolve)? [Conflict, Spec §FR-017 vs §FR-018]

## Notes

- Principle I checklist for spec 1062. Items validate that the ZK/privacy *requirements* are well-written and closed — a prerequisite for `/speckit-implement`.
- CHK021 is the guard against the exact drift that the analyze pass flagged and fixed (FR-017 mechanism reconciled to "compose from existing contact presence"); it should read as resolved.
