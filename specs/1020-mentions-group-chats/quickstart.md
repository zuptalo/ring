# Quickstart: verifying @mentions

## Unit (fast, the core invariant)
- Extend `src/services/notify-policy.test.ts` with the escalation matrix (contracts/payload.md).
  `npx vitest run src/services/notify-policy.test.ts`

## e2e (multi-account) — `e2e/mentions.spec.ts` (pattern: e2e/groups.spec.ts)
1. Create A, B, C; A creates a group with B, C (A is owner via `createdBy`).
2. On B: mute the group (and a variant: set content to "Badge only").
3. A sends "hi @B": assert B gets a notification/banner naming A even while muted; C does not.
4. B toggles "Notify for mentions even when muted" off → A mentions B → assert no escalation.
5. A (owner) `@everyone` → B and C both notified (per their toggles/master). A non-owner `@everyone`
   from B → C does NOT treat it as a broadcast.
6. B's chat row shows the "@" marker + mention count; open + jump-to-mention; assert it clears.
   `npm run test:e2e -- mentions`

## drive (visual) — `drive/scenarios/mention-*.mjs` (live dev app)
- Render: mention chip in a bubble, self-mention emphasized; the "@" row marker + count; jump-to.
- Hooks to add in `src/services/testhook.ts`: `sendWithMentions(chatId, body, ids[, everyone])`,
  `unreadMentions(chatId)`, `isGroupOwner(chatId)`.
