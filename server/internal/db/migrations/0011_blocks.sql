-- Per-user block list (server-enforced).
--
-- A row (blocker, blocked) means `blocker` has blocked `blocked`. Enforcement:
--   * the relay drops messages/call-offers from `blocked` to `blocker` (silently,
--     the sender still gets a "sent" receipt), and
--   * GET /v1/keys/{blocker} returns 404 to `blocked`, so they can't bootstrap a
--     session or re-add the person who blocked them.
-- The relay already routes by (recipient, sender) id, so storing a block edge adds
-- no plaintext leakage beyond what the relay already observes.
--
-- Both sides reference users(id) ON DELETE CASCADE. Termination keeps the user
-- row, so a block whose `blocked` party later terminates stays valid.

CREATE TABLE blocks (
    blocker    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker, blocked)
);
-- Reverse lookup for enforcement: "does <blocker> block <sender/requester>?".
CREATE INDEX blocks_pair_idx ON blocks (blocked, blocker);
