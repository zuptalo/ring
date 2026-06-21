-- Social Wall (spec 0003): end-to-end-encrypted status posts shared to a chosen
-- audience of friends. The server stores ONLY opaque ciphertext + per-recipient
-- wrapped-key envelopes + coarse routing metadata — never post content, media keys,
-- reaction/comment text, the close-friends tier, or who is in the "close" subset.
-- A post is sealed under a per-post content key (K_post); that key is wrapped to each
-- audience member and stored as one envelope row. The recipient set in
-- post_envelopes is the audience the relay addresses (and reuses to fan engagement
-- out); it does NOT reveal the tier (friends vs close) — the server sees a set either
-- way.

CREATE TABLE posts (
    id         text PRIMARY KEY,                       -- client-generated uuid
    author     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blob_id    text NOT NULL,                          -- opaque capability: K_post-sealed payload
    size       int  NOT NULL DEFAULT 0,                -- coarse size (routing/quotas)
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz                             -- NULL = keep; coarse lifetime
);
CREATE INDEX posts_author_idx ON posts (author, created_at DESC);

-- Per-recipient wrapped K_post. This is the post's audience; the relay delivers the
-- post (and, later, engagement on it) to exactly this set.
CREATE TABLE post_envelopes (
    post_id     text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    recipient   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wrapped_key text NOT NULL,                          -- opaque (b64url WrappedPostKey)
    PRIMARY KEY (post_id, recipient)
);
CREATE INDEX post_envelopes_recipient_idx ON post_envelopes (recipient);

-- Audience-visible engagement (reactions/comments) + tombstones, sealed under K_post.
-- Fanned out to the post's post_envelopes set. Wired by US4/US6.
CREATE TABLE post_engagement (
    id         text PRIMARY KEY,                       -- client-generated uuid
    post_id    text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    actor      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       text NOT NULL,                          -- reaction | comment | tombstone
    payload    text NOT NULL,                          -- opaque, sealed under K_post
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_engagement_post_idx ON post_engagement (post_id, created_at);

-- Author-only "who viewed" receipts (seen-receipts-gated client-side). Wired by US7.
CREATE TABLE post_views (
    post_id   text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    viewer    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, viewer)
);
