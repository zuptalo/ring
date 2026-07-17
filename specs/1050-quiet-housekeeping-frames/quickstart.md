# Quickstart: verifying push routing (spec 1050)

## Automated

```sh
cd server && go test ./internal/ws/ ./internal/push/ ./internal/api/ ./internal/store/   # gate matrix, prefs CRUD, presence-gated conn
npx vitest run src/services/push-prefs.test.ts src/db/frame-class.test.ts               # derivation + class tables (pure)
npx vitest run                                                                           # full suites incl. SC-011 hidden guard
npm run build && npx playwright test e2e/push-routing.spec.ts e2e/notifications-inapp.spec.ts e2e/mentions.spec.ts e2e/reaction-notify.spec.ts
```

e2e asserts effects visible to headless clients: co-reactor gets the rich "also reacted"
banner; bystander gets NO banner and the reaction still lands; group create silent + first
message notifies; muted-group mention still banners; collapsed banner swipe-up dismisses.

## Live (drive/ against `make start`)

Three users; mute a group via `__ringTest.muteChat`; exercise the fan-out matrix; screenshot
banners. Prefs round-trip: `PUT /v1/push/prefs` observable via the dev endpoint / psql
(`select prefs from push_subscriptions`).

## Real-device manual gate (the halves CI cannot see)

1. **Removal invisibility (SC-001)**: peer app closed → remove a reaction ×10 → zero
   notification-center entries; reopen → state converged.
2. **Toggle-driven push absence (SC-007)**: both reaction toggles off → reactions to your
   message while closed → nothing; frames arrive on open.
3. **Muted group truly quiet (SC-009)**: muted group chatter while closed → nothing; an
   @mention in it → one rich notification.
4. **Group create (SC-003)**: creation → nothing on members' phones; first message → normal
   group notification.
5. **Accept flow (SC-004)**: request accepted while you're in the app → banner only;
   while closed → "«name» accepted your invitation".
6. **Per-friend post alert (SC-010)**: wall toggle off + one friend's always-alert on →
   only their posts push.
