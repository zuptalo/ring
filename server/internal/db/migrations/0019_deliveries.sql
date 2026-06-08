-- Durable delivery records so a 'delivered' receipt is never permanently lost when
-- the SENDER happens to be offline at the moment the recipient acks (the relay row
-- is deleted on ack, and the receipt goes over a non-blocking socket). The sender
-- reconciles its still-'sent' messages on reconnect (POST /v1/deliveries/check).
-- Swept by age like the relay queue.
CREATE TABLE deliveries (
    sender       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    msg_id       text NOT NULL,
    delivered_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sender, recipient, msg_id)
);

-- Sender-scoped lookup for the reconcile query.
CREATE INDEX deliveries_sender_idx ON deliveries (sender, msg_id);
