-- Durable SEEN records (spec 1010), the symmetric twin of `deliveries` (0019): a
-- group message's "Seen X/N" must survive the SENDER being offline at the instant a
-- member opens it. A 'seen' receipt is relayed over a non-blocking socket, so if the
-- sender is offline it's lost; the sender reconciles its still-unseen messages on
-- reconnect (POST /v1/seen/check). Same metadata shape/class as `deliveries` (routing
-- ids + a timestamp, no message content) — no new server-visible metadata class.
-- Swept by age like the relay queue + deliveries.
--
-- Privacy: this only ever holds receipts a recipient's client CHOSE to send (the
-- "Seen receipts" preference is enforced entirely client-side; an opted-out user
-- sends nothing, so nothing is stored). There is deliberately NO preference column —
-- the server is never told the preference.
CREATE TABLE seen (
    sender     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    msg_id     text NOT NULL,
    seen_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sender, recipient, msg_id)
);

-- Sender-scoped lookup for the reconcile query.
CREATE INDEX seen_sender_idx ON seen (sender, msg_id);
