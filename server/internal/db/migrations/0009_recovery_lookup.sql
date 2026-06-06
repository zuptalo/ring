-- New-device restore (recovery code).
--
-- A returning user on a fresh device has only their recovery code. To find the
-- account from the code alone, the client uploads a one-way LOOKUP hash of the
-- code alongside the recovery wrap. The server still never sees the code - only
-- this hash - so the zero-knowledge property holds (the wrap stays sealed under
-- an Argon2id key derived from the code, which the server cannot derive).
--
-- Nullable for rows written before this migration; UNIQUE (partial) so a lookup
-- resolves to at most one account.
ALTER TABLE recovery_wraps ADD COLUMN lookup text;
CREATE UNIQUE INDEX recovery_wraps_lookup_idx ON recovery_wraps (lookup) WHERE lookup IS NOT NULL;
