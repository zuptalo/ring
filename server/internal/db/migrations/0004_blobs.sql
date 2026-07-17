-- Encrypted media blobs (Milestone 7d).
--
-- Stores ciphertext only: the client encrypts each file with a per-file key
-- (AEAD) before upload, and that key travels sealed inside the E2EE message -
-- so the server holds opaque bytes and never the plaintext or the key. The
-- blob id is an unguessable capability; any authenticated user who knows it can
-- fetch (that's how a recipient downloads a sender's attachment).

CREATE TABLE blobs (
    id         text  PRIMARY KEY,            -- random url-safe capability id
    owner      uuid  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bytes      bytea NOT NULL,               -- ciphertext (packed nonce|ct)
    size       int   NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
