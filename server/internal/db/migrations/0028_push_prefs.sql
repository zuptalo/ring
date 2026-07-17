-- Push routing preferences (spec 1050).
--
-- One JSONB blob per subscription row: class opt-outs, muted conversation route
-- ids (opaque, client-minted), and per-author post overrides. Replaced whole on
-- every registration (full-state, never diffed) and deleted with the row, so
-- nothing preference-shaped outlives its subscription (FR-011). The default '{}'
-- means "push everything" — exactly the pre-1050 behavior, which is also the
-- old-client story: a device that never registers prefs keeps today's pushes.
--
-- Zero-knowledge note: this column is deliberately plaintext-usable — the whole
-- point is letting the blind relay skip a tickle. What it reveals (a device's
-- notification posture, pseudonymous muted conversations) is the user-approved
-- ledger documented in specs/1050-quiet-housekeeping-frames/spec.md.

ALTER TABLE push_subscriptions
    ADD COLUMN prefs jsonb NOT NULL DEFAULT '{}';
