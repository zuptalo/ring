# Zero-Knowledge & Notification-Privacy Checklist: Wall notifications go to the owner only

**Purpose**: Requirements-quality gate (constitution Principle I) — validate that the spec/plan keep the server blind to content, narrow rather than widen metadata exposure, and pin owner-only alerting semantics across page, service worker, and server fan-out. This tests the *requirements as written*, not the implementation.
**Created**: 2026-07-03
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [contracts/push-and-handlers.md](../contracts/push-and-handlers.md)
**Depth**: formal gate (required for Principle I specs) · **Audience**: PR reviewer / security review

## Server Blindness (content)

- [x] CHK001 - Does the spec state explicitly what crosses the wire and that no new plaintext is introduced? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK002 - Is the reaction add/remove flag identified as sealed, with the show/skip decision explicitly assigned to the recipient's device? [Clarity, Spec §FR-009, §Zero-Knowledge Impact]
- [x] CHK003 - Are the push payload contents enumerated (`t`, post id only) and bounded so no content or actor identity rides the push channel? [Completeness, Contract §Push layer]
- [x] CHK004 - Is it documented that Web Push payloads are encrypted per subscription, so even the new `post-activity` marker is invisible to the push service? [Clarity, Spec §Zero-Knowledge Impact, research.md D2]
- [x] CHK005 - Do the requirements forbid any server-side distinction of reaction add vs remove (including "helpful" cleartext hints), with the rejected alternative recorded? [Consistency, research.md D3]

## Metadata Exposure (narrowing, not widening)

- [x] CHK006 - Is every metadata element used for routing (post id, author, actor, unsealed kind) identified as ALREADY server-held, with an explicit "adds nothing new" statement? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK007 - Is the fan-out change quantified as a reduction (N audience members → 1 owner per engagement)? [Measurability, Spec §SC-002]
- [x] CHK008 - Does the plan address push-service-visible traffic patterns (per-post collapse topic derived via hash, not the raw post id)? [Coverage, plan.md §Server, Contract §Push layer]
- [x] CHK009 - Is the post id in the push payload justified (which decision it enables on-device) rather than assumed? [Traceability, research.md D2]

## Owner-Only Semantics (consistency across the three surfaces)

- [x] CHK010 - Are the alerting rules stated identically for all three surfaces (server push target, page banner gate, SW notification gate), each with its own ownership check? [Consistency, Contract §§POST/SW/Page]
- [x] CHK011 - Is the sync-vs-alert distinction explicit — WS reconciliation stays audience-wide while alerting narrows to the owner — so content visibility can never regress? [Clarity, Spec §FR-005, Contract §POST side effects]
- [x] CHK012 - Are self-action exclusions specified at every layer (server skips actor==author push; predicate skips actor==self), not just as a user-visible outcome? [Coverage, Spec §FR-004, Contract]
- [x] CHK013 - Is the defense-in-depth ownership re-check on the device (`outgoing === true`) required, so a misrouted or forged push cannot alert a non-owner? [Edge Case, plan.md §Service worker, Contract §SW]
- [x] CHK014 - Are tombstones, comment deletions, and view receipts each explicitly excluded from alerting? [Completeness, Spec §FR-011, Contract §POST side effects]

## Failure & Degraded Modes

- [x] CHK015 - Is behavior specified when the SW cannot decrypt a reaction payload (skip silently — never a spurious alert), including the rationale for that trade-off? [Edge Case, research.md D3, Contract §SW]
- [x] CHK016 - Is behavior specified when `PostAuthor` lookup fails (engagement write succeeds, push skipped, WS unaffected)? [Exception Flow, Contract §POST side effects]
- [x] CHK017 - Are reconnect/backlog floods bounded by explicit freshness windows and dedupe ledgers on both page and SW paths? [Coverage, Spec §Edge Cases, research.md D7]
- [x] CHK018 - Is the stale/deleted-post case addressed (notification for a post that no longer exists locally must be dropped)? [Edge Case, Spec §Edge Cases]

## Settings & Scope Boundaries

- [x] CHK019 - Is the new `notifications.wall.activity` toggle's scope (comments + reactions, both surfaces, default on) unambiguous and distinct from `notifications.wall.show`? [Clarity, Spec §FR-007, Clarifications]
- [x] CHK020 - Is the per-person mute/hide boundary (posts-only, does NOT gate engagement on own posts) recorded as a deliberate clarified decision rather than an omission? [Consistency, Spec §Clarifications, research.md D5]
- [x] CHK021 - Are the non-existent interactions (comment replies/reactions, shares, mentions) explicitly out of scope with a governing ownership rule for the future, so no requirement silently implies building them? [Scope, Spec §FR-006, §Assumptions]

## Notes

- All items pass on the 2026-07-03 revision of spec/plan/contracts. CHK008's hash-topic
  requirement and CHK013's device-side re-check originated during planning and are now
  pinned in plan.md + the contract, so implementation drift on either would be a
  reviewable spec violation, not a silent choice.
