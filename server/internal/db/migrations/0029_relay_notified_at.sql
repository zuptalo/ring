-- Spec 1055: a per-frame "notified" marker for the ciphertext-in-push preview path.
--
-- When a recipient device shows a bounded encrypted PREVIEW from a push (without
-- yet durably downloading the message), it posts a `notified` receipt. The server
-- stamps this timestamp on the queued frame so it can tell which still-queued
-- frames the recipient has SEEN (a preview) but not yet durably downloaded — i.e.
-- what is still owed to the device. The frame is only ever dequeued on the
-- authoritative `delivered` ack, never on `notified`.
--
-- Zero-knowledge: a nullable timestamp, no message content. It reveals to the
-- server exactly what a delivery receipt already does (recipient reachability +
-- timing), nothing readable.

ALTER TABLE relay_queue ADD COLUMN notified_at timestamptz;
