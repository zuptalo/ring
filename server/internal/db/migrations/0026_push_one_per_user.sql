-- One push subscription per account (single active device by design).
--
-- The table was keyed on (user_id, endpoint), so every web-push endpoint a device ever minted
-- accumulated as its own row — Apple rotates endpoints, and a reinstall / notification-
-- permission re-grant makes a new one — and a single message then fanned out to all of them
-- (observed: 7 pushes for one account). Collapse to the newest subscription per user and key
-- the table on user_id alone, so a new subscription (including a login from another device)
-- OVERWRITES the previous one, revoking the old endpoint. No data is lost that matters: a
-- subscription is just a delivery handle, refreshed by the client whenever it loads.

-- Keep only the most-recently-created subscription per user (endpoint breaks created_at ties).
DELETE FROM push_subscriptions a
  USING push_subscriptions b
 WHERE a.user_id = b.user_id
   AND (b.created_at, b.endpoint) > (a.created_at, a.endpoint);

DROP INDEX IF EXISTS push_subscriptions_user_idx; -- redundant once user_id is the primary key
ALTER TABLE push_subscriptions DROP CONSTRAINT push_subscriptions_pkey;
ALTER TABLE push_subscriptions ADD PRIMARY KEY (user_id);
