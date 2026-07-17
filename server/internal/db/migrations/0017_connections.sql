-- Connect-request relationships: the server-enforced 1:1 connection state that will
-- gate directory-initiated messaging + presence. A pair is "connected" when an
-- accepted row exists in EITHER direction and neither has blocked the other.
--
-- Backfilled as accepted from the existing contact edges so conversations that
-- already exist keep working once the gate is enabled (this migration alone changes
-- no behaviour; the gate is wired separately).
CREATE TABLE connections (
    requester  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state      text NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (requester, target),
    CHECK (requester <> target)
);

-- Look up a user's incoming requests (and the accepted/rejected state) quickly.
CREATE INDEX connections_target_idx ON connections (target, state);

-- Backfill: every existing contact edge becomes an accepted connection, so
-- already-talking users stay connected. Connected() checks either direction, so one
-- accepted row per pair is enough.
INSERT INTO connections (requester, target, state)
SELECT owner, contact, 'accepted' FROM contacts
ON CONFLICT (requester, target) DO NOTHING;
