-- Encrypted own-data sync + recovery-wrap storage (Milestone 7e).
--
-- Zero-knowledge: sync_records holds opaque per-record ciphertext (the client
-- encrypts each row under its master key before pushing). The server only sees
-- which store/record changed, a coarse updated_at (for last-write-wins), and a
-- monotonic seq it assigns for cursor-based pulls. recovery_wraps holds the
-- identity+master-key blob sealed under the user's recovery code (server can't
-- open it) so a reinstalled/new device can restore.

CREATE SEQUENCE sync_seq;

CREATE TABLE sync_records (
    user_id    uuid   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store      text   NOT NULL,
    record_id  text   NOT NULL,
    seq        bigint NOT NULL,             -- server-assigned, bumped on every write
    updated_at bigint NOT NULL,             -- client epoch ms (LWW hint)
    ciphertext text,                        -- opaque sealed record ('' when deleted)
    deleted    boolean NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, store, record_id)
);

CREATE INDEX sync_records_cursor_idx ON sync_records (user_id, seq);

CREATE TABLE recovery_wraps (
    user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    salt       text NOT NULL,               -- b64url Argon2id salt
    envelope   text NOT NULL,               -- JSON of the sealed recovery envelope
    updated_at timestamptz NOT NULL DEFAULT now()
);
