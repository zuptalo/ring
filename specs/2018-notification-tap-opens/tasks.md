# Tasks: Notification tap opens the chat (spec 2018, hotfix)

- [ ] T001 Failing regression e2e `e2e/notification-nav.spec.ts`: pending-nav cold start →
      rendered chat content matches URL; back → Chats list (FR-001/003/005)
- [ ] T002 Fix `src/App.vue` routeRelevant cold-start branch: first-paint gate +
      conditional replace + transition settle (FR-001/002/003)
- [ ] T003 Gates: new e2e + sw-persist + sw-decrypt green; npm run build; vitest
- [ ] T004 Real-device verification on ring-dev by the reporter (BLOCKS commit/push)
- [ ] T005 After verification: taskstoissues, commit, push, PR with Closes lines,
      status → in-review, make roadmap

Note: taskstoissues (T005) is deliberately deferred until the reporter verifies the fix
on-device — nothing is committed or pushed before then (explicit request).
