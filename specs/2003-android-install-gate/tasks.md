# Tasks: Fix Android install-gate false "browser can't install" warning

**Feature**: spec 2003 (hotfix) | **Branch**: `fix/2003-android-install-gate`
**Spec**: [spec.md](./spec.md)

Per Constitution Principle III, a bug fix begins with a FAILING regression test that
reproduces the defect. The fix is a small, client-side detection change with no
server/ZK impact.

## Tasks

- [ ] T001 [P] Write FAILING unit test for a pure `isAndroidWebView(ua: string)` helper in `src/composables/useInstallGuard.test.ts`: an Android **WebView** UA (`; wv)` and/or `Version/x.x … Chrome/…`) → `true`; Chrome, Samsung Internet, Firefox, Edge on Android → `false`; desktop/iOS UAs → `false`. (FR-006, SC-004)
- [ ] T002 Implement the pure `isAndroidWebView(ua)` in `src/composables/useInstallGuard.ts`, and base `installUnavailable` on it (Android && WebView) — **removing** the 2.5s `beforeinstallprompt`-timeout heuristic. Keep `canPrompt`/`beforeinstallprompt` wiring intact for the one-tap button. Makes T001 pass. (FR-001/002/003/004)
- [ ] T003 Update the warning in `src/components/InstallGuard.vue` so the (now WebView-only) callout gives accurate guidance — "open Ring in your browser app (e.g. Chrome) and install from there" — and drop the "update Chrome / open in a newer browser" remedy. (FR-005)
- [ ] T004 Gates: `npm run build` (vue-tsc + vite) and `npx vitest run src/composables/useInstallGuard.test.ts`. Confirm no regression: the one-tap button still shows when `beforeinstallprompt` fires; desktop/iOS branches unchanged. (SC-001/002/003)
- [ ] T005 Bump spec `Status:` → in-review and run `make roadmap`.

## Notes / right-sizing
Small hotfix: a single tracking issue (not one-per-task) is created and the PR `Closes` it;
no `clarify` (unambiguous) and no full per-task issue fan-out. ZK impact: none.
