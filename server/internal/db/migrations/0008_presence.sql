-- Presence: online / last-seen (server-assisted).
--
-- The hub knows which users have a live, active connection in memory; this adds
-- the durable bits it needs: a coarse last_seen timestamp (updated on connect
-- and on every transition to offline) and the user's two sharing booleans. The
-- client uploads share_online / share_last_seen (derived from its privacy
-- settings); the relay gates what it reveals to watchers accordingly.
--
-- No contact graph is stored: a peer can only watch a user whose userId they
-- already hold, and a userId is only obtained through a mutual friend handshake,
-- so every watcher is by construction already a contact. Visibility therefore
-- reduces to "report to watchers" vs "report nothing" (the nobody case).

ALTER TABLE users
    ADD COLUMN last_seen_at    timestamptz,
    ADD COLUMN share_online    boolean NOT NULL DEFAULT true,
    ADD COLUMN share_last_seen boolean NOT NULL DEFAULT true;
