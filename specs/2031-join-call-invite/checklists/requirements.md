# Specification Quality Checklist: Join-Call Invite Affordance & Redundant Held Call

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-13
**Feature**: [spec.md](../spec.md)

## Content Quality
- [x] No implementation details / focused on user value / non-technical / mandatory sections complete

## Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers (the reporter's requirement statement IS the P1 behavior)
- [x] Testable, measurable, bounded; edge cases (races, group case, failed join) identified

## Feature Readiness
- [x] FRs map to acceptance scenarios; SC-003 is an explicit reporter sign-off; SC-004 pins the regression fence

## Notes
- Hotfix band (2031): behavior defect (redundant held call) + discoverability defect (invite affordance),
  reported together from one real session — kept as one spec because they live in the same flow/screen.
- Pipeline from clarify/plan onward NOT yet run — queued behind specs 1048/1049 (in flight on their branches).
