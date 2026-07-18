package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"ring/server/internal/ws"
)

func TestRelayPendingAndAck(t *testing.T) {
	as := newFakeStore()
	srv := NewRouter(&Handlers{
		Store: as, Directory: as, Blocks: as, Relay: as, Hub: ws.NewHub(),
		Keys: newFakeKeysStore(), Blobs: newFakeBlobStore(),
		Sync: newFakeSyncStore(), Push: newFakePushStore(), Invites: as,
		PublicURL: "https://ring.example",
	}, []string{"http://localhost:5173"})

	tok, uid, code := registerNamed(t, srv, "relayuser")
	if code != http.StatusOK {
		t.Fatalf("register = %d", code)
	}

	// Queue two frames for the user (as the relay would on an offline delivery).
	_ = as.EnqueueRelay(context.Background(), uid, "00000000-0000-0000-0000-000000000999", "m1",
		[]byte(`{"t":"msg","id":"m1","from":"sndr","ciphertext":{"v":1}}`))
	_ = as.EnqueueRelay(context.Background(), uid, "00000000-0000-0000-0000-000000000999", "m2",
		[]byte(`{"t":"msg","id":"m2","from":"sndr","ciphertext":{"v":1}}`))

	// GET /v1/relay/pending returns both frames, oldest first.
	rr := do(t, srv, http.MethodGet, "/v1/relay/pending", tok, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("pending status = %d", rr.Code)
	}
	var got struct {
		Frames []json.RawMessage `json:"frames"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if len(got.Frames) != 2 {
		t.Fatalf("pending frames = %d, want 2 (%s)", len(got.Frames), rr.Body.String())
	}

	// Ack one → it's removed; the other remains.
	if rr := do(t, srv, http.MethodPost, "/v1/relay/ack", tok, `{"ids":["m1"]}`); rr.Code != http.StatusNoContent {
		t.Fatalf("ack status = %d", rr.Code)
	}
	rr = do(t, srv, http.MethodGet, "/v1/relay/pending", tok, "")
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if len(got.Frames) != 1 {
		t.Fatalf("after ack frames = %d, want 1", len(got.Frames))
	}

	// Acking an already-gone id is a no-op (idempotent).
	if rr := do(t, srv, http.MethodPost, "/v1/relay/ack", tok, `{"ids":["m1"]}`); rr.Code != http.StatusNoContent {
		t.Fatalf("idempotent ack status = %d", rr.Code)
	}
}

// TestRelayStatus proves GET /v1/relay/status (spec 2043) reports the queued count
// and oldest-frame age with NO side effects, and returns a null oldest for an empty
// queue. It powers the client zombie self-heal without dequeuing or emitting receipts.
func TestRelayStatus(t *testing.T) {
	as := newFakeStore()
	srv := NewRouter(&Handlers{
		Store: as, Directory: as, Blocks: as, Relay: as, Hub: ws.NewHub(),
		Keys: newFakeKeysStore(), Blobs: newFakeBlobStore(),
		Sync: newFakeSyncStore(), Push: newFakePushStore(), Invites: as,
		PublicURL: "https://ring.example",
	}, []string{"http://localhost:5173"})

	tok, uid, code := registerNamed(t, srv, "statususer")
	if code != http.StatusOK {
		t.Fatalf("register = %d", code)
	}

	// Empty queue → count 0 and a NULL oldest (never an epoch-0 timestamp).
	rr := do(t, srv, http.MethodGet, "/v1/relay/status", tok, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	var got struct {
		OldestQueuedAtMs *int64 `json:"oldestQueuedAtMs"`
		Count            int    `json:"count"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got.Count != 0 || got.OldestQueuedAtMs != nil {
		t.Fatalf("empty status = %+v, want count 0 + null oldest (%s)", got, rr.Body.String())
	}

	// Queue two frames, the older one stamped in the past.
	as.mu.Lock()
	as.relay = map[string][]relayRow{
		uid: {
			{seq: 1, sender: "00000000-0000-0000-0000-000000000999", msgID: "m1", createdMs: 1_000_000},
			{seq: 2, sender: "00000000-0000-0000-0000-000000000999", msgID: "m2", createdMs: 2_000_000},
		},
	}
	as.mu.Unlock()

	rr = do(t, srv, http.MethodGet, "/v1/relay/status", tok, "")
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got.Count != 2 {
		t.Fatalf("status count = %d, want 2", got.Count)
	}
	if got.OldestQueuedAtMs == nil || *got.OldestQueuedAtMs != 1_000_000 {
		t.Fatalf("status oldest = %v, want 1000000", got.OldestQueuedAtMs)
	}

	// No side effect: the frames are still queued (relay/status never dequeues).
	pend := do(t, srv, http.MethodGet, "/v1/relay/pending", tok, "")
	var pg struct {
		Frames []json.RawMessage `json:"frames"`
	}
	_ = json.Unmarshal(pend.Body.Bytes(), &pg)
	if len(pg.Frames) != 2 {
		t.Fatalf("after status, pending = %d, want 2 (status must not dequeue)", len(pg.Frames))
	}
}

// TestDeliveriesReconcile proves the WS11 sender-side reconcile: after the recipient
// acks (recording a durable delivery), the SENDER can recover the 'delivered' state
// for its still-'sent' messages even though the live receipt may have been dropped.
func TestDeliveriesReconcile(t *testing.T) {
	as := newFakeStore()
	srv := NewRouter(&Handlers{
		Store: as, Directory: as, Blocks: as, Relay: as, Hub: ws.NewHub(),
		Keys: newFakeKeysStore(), Blobs: newFakeBlobStore(),
		Sync: newFakeSyncStore(), Push: newFakePushStore(), Invites: as,
		PublicURL: "https://ring.example",
	}, []string{"http://localhost:5173"})

	senderTok, senderUID, _ := registerNamed(t, srv, "wssender")
	recipTok, recipUID, _ := registerNamed(t, srv, "wsrecip")

	// Sender's message is relay-queued for the (offline) recipient.
	_ = as.EnqueueRelay(context.Background(), recipUID, senderUID, "mx",
		[]byte(`{"t":"msg","id":"mx","from":"`+senderUID+`","ciphertext":{"v":1}}`))

	// Recipient drains + acks → server records the delivery durably (the live
	// receipt to the sender is irrelevant here; it may have been dropped).
	if rr := do(t, srv, http.MethodPost, "/v1/relay/ack", recipTok, `{"ids":["mx"]}`); rr.Code != http.StatusNoContent {
		t.Fatalf("recipient ack = %d", rr.Code)
	}

	// Sender reconciles on reconnect: asks which of its ids were delivered.
	rr := do(t, srv, http.MethodPost, "/v1/deliveries/check", senderTok, `{"ids":["mx","never"]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("deliveries check = %d (%s)", rr.Code, rr.Body.String())
	}
	var got struct {
		Delivered []struct {
			MessageID string `json:"messageId"`
			Recipient string `json:"recipient"`
			At        int64  `json:"at"`
		} `json:"delivered"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if len(got.Delivered) != 1 || got.Delivered[0].MessageID != "mx" || got.Delivered[0].Recipient != recipUID {
		t.Fatalf("delivered = %+v, want exactly mx -> %s", got.Delivered, recipUID)
	}

	// Scoped to the caller: the recipient (not the sender) sees none of the sender's
	// deliveries for the same id.
	rr = do(t, srv, http.MethodPost, "/v1/deliveries/check", recipTok, `{"ids":["mx"]}`)
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if len(got.Delivered) != 0 {
		t.Fatalf("cross-user delivered = %+v, want none", got.Delivered)
	}
}

// TestSeenReconcile proves the spec-1010 sender-side SEEN reconcile (the twin of
// TestDeliveriesReconcile): once a member's 'seen' is durably recorded, the SENDER
// can recover it via POST /v1/seen/check even if the live receipt was dropped while
// the sender was offline — and the lookup is scoped to the querying sender.
func TestSeenReconcile(t *testing.T) {
	as := newFakeStore()
	srv := NewRouter(&Handlers{
		Store: as, Directory: as, Blocks: as, Relay: as, Hub: ws.NewHub(),
		Keys: newFakeKeysStore(), Blobs: newFakeBlobStore(),
		Sync: newFakeSyncStore(), Push: newFakePushStore(), Invites: as,
		PublicURL: "https://ring.example",
	}, []string{"http://localhost:5173"})

	senderTok, senderUID, _ := registerNamed(t, srv, "seensender")
	recipTok, recipUID, _ := registerNamed(t, srv, "seenrecip")

	// A member's 'seen' for the sender's message is recorded durably (as the relay's
	// receipt case does when it relays a client 'seen').
	_ = as.RecordSeen(context.Background(), senderUID, recipUID, "mx")

	// Sender reconciles on reconnect: asks which of its ids have been seen.
	rr := do(t, srv, http.MethodPost, "/v1/seen/check", senderTok, `{"ids":["mx","never"]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("seen check = %d (%s)", rr.Code, rr.Body.String())
	}
	var got struct {
		Seen []struct {
			MessageID string `json:"messageId"`
			Recipient string `json:"recipient"`
			At        int64  `json:"at"`
		} `json:"seen"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if len(got.Seen) != 1 || got.Seen[0].MessageID != "mx" || got.Seen[0].Recipient != recipUID {
		t.Fatalf("seen = %+v, want exactly mx -> %s", got.Seen, recipUID)
	}

	// Scoped to the caller: the recipient sees none of the sender's seen rows.
	rr = do(t, srv, http.MethodPost, "/v1/seen/check", recipTok, `{"ids":["mx"]}`)
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if len(got.Seen) != 0 {
		t.Fatalf("cross-user seen = %+v, want none", got.Seen)
	}
}
