# Contract: engagement notification routing (spec 1031)

The server-side behavioral contract for `POST /v1/posts/{id}/engagement`
(`submitEngagement`) and the push layer. HTTP request/response shapes are UNCHANGED —
this contract is about side effects (who gets nudged/woken).

## POST /v1/posts/{id}/engagement — side effects

Given actor `U` submits engagement of `kind` on post `P` with author `A` and audience
`Aud` (recipients + author):

| Case | WS `post-engagement` frame | Web push |
|------|---------------------------|----------|
| `kind=comment`, `U ≠ A` | every member of `Aud` except `U` | `NotifyPostActivity(A, P)` — **A only** |
| `kind=reaction`, `U ≠ A` | every member of `Aud` except `U` | `NotifyPostActivity(A, P)` — **A only** (NEW: today reactions push nobody) |
| `kind=comment`/`reaction`, `U = A` (self) | every member of `Aud` except `A` | **none** |
| `kind=tombstone` (any) | every member of `Aud` except `U` | **none** |

Invariants:

- No audience member other than `A` is EVER web-pushed for engagement (today every member
  is pushed for comments — this is the breaking behavior change, intentional).
- The WS frame set is untouched by this spec (live reconciliation for everyone).
- Auth/validation/rate-limit behavior of the handler is unchanged.
- `PostAuthor` failure → skip the push (never block or fail the engagement write for a
  notification problem); the WS frames still go out.

## Push layer: `NotifyPostActivity(ctx, userID, postID)`

- Payload (inside the encrypted Web Push envelope): `{"t":"post-activity","post":"<uuid>"}`
- Transport knobs: TTL/urgency as the existing post tickle; **topic** = base64url SHA-256
  prefix of `postID` (≤32 chars) so multiple engagements on one post collapse per device
  at the push service.
- `NotifyPost` (the `{"t":"post"}` tickle) is from now on sent ONLY for: new post
  (createPost), post revocation (removePostRecipient) — never for engagement.

## Service worker contract (client-internal)

On a `post-activity` push:

- window client(s) exist → `postMessage({type:'ring:posts'})`, show nothing (the page owns
  the alert via the WS frame / drain).
- no clients → alert only if ALL hold: `notifications.wall.activity` ≠ false; the post row
  exists locally with `outgoing === true`; the engagement item is fresh (≤10 min), not
  self, not in `sw.wallActShown`, and — for reactions — decrypts with `remove !== true`.
  Undecryptable reactions: skip silently. Comments alert without decryption (cleartext
  `kind`), body "commented on your post", title = actor's directory name.
- Notification tag: `ring:post:act:<postId>`; click url: `/wall/post/<postId>`.

## Page contract (client-internal)

On a `post-engagement` WS frame for post `P`: sync engagement, then alert iff the pure
predicate (`wall-activity-policy.ts`) returns `'alert'` for a fresh item — banner kind
`system`, name = actor's contact name, body `reacted 〈emoji〉 to your post` /
`commented on your post`, url `/wall/post/<P>`.
