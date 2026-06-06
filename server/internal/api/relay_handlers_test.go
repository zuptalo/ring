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
