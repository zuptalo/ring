-- Durable per-recipient tombstones for DELETED posts.
--
-- post_revocations FKs post_id ON DELETE CASCADE, so it vanishes the moment the post row is
-- deleted — fine for the "remove one recipient" flow (the post lives on) but useless for a
-- full delete (an OFFLINE recipient would never learn the post is gone). This table has NO FK
-- to posts, so a tombstone survives the post's deletion: the author deletes the post, we record
-- one row per recipient here, and listPosts surfaces these (UNIONed into `revoked`) so every
-- recipient device prunes its local copy on its next sync. Online recipients also get an
-- immediate `post-revoke` websocket frame; this table is the catch-up for everyone else.
CREATE TABLE IF NOT EXISTS post_deletions (
    post_id    text NOT NULL,
    recipient  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, recipient)
);

-- The recipient lookup listPosts runs every sync.
CREATE INDEX IF NOT EXISTS post_deletions_recipient_idx ON post_deletions (recipient, created_at);
