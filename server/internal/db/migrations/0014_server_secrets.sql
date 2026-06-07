-- Server secret material, encrypted at rest.
--
-- Holds the auto-generated VAPID keypair, token-signing key, and TURN shared
-- secret that used to live in <DATA_DIR>/secrets.json. Moving them here makes the
-- container stateless (one Postgres backup restores everything). The bytes are
-- AES-256-GCM ciphertext (12-byte nonce prepended), encrypted with a key derived
-- from the SECRETS_KEY env var, so a database dump on its own cannot use them.
-- A single row keyed 'default'.

CREATE TABLE server_secrets (
    id         text  PRIMARY KEY,            -- always 'default' for now
    secret     bytea NOT NULL,               -- nonce(12) || AES-256-GCM(json)
    updated_at timestamptz NOT NULL DEFAULT now()
);
