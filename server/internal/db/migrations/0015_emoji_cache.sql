-- Self-hosted Noto emoji cache, moved off the filesystem into Postgres.
--
-- The emoji proxy fetches each asset (animated Lottie + static WebP) from Google
-- once and caches it so clients never hit Google directly. Storing the cache here
-- (instead of <DATA_DIR>/emoji-cache/) keeps the privacy property across container
-- recreates and removes the last reason for a /data mount. Regenerable: a row can
-- be dropped any time and is re-fetched on the next request. No eviction policy
-- (same unbounded-but-tiny behavior as the old disk cache).

CREATE TABLE emoji_cache (
    path         text  PRIMARY KEY,          -- upstream path, e.g. "1f600/lottie.json"
    content_type text  NOT NULL,             -- "application/json" or "image/webp"
    bytes        bytea NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
