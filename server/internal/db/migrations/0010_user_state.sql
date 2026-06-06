-- Account lifecycle state.
--
-- Deleting an account no longer drops the user row (which would free the id to be
-- re-registered and leave peers unable to tell the person is gone). Instead the
-- row is kept and flipped to 'terminated' while all of the user's per-user data is
-- wiped (see store.DeleteUser). Clients poll POST /v1/status to detect terminated
-- peers and render them as "Ghosted".

ALTER TABLE users ADD COLUMN state text NOT NULL DEFAULT 'active';
CREATE INDEX users_terminated_idx ON users (id) WHERE state = 'terminated';
