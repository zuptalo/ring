# Tasks: Show-first notifications (spec 2048)

**Spec**: [spec.md](./spec.md) · Branch `fix/2048-notifications-not-appear` · Closes https://github.com/zuptalo/ring/issues/1049

- [X] T001 Pure `shouldShowPlaceholderFirst` gate in `src/services/sw-inbox.ts` + unit tests in `src/services/sw-quiet.test.ts`
- [X] T002 `dispatchPush` msg path (`src/sw.ts`): gate the pageWillNotify claim-wait on `anyClientVisible` (not `clients.length`); when not foreground-visible, nudge clients (no await) + `showGeneric('show-first')` immediately, set ctx; then drain/preview upgrade
- [X] T003 `showMessageNotification(ctx, placeholderShown)`: seed `shownGeneric=placeholderShown`; clear after rich upgrade; skip duplicate `showGeneric` in the timeout branch when placeholder up
- [X] T004 Verified server AllowPush already suppresses muted/off pushes (mentions pierce); loud→quiet same-tag downgrade covers the stale-prefs race — no server change
- [X] T005 Gates: `npm run build`, full vitest (1194) green
- [ ] T006 Device verify: LOCKED-state burst on iPhone 15 Pro / iPad shows a notification per wake; no `410 Unregistered` prune follows (SC-002)
