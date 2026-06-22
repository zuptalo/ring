-- Per-device version + timezone for the 9-AM-local version-announcement push (spec 1016).
-- Each push subscription reports the client version it's running and the device's coarse
-- local UTC offset (minutes), so the server can deliver "a new version is available" at
-- 09:00 local time only to devices that are behind. `last_announced_version` dedups to
-- once-per-release. All three are coarse, non-secret metadata (the version is already
-- public; the offset is minutes, never a zone name or location) — see spec Zero-Knowledge
-- Impact / NFR-ZK-002. Additive; forward-only.
ALTER TABLE push_subscriptions
    ADD COLUMN installed_version      text,
    ADD COLUMN tz_offset_minutes      int,
    ADD COLUMN last_announced_version text;
