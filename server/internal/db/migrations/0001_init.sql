-- Accounts foundation (Milestone 7a).
--
-- Zero-knowledge invariant: this schema holds NO plaintext user content. Only
-- account identifiers, invitation bookkeeping, and token hashes live here.
-- gen_random_uuid() is built into PostgreSQL core (13+); no extension needed.

CREATE TABLE users (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invitations (
    code       text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    used_by    uuid REFERENCES users(id),
    used_at    timestamptz
);

-- Only the SHA-256 of a token is ever stored; the plaintext token lives solely
-- on the device that registered.
CREATE TABLE tokens (
    token_hash   bytea PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz
);

CREATE INDEX tokens_user_id_idx ON tokens (user_id);
