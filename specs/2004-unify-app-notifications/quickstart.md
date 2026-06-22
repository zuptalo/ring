# Quickstart: verifying spec 2004

## Build / typecheck / unit tests (CI gates)
```sh
npm run build          # vue-tsc --noEmit (typecheck) THEN vite build — must be clean
npx vitest run         # unit tests — incl. the new release-notes prettify strip cases
```
The server side is untouched (no Go change).

## TDD (Principle III)
1. Add failing `prettify` cases to `src/services/release-notes.test.ts` first:
   - `"feat(chat): … (spec 1013 US2/US3)"` → no `(spec …)` in output.
   - `"fix(media): … (+ flaky test fix)"` → no `(+ …)` in output.
   - A subject with no reference → returned unchanged (cleanup never eats real content).
2. Run `npx vitest run` and confirm they FAIL.
3. Implement the `TRAILING_REF` broadening; re-run until green.

## Visual verification (drive/ — the banner/toast rendering)
Not unit-testable in the harness, so verify against the live dev stack:
```sh
make start                                   # dev stack (Vite :5173 → ringd :8080)
HEADED=1 node drive/scenarios/<scenario>.mjs # or a console call to showActionBanner(...)
```
Confirm and screenshot (`.tmp/drive/*.png`):
- The **update prompt** renders as a rounded card **below the header** (matching the
  message/system cards) with **What's new / Update / Later** buttons — never pinned under
  the status bar, never sharp corners (SC-001, US1).
- Dismiss + foreground re-prompt shows a **single** card (replace, not stack) (FR-003).
- An `appToast('…')` renders with the shared rounded styling/position (US3, SC-003).

## Governance verification
- `.specify/memory/constitution.md`: Principle VII states the user-facing release-note
  phrasing rule; version metadata bumped `1.1.0 → 1.2.0` (header + footer) (SC-005).
- `CLAUDE.md`: "Commit messages" carries the release-note-subject guidance + a good/bad
  example.
- `make roadmap` after the spec's `**Status**` changes (never hand-edit ROADMAP.md).
