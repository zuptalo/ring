# Checklist: Zero-Knowledge & Wire-Surface Requirements Quality (spec 1050)

**Purpose**: Constitution-mandated gate (Principles I & IX) — validate that the routing-model requirements are complete, unambiguous, and honest about every leak BEFORE implementation.
**Created**: 2026-07-14
**Feature**: [spec.md](../spec.md)

## Wire-Surface Completeness

- [x] CHK001 — Is every NEW plaintext field crossing the wire enumerated in one place (class, prid, subscription preference lists), with nothing implied elsewhere in the spec that isn't listed there? [Completeness, Spec §ZK Impact]
- [x] CHK002 — Is the complete class vocabulary closed and enumerated (7 values), with the default for absent/old-client frames specified? [Completeness, Spec §Routing Model, §FR-001]
- [x] CHK003 — Are the subscription preference lists fully enumerated (opted-out classes, muted prids, per-sender post overrides) with no open-ended "etc."? [Completeness, Spec §Routing Model pt.3]
- [x] CHK004 — Is the push-decision rule specified as a single deterministic order of evaluation (housekeeping → mention → class/prid gating), leaving no frame with undefined push behavior? [Completeness, Spec §Routing Model]
- [x] CHK005 — Is the calls path explicitly fenced out (never filtered) rather than silently omitted? [Completeness, Spec §Routing Model pt.2]

## Leak Honesty & Minimization (Principles I & IX)

- [x] CHK006 — Does the ZK Impact section state what the server learns from the class tag in adversarial terms (including that `mention` reveals "personally addresses recipient"), not just what it doesn't learn? [Clarity, Spec §ZK Impact]
- [x] CHK007 — Is the prid's conversation-clustering leak named as the largest relaxation, compared against the pre-existing statistical inference baseline, and explicitly marked as user-approved-for-veto? [Clarity, Spec §ZK Impact]
- [x] CHK008 — Is it specified that the prid is random and carries no derivable link to group name, membership roster, or content? [Clarity, Spec §Routing Model pt.2]
- [x] CHK009 — Is each preference list's leak stated per list (muted conversations by pseudonym, class posture, followed/muted post senders)? [Completeness, Spec §ZK Impact]
- [x] CHK010 — Does the spec justify WHY each leak is necessary (iOS visible-wake + blind server), satisfying the constitution's "why a simpler ZK-preserving option won't do"? [Traceability, Spec §Why this exists, §ZK Impact]
- [x] CHK011 — Is data minimization addressed for the preference lists' lifecycle — when muted prids/overrides are DELETED server-side (mute expiry, chat deletion, account deletion, subscription pruning)? [Gap → resolved: FR-011 added]

## Hidden-Chat Exclusion

- [x] CHK012 — Is the hidden-chat exclusion stated as a structural MUST (never present in any preference payload) rather than a rendering behavior? [Clarity, Spec §FR-008c]
- [x] CHK013 — Does the spec define what happens to a conversation's EXISTING prid mute when that chat becomes hidden (registration must be withdrawn without signalling why)? [Gap → resolved: edge case added]
- [x] CHK014 — Is the accepted cost of the exclusion (hidden chats keep generic ghosts) documented so it can't be re-reported as a bug? [Completeness, Spec §Routing Model]

## Sender-Controlled Tag Abuse

- [x] CHK015 — Are the abuse consequences of a hostile sender mis-tagging DOWNWARD (real message marked housekeeping) bounded and stated (equivalent to not sending; delivery unaffected)? [Coverage, Spec §Edge Cases]
- [x] CHK016 — Are the consequences of mis-tagging UPWARD (spam marked `mention` to pierce mutes) addressed — does any requirement bound mention-class abuse from muted/blocked senders? [Gap → resolved: edge case + FR-012 added]
- [x] CHK017 — Is it specified that blocking is evaluated before any push regardless of class? [Consistency, Spec §FR-007/FR-001 "blocking identical"]

## Interop & Migration

- [x] CHK018 — Are BOTH interop directions specified (old client → new server, new client → old server) with no version gate? [Completeness, Spec §FR-006]
- [x] CHK019 — Is the tag-less frame's class default (= message) consistent everywhere it's mentioned? [Consistency, Spec §Routing Model, §FR-001]
- [x] CHK020 — Is prid bootstrap for PRE-EXISTING conversations specified (who mints, how members converge on one id, what happens before convergence)? [Gap → resolved: assumption expanded]

## Consistency With Prior Specs

- [x] CHK021 — Does server-side mention-piercing exactly mirror the on-device escalation semantics (specs 1020/1048), with the notifyMentions=false residual ghost documented rather than contradicted? [Consistency, Spec §FR-008b]
- [x] CHK022 — Do the held-frame delivery requirements preserve spec-1048's push-health invariant (no new silent wakes; fewer wakes only)? [Consistency, Spec §Edge Cases push-health]
- [x] CHK023 — Is the coarseness mismatch between per-surface toggles and classes documented with its exact residual ghost configuration? [Clarity, Spec §FR-008, §Edge Cases]

## Measurability

- [x] CHK024 — Does every push-suppression claim have a server-unit-assertable criterion ("no notify call") rather than only device observation? [Measurability, Spec §SC-005/007/009/010]
- [x] CHK025 — Is the hidden-chat structural exclusion given an automated guard criterion (SC-011) in the spec-1019 test style? [Measurability, Spec §SC-011]
