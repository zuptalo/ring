-- Per-recipient post revocations (spec 0003). When an author removes someone from
-- their close friends, the author drops that person from each close-only post's
-- audience (their envelope is deleted) and records a revocation here so the person's
-- device removes its local copy on the next sync — even if they were offline when the
-- live signal fired. Best-effort like any E2EE deletion (a copy already on-device is
-- removed on signal; nothing is recoverable from the server regardless).
CREATE TABLE post_revocations (
    post_id    text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    recipient  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, recipient)
);
CREATE INDEX post_revocations_recipient_idx ON post_revocations (recipient, created_at);
