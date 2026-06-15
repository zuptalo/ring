# Tasks: Show what changed in the update toast (release-note delta)

**Spec**: [`spec.md`](spec.md) · **Plan**: [`plan.md`](plan.md) · **Branch**: `feat/0001-show-what-changed`

TDD: within each group the failing test (Tn.a) precedes the implementation (Tn.b). Groups roughly
map to one GitHub issue each.

## T1 — Pure client core: delta + prettify (FR-001, FR-003, FR-005, FR-008)

- **T1.a** Write `src/services/release-notes.test.ts` (red): `computeDelta` (incoming−running by
  sha; subset/superset/disjoint/empty/running-empty → empty signal); `prettify`
  (`fix(sync): x`→"X", `feat!: y`, plain subject passthrough).
- **T1.b** Add `src/services/release-notes.ts` (`ReleaseNote`, `computeDelta`, `prettify`).
  Make T1.a green.

## T2 — What's-new sheet + toast wiring (FR-001, FR-005, FR-006)

- **T2.b** Add `src/components/WhatsNewSheet.vue` (IonModal listing the prettified delta, scrollable,
  with an Update action). `useAppUpdate.ts`: fetch `/v1/config` notes, compute delta vs
  `__RELEASE_NOTES__`; on a non-empty delta show a toast with a "What's new (N)" button that presents
  the sheet, else the generic toast (unchanged). Add `__RELEASE_NOTES__` to `src/env.d.ts` globals;
  `api.ts`: add `notes?: ReleaseNote[]` to `fetchServerConfig`.
- **T2.c** `npm run build` (typecheck) green; `npm run test:unit` green.

## T3 — Server exposes its build's notes (FR-004, FR-007)

- **T3.a** `server/internal/api/config_handler_test.go` (red): `/v1/config` includes `notes` when
  `Handlers.ReleaseNotes` is set, empty array when not.
- **T3.b** `main.go`: `var releaseNotesB64`; decode at boot → `Handlers.ReleaseNotes`.
  `config_handler.go`: add `"notes"`. Make T3.a green; `go build/vet/test ./...`.

## T4 — Build-time notes generation (FR-002, FR-007)

- **T4.b** Add `scripts/release-notes.sh` (git log since last tag, `--no-merges`, JSON sha+subject).
  `Dockerfile`: `ARG RELEASE_NOTES`; client `RING_RELEASE_NOTES`; server `-X main.releaseNotesB64`
  (base64). `vite.config.ts`: `__RELEASE_NOTES__` define. `ci.yml` + `release.yml`: compute notes
  and pass `--build-arg RELEASE_NOTES`. Optionally refactor release.yml's notes step onto the script.
- **T4.c** Run `scripts/release-notes.sh` locally; confirm valid JSON and merge-commit exclusion.

## T5 — Coverage + gates (SC-004, SC-005)

- **T5.a** Add `release-notes.ts` to the gated coverage set (≥ 90%); confirm no floor regresses.
- **T5.b** Full gate: `npm run build`, `npm run test:unit:coverage`, `go build/vet/test ./...`.

## T6 — Finalize

- **T6.a** Set spec `Status` → `in-review`; `make roadmap`; `roadmap-gen.py --check` green.
- **T6.b** PR body lists `Closes #N` per issue.
