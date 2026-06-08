package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
)

// Relay drain over HTTP, for the service worker.
//
// The live client drains the queue over the WebSocket (and acks there). But a
// backgrounded/closed PWA has no socket - only its service worker, woken by a
// content-free push tickle. A short-lived service-worker activation can't
// comfortably manage a WebSocket, so it pulls the queued (still E2EE) frames over
// the pending endpoint and decrypts them locally for a notification preview. It
// does NOT ack/remove them (read-only - it never advances the ratchet); the page
// drains + persists + acks for real over the WebSocket next time it connects. The
// payloads are opaque ciphertext the server already stores; this adds no plaintext
// exposure.

// relayPending (GET /v1/relay/pending) returns the caller's queued, undelivered
// frames (each an opaque `{t:"msg",id,from,ciphertext}` payload), oldest first.
// Fetching them proves the device received them (the push woke the SW and it
// pulled the queue), so each frame's sender gets a "delivered" receipt - WITHOUT
// dequeuing, so the page can still drain + persist them durably. Idempotent: the
// later WS ack re-sends the same receipt and clients never regress 'read' back to
// 'delivered'.
func (h *Handlers) relayPending(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	items, err := h.Relay.PendingForRecipient(r.Context(), uid)
	if err != nil {
		slog.Error("relay pending failed", "err", err, "user", uid)
		httpx.Error(w, http.StatusInternalServerError, "could not load pending messages")
		return
	}
	// Bound the SW's work: a one-shot background preview only needs the freshest
	// frames (it dedupes + aggregates anyway), and the page WS-drains the full
	// backlog durably. Keep the tail (newest) so the most relevant messages preview.
	const maxPreviewFrames = 50
	if len(items) > maxPreviewFrames {
		items = items[len(items)-maxPreviewFrames:]
	}
	frames := make([]json.RawMessage, 0, len(items))
	for _, it := range items {
		frames = append(frames, json.RawMessage(it.Payload))
		if it.Sender != "" && it.MsgID != "" {
			// Record durably first so the sender can reconcile even if it's offline
			// right now and this live receipt is dropped.
			if err := h.Relay.RecordDelivery(r.Context(), it.Sender, uid, it.MsgID); err != nil {
				slog.Error("record delivery failed", "err", err, "msg", it.MsgID)
			}
			receipt, _ := json.Marshal(map[string]any{
				"t": "receipt", "messageId": it.MsgID, "status": "delivered", "at": time.Now().UnixMilli(), "from": uid,
			})
			h.Hub.Send(it.Sender, receipt)
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"frames": frames})
}

type relayAckRequest struct {
	IDs []string `json:"ids"`
}

// relayAck (POST /v1/relay/ack) acknowledges drained frames by message id:
// removes each from the queue and, mirroring the WebSocket ack, sends the
// original sender a "delivered" receipt if they're online. Idempotent - acking an
// already-removed id is a no-op.
func (h *Handlers) relayAck(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var req relayAckRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	for _, id := range req.IDs {
		if id == "" {
			continue
		}
		sender, found, err := h.Relay.DeleteRelay(r.Context(), uid, id)
		if err != nil {
			slog.Error("relay ack delete failed", "err", err, "user", uid, "msg", id)
			continue
		}
		if found && sender != "" {
			if err := h.Relay.RecordDelivery(r.Context(), sender, uid, id); err != nil {
				slog.Error("record delivery failed", "err", err, "msg", id)
			}
			receipt, _ := json.Marshal(map[string]any{
				"t": "receipt", "messageId": id, "status": "delivered", "at": time.Now().UnixMilli(), "from": uid,
			})
			h.Hub.Send(sender, receipt)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

type deliveriesCheckRequest struct {
	IDs []string `json:"ids"`
}

// deliveriesCheck (POST /v1/deliveries/check) lets a sender reconcile its still-
// 'sent' messages on reconnect: given a list of message ids it originated, it
// returns the durably-recorded deliveries (one entry per recipient, so a group
// message can report each member). This recovers a 'delivered' receipt that was
// dropped because the sender was offline at the moment the recipient acked.
func (h *Handlers) deliveriesCheck(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var req deliveriesCheckRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// Bound the query the same way the client bounds what it asks about.
	const maxIDs = 500
	if len(req.IDs) > maxIDs {
		req.IDs = req.IDs[:maxIDs]
	}
	rows, err := h.Relay.DeliveriesFor(r.Context(), uid, req.IDs)
	if err != nil {
		slog.Error("deliveries check failed", "err", err, "user", uid)
		httpx.Error(w, http.StatusInternalServerError, "could not load deliveries")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, d := range rows {
		out = append(out, map[string]any{"messageId": d.MsgID, "recipient": d.Recipient, "at": d.DeliveredMs})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"delivered": out})
}
