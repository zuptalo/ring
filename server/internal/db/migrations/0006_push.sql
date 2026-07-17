-- Web Push subscriptions (Milestone 7f).
--
-- One row per (user, browser push endpoint). Stores only the push-service
-- endpoint and the subscription's public keys (p256dh + auth) - the standard
-- Web Push subscription fields. No message content is ever pushed (the server
-- sends a content-free "tickle"), so this stays consistent with the
-- zero-knowledge model.

CREATE TABLE push_subscriptions (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   text NOT NULL,
    p256dh     text NOT NULL,
    auth       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, endpoint)
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
