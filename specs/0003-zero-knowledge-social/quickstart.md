# Quickstart: Zero-Knowledge Social Wall

How to exercise the feature once implemented — for reviewers and the e2e author. Uses the existing dev
stack and the `drive/` harness (live `make start`) or the hermetic `npm run test:e2e`.

## Prerequisites
- `make start` (Vite :5173 → ringd :8080), or the isolated e2e stack.
- Two+ test accounts via the `window.__ringTest` hook (the `drive/` driver mints them).

## Happy path (the MVP loop)
1. **Befriend**: Account A sends a friend request to B (existing connections flow); B accepts. They
   are now friends. *(Reuses today's request/accept — no new mechanism.)*
2. **Close friends**: A opens the close-friends list and marks B as a close friend.
3. **Post to all friends**: A composes a **text** post, audience = "all friends", lifetime = 24h, and
   shares. B sees it on the Wall with A's avatar/name/username.
4. **Post media to close friends**: A composes an **image** (then **voice**, **video**) post,
   audience = "close friends". Only close friends (B) receive it; a non-close friend C sees nothing
   and no indication it exists.
5. **React (audience-visible)**: B reacts 👍. A **and** every other audience member see B's reaction +
   identity. B changes/removes it; everyone updates.
6. **Comment (audience-visible)**: B comments. A and the audience see the comment attributed to B,
   ordered. B deletes their comment; it disappears for the audience. A removes a comment as the post
   author.
7. **Views**: A opens the post's view list and sees B (because B has seen receipts on). A viewer with
   seen receipts off does not appear, and gets no view list on their own posts.
8. **Expiry**: after 24h (or via the test clock), the post disappears for A and all viewers.

## Zero-knowledge spot-checks (reviewer)
- Inspect server Postgres: `posts.blob_id` and `post_engagement.payload` are opaque; no plaintext
  text/emoji columns; `post_views` exists only for the author.
- Confirm `post_envelopes` shows a recipient set but no tier; the close-friends flag never appears in
  any request body or table.
- Confirm a non-audience account cannot fetch a post or submit engagement (403/empty).

## Automated coverage to add
- **Unit (vitest)**: `crypto/post.ts` seal/open round-trip; per-recipient `K_post` wrap/unwrap;
  engagement forgery (non-member key), replay, out-of-order, skipped-key; reaction caps + LWW.
- **Server (`go test`)**: `posts_handlers`/`posts.go` against the fake store — create/list/delete,
  engagement fan-out to the audience, audience+block authorization, author-only views.
- **e2e (`e2e/`)**: the full happy path above across real accounts (friend → post each media type →
  view → react → comment → expire), including the close-friends isolation and the non-audience
  negative case.

## Commands
```sh
npm run build                 # client typecheck + build
cd server && go test ./...     # server unit tests (fake store, no DB)
npm run test:e2e               # Playwright (needs make db-up)
node drive/scenarios/<wall>.mjs  # interactive drive against make start
```
