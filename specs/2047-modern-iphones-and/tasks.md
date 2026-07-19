# Tasks: Modern iPhones/iPads actually display push notifications

**Spec**: [spec.md](./spec.md) · Branch `fix/2047-modern-iphones-and` · Closes #1046

- [X] T001 Pure `richNoteOptions` helper (no `renotify`) in `src/services/sw-inbox.ts` + failing-first test `src/services/sw-notify-options.test.ts`
- [X] T002 `showNotes` (`src/sw.ts`) uses `richNoteOptions` — drops `renotify:true`
- [X] T003 `showConnNotes` (`src/sw.ts`) drops `renotify:true`
- [X] T004 Page bridge `notifyLocal` (`src/services/push.ts`) drops `renotify:true`
- [X] T005 Gates: `npm run build`, full vitest (1190) green
- [ ] T006 Device verify: backgrounded message on iPad + iPhone 15 Pro shows a lock-screen notification (SC-001)
