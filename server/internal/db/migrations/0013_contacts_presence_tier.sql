-- Contact graph + presence visibility tiers.
--
-- The network now has a public directory, so a userId no longer implies a mutual
-- relationship - the old "every watcher is by construction a contact" assumption
-- (see 0008) no longer holds. To let a user restrict their online/last-seen to
-- "my contacts + people who added me", the relay needs to know the contact graph.
--
-- TRUST-MODEL NOTE: like profiles, the contact graph is now server-readable (the
-- relay learns who has added whom) - the deliberate cost of an enforceable
-- "contacts only" presence tier. Message content/media/keys stay E2EE.
--
-- `contacts(owner, contact)` is a DIRECTED edge "owner added contact" (same shape
-- as `blocks`). Presence audience for O = {O's contacts} ∪ {people who added O},
-- minus blocked pairs.

CREATE TABLE contacts (
    owner    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner, contact)
);
-- Reverse lookup: "who added <contact>?" (the inbound half of the audience).
CREATE INDEX contacts_reverse_idx ON contacts (contact, owner);

-- Presence visibility tiers replace the on/off booleans: 'everyone' | 'contacts'
-- | 'nobody'. Backfilled from the existing share_* booleans (true→everyone,
-- false→nobody). The booleans are kept in sync by SetPresencePrefs for safety but
-- the tier columns are authoritative for gating.
ALTER TABLE users
    ADD COLUMN online_tier    text NOT NULL DEFAULT 'everyone',
    ADD COLUMN last_seen_tier text NOT NULL DEFAULT 'everyone';
UPDATE users
   SET online_tier    = CASE WHEN share_online    THEN 'everyone' ELSE 'nobody' END,
       last_seen_tier = CASE WHEN share_last_seen THEN 'everyone' ELSE 'nobody' END;
