-- Prekey distribution (Milestone 7b).
--
-- These columns hold ONLY public key material + the signed-prekey signature -
-- values that are meant to be handed to peers to bootstrap X3DH. No secret or
-- plaintext-content data, so this is consistent with the zero-knowledge model.
-- The server never verifies the signature (clients do); it just stores/serves.

-- One row per user: published identity public keys + current signed prekey.
CREATE TABLE prekey_bundles (
    user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    ed_pub     text NOT NULL,             -- b64url Ed25519 identity public key
    x_pub      text NOT NULL,             -- b64url X25519 identity public key
    spk_id     text NOT NULL,             -- signed prekey id
    spk_pub    text NOT NULL,             -- b64url X25519 signed prekey public
    spk_sig    text NOT NULL,             -- b64url Ed25519 signature over spk_pub
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Pool of unused one-time prekeys; exactly one is consumed per session bootstrap.
CREATE TABLE one_time_prekeys (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id     text NOT NULL,             -- one-time prekey id
    pub        text NOT NULL,             -- b64url X25519 public
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key_id)
);

CREATE INDEX one_time_prekeys_user_idx ON one_time_prekeys (user_id, created_at);
