# Zero-Knowledge & Wire/Engagement Checklist: Game Challenges (spec 0009)

**Purpose**: requirements-quality gate (constitution Principle I) for the sealed
challenge signals, the wall engagement surface, and the two justified server
behaviors. Validates what spec/plan/tasks SAY, before implementation.
**Created**: 2026-07-05
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md) | [contracts/](../contracts/)

## Server Blindness

- [x] CHK001 - Does the spec enumerate exactly what crosses each channel (group sender-key signals; wall sealed engagement) and state that all game content is sealed? [Completeness, Spec §Zero-Knowledge Impact]
- [x] CHK002 - Is the group story's zero-server-change claim expressed verifiably (empty group-path server diff)? [Measurability, Spec §FR-007, §SC-004]
- [x] CHK003 - Are BOTH server behavior changes precisely bounded and justified (engagement kind string; content-free audience push for that kind), with the payloads staying opaque? [Completeness, plan §Complexity, contracts/wall-game-engagement.md §Server]
- [x] CHK004 - Is the new server-visible metadata explicitly characterized (kind string = same class as reaction-vs-comment; push fan-out reveals a post has game activity, not what) — no plaintext game data anywhere? [Clarity, Spec §Zero-Knowledge Impact]
- [x] CHK005 - Is Follow specified as never crossing the wire (device-local key, not own-data-synced, invisible to players and server)? [Coverage, Spec §FR-006, research D7]

## Wire/Engagement Contract Quality

- [x] CHK006 - Are all new signals additive with defined old-client behavior, incl. the deliberate NEW kind (`gamechallenge`) so 0008 clients get a fallback instead of a playable garbage-role board? [Edge Case, research D4, contracts/challenge-payload.md §1]
- [x] CHK007 - Are ordering-bearing timestamps (`gameAccept.at`, engagement `at`) explicitly distinguished from 0008's display-only `at`s? [Clarity, contracts/challenge-payload.md §2]
- [x] CHK008 - Is the accept-race resolution fully deterministic and arrival-order-free (min by (at, userId) + seq-1 seat lock), with its in-transit-accept caveat documented? [Measurability, research D2, data-model §Seat]
- [x] CHK009 - Is the cancel/accept race resolved without coordination (cancelledAt AND no moves), converging identically everywhere? [Consistency, research D3]
- [x] CHK010 - Are non-player signals specified as DROPPED (never out-of-sync) so third parties cannot poison a board? [Coverage, research D5, data-model §playerIndexOf]
- [x] CHK011 - Is the wall replay contract deterministic over the pulled set (dedup by engagement id; sort (seq, at, actorId, id)); forks → the 0008 terminal state? [Measurability, research D9]
- [x] CHK012 - Is the known version-skew debris (stray fallback bubble per accept/cancel in mixed groups) documented and accepted rather than silent? [Edge Case, research D4]

## Threat Model & Lifecycle

- [x] CHK013 - Is clock-skew seat gaming acknowledged and contained (wrong friend seated, everyone still converges — 0008's tamper-containment stance)? [Completeness, research D2 caveat]
- [x] CHK014 - Are player-leaves-group semantics derived from shared inputs only (roster card `at` → local synthetic resign), no extra wire signal? [Consistency, research D6]
- [x] CHK015 - Do wall lifetime rules bound the game to the post (expiry/prune/delete), with keep-alive fed by game activity? [Coverage, research D8, contracts/wall-game-engagement.md]
- [x] CHK016 - Do notification requirements keep every new lane beneath the existing mute/content/hidden gates, with players-only defaults and pref keys enumerated? [Coverage, Spec §FR-005/FR-009, research D12]
- [x] CHK017 - Is 1:1 (spec 0008) behavior explicitly preserved (no players field ⇒ direction-derived, regression suite mandated)? [Consistency, research D1, tasks T005]
- [x] CHK018 - Are the validation-critical paths traceably covered by tests ordered before implementation (challenge engine, wall replay, SW gating, server behaviors, 3-account e2e incl. the offline accept race and leave-resign)? [Traceability, tasks T001/T002/T005/T006/T009/T012/T013]

## Notes

- Validation run 2026-07-05 (pre-implementation): all 18 items PASS against
  spec/plan/research/data-model/contracts/tasks as committed. The two server
  behaviors are the ONLY deviations from full server blindness, both justified
  in plan.md's Complexity table and re-verifiable at PR time (T017).
