-- Small server-side key/value table for the server's own (non-user, non-secret)
-- operational metadata. First use: remember the last app version we announced to
-- users, so a redeploy that changes the version fires a one-time "what's new" push
-- broadcast while a plain restart (same version) does not (spec: version-announce push).
-- This holds NO user data and NO secrets — only the app's own public version string.
CREATE TABLE app_meta (
    key        text PRIMARY KEY,
    value      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
