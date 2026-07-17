-- Usernames + public in-network directory.
--
-- The network stays invite-only, but inside it every active account is now
-- discoverable: each user picks an immutable, network-unique username at
-- registration, and exposes a display name, a small avatar thumbnail, and an
-- About line that the directory (GET /v1/users) serves to every other member, so
-- people can start an E2EE chat/call without a friend-request handshake.
--
-- TRUST-MODEL NOTE: username/display_name/avatar_thumb/about are the one class of
-- user data the server stores in the clear. Everything else - message bodies,
-- media, prekeys - stays end-to-end encrypted exactly as before. This is the
-- deliberate, narrow cost of an in-network directory. Clients omit avatar/about
-- (store NULL) when the owner sets the matching privacy tier to 'nobody'.
--
-- username is IMMUTABLE: no server code path ever UPDATEs username/username_fold
-- (the only writer besides register is a one-time claim for legacy NULL rows).
-- username_fold is the case-folded (lowercased) uniqueness + lookup key.
-- Pre-migration rows keep NULL username and are excluded from the directory
-- until they claim one via POST /v1/me/username.

ALTER TABLE users
    ADD COLUMN username      text,
    ADD COLUMN username_fold text,
    ADD COLUMN display_name  text,
    ADD COLUMN avatar_thumb  text,
    ADD COLUMN about         text,
    ADD COLUMN profile_at    timestamptz NOT NULL DEFAULT now();

-- Network-unique handle (case-insensitive). Partial so legacy NULL rows don't
-- collide; once claimed a username can never be reused - the user row is kept
-- even on termination, so a departed member's handle can't be re-registered to
-- impersonate them.
CREATE UNIQUE INDEX users_username_fold_key ON users (username_fold) WHERE username_fold IS NOT NULL;

-- Directory scan/search: only active, username-bearing rows are listable, ordered
-- by the folded handle for keyset pagination.
CREATE INDEX users_directory_idx ON users (username_fold) WHERE state = 'active' AND username IS NOT NULL;
