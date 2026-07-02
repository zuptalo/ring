# Quickstart: verifying owner-only Wall notifications (spec 1031)

## Automated

```sh
npm run test:unit -- wall-activity-policy sw-inbox.postactivity   # pure predicate + SW preview
cd server && go test ./internal/api/ -run TestSubmitEngagement    # fan-out contract
npm run test:e2e -- wall-activity-notify.spec.ts                  # full 3-account behavior
npm run build                                                     # typecheck gate
```

## Manual (dev stack)

```sh
make start          # Postgres + ringd + Vite on :5173
```

Then use the drive harness for a fast 3-account repro (or three browser profiles):

```sh
node drive/scenarios/  # see drive/README.md; a scenario for this spec can reuse
                       # createAccount/pair + the __ringTest hook
```

1. Sign up A, B, C; make B and C friends of A.
2. A shares a Wall post.
3. As B, comment on it → **A** shows a banner "B commented on your post"; **C shows
   nothing** (this is the fix — C used to be alerted too when closed); B shows nothing.
4. As B, react 👍 → A banners "B reacted 👍 to your post" (new capability).
5. As B, remove the reaction → nothing anywhere.
6. As A, comment/react on A's own post → nothing anywhere.
7. Settings → Notifications → Wall → toggle **Activity on your posts** off → B comments →
   no banner for A, but the comment appears on the post.
8. Closed-app: install the PWA / allow notifications, close A's app, comment as B → A's
   device shows "B commented on your post" (from the service worker); C's closed device
   stays silent.

## What changed where (orientation)

- `server/internal/api/posts_handlers.go` — engagement push: author-only, reactions too
- `server/internal/push/push.go` — `NotifyPostActivity` (`{"t":"post-activity","post"}`)
- `src/services/wall-activity-policy.ts` — the pure alert decision (vitest-covered)
- `src/db/queries.ts` — `syncEngagement` returns fresh items; `notifyPostActivity` banners
- `src/composables/useSync.ts` — wires the WS frame to the banner
- `src/sw.ts` + `src/services/sw-inbox.ts` — closed-app notification, removal-safe
- `src/settings/schema.ts` — "Activity on your posts" toggle (`notifications.wall.activity`)
