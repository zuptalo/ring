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
// later WS ack re-sends the same receipt and clients never regress 'seen' back to
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
		// Skip messages from senders the caller has blocked — held until unblock.
		if it.Sender != "" {
			if blocked, err := h.Blocks.IsBlocked(r.Context(), uid, it.Sender); err == nil && blocked {
				continue
			}
		}
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

// relayStatus (GET /v1/relay/status) returns metadata about the caller's queued
// frames - the oldest frame's age and the total count - with NO side effects: unlike
// relayPending it never dequeues and never emits a delivery receipt, so the client
// can poll it on every foreground. It powers the spec-2043 zombie self-heal: a client
// whose subscription the push service silently revoked (still 201-accepted upstream,
// never delivered to the device) sees "the server is holding messages older than any
// push wake I recorded" and force-rotates to a fresh subscription. Zero-knowledge:
// only a server timestamp and a count leave the server, never any payload.
func (h *Handlers) relayStatus(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	oldestMs, count, err := h.Relay.OldestPendingForRecipient(r.Context(), uid)
	if err != nil {
		slog.Error("relay status failed", "err", err, "user", uid)
		httpx.Error(w, http.StatusInternalServerError, "could not load relay status")
		return
	}
	// null (not 0) when the queue is empty, so the client never misreads an empty
	// queue as an epoch-0 timestamp.
	var oldest any
	if count > 0 && oldestMs > 0 {
		oldest = oldestMs
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"oldestQueuedAtMs": oldest, "count": count})
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

// relayNotified (POST /v1/relay/notified) is posted by a recipient's service worker
// when it shows a bounded PUSH PREVIEW (spec 1055) — the recipient has SEEN the message
// but not durably downloaded it. It stamps the queued frame's notified_at (so the server
// knows the frame is seen-but-still-owed) and relays a "notified" receipt to the sender,
// WITHOUT dequeuing — the full message is delivered + dequeued only on the authoritative
// ack. To the sender, "notified" renders the same as "delivered" (the recipient was
// reached). Fires on DECRYPT regardless of the recipient's display prefs, so it never
// leaks mute/hidden. Idempotent — an already-delivered id simply doesn't match.
func (h *Handlers) relayNotified(w http.ResponseWriter, r *http.Request) {
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
		sender, found, err := h.Relay.StampNotified(r.Context(), uid, id)
		if err != nil {
			slog.Error("relay notified stamp failed", "err", err, "user", uid, "msg", id)
			continue
		}
		if found && sender != "" {
			receipt, _ := json.Marshal(map[string]any{
				"t": "receipt", "messageId": id, "status": "notified", "at": time.Now().UnixMilli(), "from": uid,
			})
			h.Hub.Send(sender, receipt)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// callAck (POST /v1/call/ack) is posted by a callee's service worker when it shows
// an incoming-call notification. It proves the device is reachable (it received the
// ring push), so the server flips every caller currently ringing this user from
// "Calling" to "Ringing". No body; the authenticated user IS the callee.
func (h *Handlers) callAck(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	if uid != "" && h.Hub != nil {
		h.Hub.AckCallReachable(uid)
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

type seenCheckRequest struct {
	IDs []string `json:"ids"`
}

// seenCheck (POST /v1/seen/check) lets a sender reconcile its not-yet-seen messages
// on reconnect (spec 1010, the twin of deliveriesCheck): given a list of message ids
// it originated, it returns the durably-recorded seen receipts (one entry per member
// who has seen it, so a group message can report each). This recovers a 'seen'
// receipt that was dropped because the sender was offline at the moment a member
// opened it.
func (h *Handlers) seenCheck(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var req seenCheckRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// Bound the query the same way the client bounds what it asks about.
	const maxIDs = 500
	if len(req.IDs) > maxIDs {
		req.IDs = req.IDs[:maxIDs]
	}
	rows, err := h.Relay.SeenFor(r.Context(), uid, req.IDs)
	if err != nil {
		slog.Error("seen check failed", "err", err, "user", uid)
		httpx.Error(w, http.StatusInternalServerError, "could not load seen")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, s := range rows {
		out = append(out, map[string]any{"messageId": s.MsgID, "recipient": s.Recipient, "at": s.SeenMs})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"seen": out})
}
