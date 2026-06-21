-- Per-post lifetime window (spec 0003). The author picks how long a post stays after
-- the LAST activity (1h / 24h / 72h). Keep-alive resets the expiry to now + this
-- window on every reaction/comment, so the chosen value is respected (a 1h post never
-- outlives 1h of silence) while active posts roll forward. Coarse timing metadata, the
-- same privacy class as expires_at. Existing rows default to 72h.
ALTER TABLE posts ADD COLUMN ttl_ms bigint NOT NULL DEFAULT 259200000; -- 72h
