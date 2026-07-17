# Analyze Report: spec ↔ plan ↔ tasks ↔ constitution

**Spec**: 0001-show-what-changed · **Run**: pre-implementation consistency check

## Coverage (every FR maps to a task)

| Requirement | Plan | Task(s) | Status |
|-------------|------|---------|--------|
| FR-001 toast shows per-user delta | §4 | T1, T2 | ✅ |
| FR-002 auto notes from CC subjects, no merges | §1 | T4 | ✅ |
| FR-003 stable SHA identity | §1, §4 | T1, T4 | ✅ |
| FR-004 incoming via /v1/config; running baked in | §2, §3, §4 | T2, T3, T4 | ✅ |
| FR-005 delta = incoming−running; graceful fallback | §4 | T1, T2 | ✅ |
| FR-006 cap + "+N more" | §4 | T1, T2 | ✅ |
| FR-007 same path for develop + release images | §2 | T3, T4 | ✅ |
| FR-008 pure, unit-tested core | §4 | T1, T3 | ✅ |
| SC-001..005 | test strategy | T1–T5 | ✅ |

No orphan requirements or tasks.

## Constitution check

- **I. Zero-Knowledge** — notes are public app metadata (same class as `version` already on
  `/v1/config`); spec has the mandatory Zero-Knowledge Impact section; no boundary change. ✅
- **III. TDD** — tasks order failing tests before implementation (T1.a/T3.a). ✅
- **V. Offline-first** — no object-store/`DB_VERSION` change. ✅
- **VII. Quality gates / update UX** — the PWA stays `registerType: 'prompt'`; only the toast's
  message content changes; T5.b runs the exact CI gate; coverage ratchets up. ✅
- **VIII. Traceable delivery** — task groups → issues; T6.b lists `Closes #N`. ✅

## Findings

- No contradictions across artifacts.
- Two judgement calls recorded in plan §research: prettify in the client (testable) rather than in
  bash; base64-encode notes into the server binary (robust ldflags transport). Both accepted.
- Minor follow-up noted (not in scope): a richer "what's new" sheet instead of a plain-text toast.

**Verdict: clean — ready to implement (pending review-gate sign-off).**
