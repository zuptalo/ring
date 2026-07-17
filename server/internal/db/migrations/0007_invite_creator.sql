-- User-generated invitations (Milestone 7g).
--
-- Track who created an invite so we can cap a user's outstanding invites and
-- (later) show/revoke them. ON DELETE SET NULL so deleting a user doesn't block
-- on their invites.

ALTER TABLE invitations ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX invitations_created_by_idx ON invitations (created_by) WHERE created_by IS NOT NULL;
