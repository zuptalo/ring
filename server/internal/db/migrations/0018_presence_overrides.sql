-- Per-contact presence overrides: on top of the global online/last-seen tier, a
-- user can explicitly allow (show to) or deny (hide from) a specific person. With
-- this in place, the default tier path is restricted to contacts only (non-contacts
-- never see presence unless explicitly allowed).
CREATE TABLE presence_overrides (
    owner    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    override text NOT NULL, -- 'allow' | 'deny'
    PRIMARY KEY (owner, target)
);
