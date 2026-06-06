-- Message relay offline queue (Milestone 7c).
--
-- Holds sealed message frames addressed to a recipient until their device
-- connects and acknowledges receipt. The `payload` is the opaque delivered
-- frame ({t:"msg",id,from,ciphertext}); the server never reads the ciphertext.
-- Consistent with the zero-knowledge model: only routing metadata is in the
-- clear (who to deliver to, from whom, and a correlation id).

CREATE TABLE relay_queue (
    seq        bigserial PRIMARY KEY,
    recipient  uuid  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender     uuid  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    msg_id     text  NOT NULL,
    payload    bytea NOT NULL,            -- opaque delivered frame (forwarded verbatim)
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX relay_queue_recipient_idx ON relay_queue (recipient, seq);

-- A resend of the same message to the same recipient is a no-op (idempotent).
CREATE UNIQUE INDEX relay_queue_recipient_msg_idx ON relay_queue (recipient, msg_id);
