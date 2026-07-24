# Specification Quality Checklist: Make pasted and sent media interoperable

**Purpose**: Validate specification completeness and quality before planning
**Created**: 2026-07-24
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details leak into requirements (the audit's file/line specifics stay in Context/Assumptions, requirements stay behavioral)
- [x] Focused on user value (media that actually arrives viewable) and honest failure
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed (incl. Zero-Knowledge Impact — Principle I)

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain (scope set by the audit + the user's "full interop pass" choice)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases identified (Original-quality escape hatch, oversized, transcoder-unavailable, animation, already-portable)
- [x] Scope is clearly bounded (Out of Scope lists no server validation, no attach-filtering, no audio interop)
- [x] Dependencies and assumptions identified (client-side ffmpeg/HEIC decoder; portable = MP4/H.264 + JPEG/PNG/WebP/GIF)

## Feature Readiness

- [x] Each functional requirement has clear acceptance criteria
- [x] User scenarios cover the four format gaps, prioritized (WebM P1 → HEIC P2 → PNG-alpha P3 → SVG P4)
- [x] Measurable outcomes defined (SC-001..007) including a no-regression criterion for working formats
- [x] No implementation details leak into requirements

## Notes

- This is a bug fix (2001+): per Constitution III, implementation MUST begin with a **failing regression test** — the natural first test is the pure "is this container/format portable / does it require mandatory conversion?" decision (WebM → must-transcode even at Original quality), before wiring the transcode routing.
- Principle I applies (media crosses the wire as ciphertext): `/speckit-checklist` is **required** before implement; the Zero-Knowledge Impact section is included.
- The unifying invariant FR-014 ("interoperable send or visible failure — never a silent broken send") is the acceptance backbone; each format story is one instance of it.
