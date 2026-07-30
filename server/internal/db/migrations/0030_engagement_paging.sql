-- Spec 1065: bounded engagement fetching.
--
-- GET /v1/posts/{id}/engagement returned every row a post had ever accumulated,
-- and the client refetched the whole history on each change notification. That
-- was survivable while a post carried a handful of reactions; comment threads
-- make it untenable.
--
-- Paging is keyset, not OFFSET, so a page stays cheap however deep it goes.
-- created_at is NOT unique — a burst of reactions lands inside the same
-- millisecond routinely — so the cursor is the pair (created_at, id) and the
-- index has to carry id for the page to stay a pure index scan rather than a
-- sort. The old (post_id, created_at) index is a strict prefix of the new one,
-- so nothing that used it loses its index.
--
-- Zero-knowledge: this changes only how rows are read. No column is added, and
-- the payload stays opaque.

CREATE INDEX IF NOT EXISTS post_engagement_page_idx
    ON post_engagement (post_id, created_at, id);

DROP INDEX IF EXISTS post_engagement_post_idx;
