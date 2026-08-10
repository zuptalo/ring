# Quickstart: verifying spec 1065 by hand

How to see each user story actually work, against the live dev stack. This is
the script the dev-stack verification pass follows.

## Setup

```sh
make start                # Postgres + ringd (air) + Vite on :5173
```

Scenarios drive the running stack through `window.__ringTest` using the `drive/`
harness. Screenshots land in `.tmp/drive/*.png`.

```sh
node drive/scenarios/audience-receipts.mjs      # US1
node drive/scenarios/post-views.mjs             # US2
node drive/scenarios/post-reactions.mjs         # US3
node drive/scenarios/comment-threads.mjs        # US4 + US5
```

Wipe between runs with `sweep([...])` inside the scenario, or `make db-reset`
with ringd stopped.

## US1 — per-member receipt times

1. Create four accounts, group them.
2. Send one message from the first account.
3. Have the second account open the chat, wait, then the third. Leave the fourth
   offline.
4. On the sender, open the message action menu → Info.

**Expect**: three rows with counts, e.g. "Seen by 2", "Delivered 1", "Not yet
delivered 1". Tap "Seen by 2" and each member shows a real time, most recent
first. Tap "Not yet delivered" and the offline member has no time and a plain
note.

**Also check**: turn Seen receipts off in Settings → Privacy, reopen Info, and
confirm the seen row is gone entirely and the members who saw it now appear
under Delivered.

**Regression to watch (R5)**: add a fifth member to the group *after* the
message was sent, then reopen Info. They must **not** appear under "Not yet
delivered" — the denominator is the roster at send time.

**Clock check (FR-034)**: in the driver, mark one member seen with a timestamp
two hours in the future. The list must show a sane time, never a future one.

## US2 — author-only view count

1. Two accounts befriend a third; the third posts to their wall.
2. On one audience account, scroll the feed so the post is half on screen and
   hold for over a second. Do not open it.
3. On the other, open the post detail.

**Expect**: on the author's device, "Seen by 2" appears on their own post. Tap
it: both people, each with the moment they first saw it, most recent first.

**Author-only**: on either audience device, the post shows no count and no
viewer row anywhere. Confirm directly too:

```sh
curl -s -H "Authorization: Bearer <audience-token>" \
  http://localhost:8080/v1/posts/<postId>/views
# expect 403 only the author can see views
```

**First-view-wins**: scroll the same post past the threshold five more times on
the same account, and open it twice. The author's count stays 2 and the shown
time does not move.

**Fast scroll**: flick the feed quickly past a fresh post without pausing. It
must not be counted.

**Author excluded**: the author never appears in their own list.

## US3 — who reacted, with what, and when

1. Three audience accounts react to one post with different emoji; one of them
   then changes their emoji; another removes theirs.
2. On the author's device, tap the reaction pills.

**Expect**: a sheet grouped by emoji, most-used first. The person who changed
their emoji appears once with the new one and the time of the change. The person
who removed theirs is absent, and the count reflects it.

**Non-author**: tapping the pills on an audience device toggles the reaction as
it always did and opens nothing.

## US4 and US5 — replies and comment reactions

1. Two accounts comment on a third's post.
2. A fourth account taps reply on the first comment and answers it.
3. Someone replies to *that reply*.
4. Two accounts react to one comment.

**Expect**:

- the reply renders attached under its parent comment, one level in, on every
  device including one that loads the post fresh
- the reply-to-a-reply sits at the **same** indent under the same top-level
  comment and names the person it answers, never a second indent
- the reacted comment carries its own tally, and no other comment changes
- the comment's author, and the post owner, can open the tally and see who,
  what, and when; a third audience member sees only the tally

**Deletion**: delete the parent comment. Its replies stay readable under "This
comment was deleted", and its own reactions disappear with it.

**Notifications (FR-029a/b)**: with the fourth account's app closed, have
someone reply to its comment. It should receive one notification. The post owner
receives one. A fifth audience account that is not involved receives none.
Replying to your own comment notifies nobody.

## Zero-knowledge check (SC-007)

With a post carrying comments, replies, reactions, and comment reactions:

```sh
docker compose exec -T db psql -U ring -d ring -c \
  "select kind, length(payload), target from post_engagement where post_id='<postId>' order by created_at;"
```

**Expect**:

- `kind` is only `comment`, `reaction`, or `tombstone`. No new kind value.
- every `reaction` row has the **same** payload length, whether it targets the
  post or a comment.
- `target` is null except on tombstones.
- no readable text or emoji anywhere.

Also confirm `notify` never lands in the table:

```sh
docker compose exec -T db psql -U ring -d ring -c \
  "\\d post_engagement"     # no notify column
```

## Scale check (SC-003, SC-008)

Use the driver to post once and generate a few hundred reactions and comments
against it, then:

- open the author's viewer list and confirm the first screenful is immediate and
  more rows load on scroll rather than all at once
- open the post and confirm the comment thread renders a bounded number of
  replies with a way to see the rest
- watch the network panel: opening the post must not fetch the post's entire
  engagement history in one response
