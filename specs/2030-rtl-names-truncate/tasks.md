# Tasks: RTL Name Truncation (spec 2030)

- [X] T001 [US1] Failing e2e first: `e2e/rtl-name-truncation.spec.ts` — RTL-named group's `.chat-header-name` and pinned `.pin-name` match `:dir(rtl)`; a Latin-named chat matches `:dir(ltr)`. Confirm FAIL.
- [X] T002 [US1] Add `dir="auto"` to every audited name element (plan §Surfaces); keep text-align; remove same-element redundant `unicode-bidi: plaintext`. T001 green.
- [X] T003 Gates: build + vitest + new e2e + `pinned-grid`; drive screenshot with the reported Persian name (header + tile) for the PR.
