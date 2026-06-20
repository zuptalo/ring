package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"

	"ring/server/internal/store"
	"ring/server/internal/ws"
)

// fakeConnNotifier records which users got a content-free connection wake
// (NotifyConn), so handler tests can assert an offline peer is pushed.
type fakeConnNotifier struct {
	mu   sync.Mutex
	conn []string
}

func (f *fakeConnNotifier) Notify(context.Context, string)     {}
func (f *fakeConnNotifier) NotifyCall(context.Context, string) {}
func (f *fakeConnNotifier) NotifyConn(_ context.Context, userID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.conn = append(f.conn, userID)
}
func (f *fakeConnNotifier) woke(userID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, u := range f.conn {
		if u == userID {
			return true
		}
	}
	return false
}

// fakeConn is a minimal in-memory ConnectionsStore for handler tests. It records
// the last withdraw so the test can assert the handler called the store correctly.
type fakeConn struct {
	withdrawn map[[2]string]bool // (requester,target) -> true
}

func newFakeConn() *fakeConn { return &fakeConn{withdrawn: map[[2]string]bool{}} }

func (c *fakeConn) Connected(_ context.Context, _, _ string) (bool, error)          { return false, nil }
func (c *fakeConn) ConnectionState(_ context.Context, _, _ string) (string, error)  { return "", nil }
func (c *fakeConn) RequestConnection(_ context.Context, _, _ string) (string, error) {
	return "pending", nil
}
func (c *fakeConn) AcceptConnection(_ context.Context, _, _ string) error        { return nil }
func (c *fakeConn) RejectConnection(_ context.Context, _, _ string, _ bool) error { return nil }
func (c *fakeConn) WithdrawConnection(_ context.Context, requester, target string) error {
	c.withdrawn[[2]string{requester, target}] = true
	return nil
}
func (c *fakeConn) IncomingRequests(_ context.Context, _ string) ([]store.ConnectionReq, error) {
	return nil, nil
}
func (c *fakeConn) OutgoingRequests(_ context.Context, _ string) ([]store.ConnectionReq, error) {
	return nil, nil
}

// newConnTestServer builds the router with a real fake store (for register/auth)
// plus a fake Connections store, so the connection handlers can be exercised.
func newConnTestServer(conn ConnectionStore) (http.Handler, *fakeStore) {
	srv, as, _ := newConnTestServerN(conn, nil)
	return srv, as
}

// newConnTestServerN is newConnTestServer with an injectable Notifier, so a test
// can assert friend-request events wake an offline peer (NotifyConn).
func newConnTestServerN(conn ConnectionStore, notifier ws.Notifier) (http.Handler, *fakeStore, ws.Notifier) {
	as := newFakeStore()
	srv := NewRouter(&Handlers{
		Store:          as,
		Directory:      as,
		Contacts:       as,
		Blocks:         as,
		Relay:          as,
		Connections:    conn,
		Hub:            ws.NewHub(),
		Notifier:       notifier,
		Keys:           newFakeKeysStore(),
		Blobs:          newFakeBlobStore(),
		Sync:           newFakeSyncStore(),
		Push:           newFakePushStore(),
		Invites:        as,
		PublicURL:      "https://ring.example",
		VapidPublicKey: "VAPID_PUB",
	}, []string{"http://localhost:5173"})
	return srv, as, notifier
}

// TestConnectionEventsWakeOfflinePeer verifies request/accept/reject each fire a
// content-free push (NotifyConn) to the affected peer, so an offline user learns
// of the friend-request lifecycle event (FR-008/009/010).
func TestConnectionEventsWakeOfflinePeer(t *testing.T) {
	notif := &fakeConnNotifier{}
	srv, _, _ := newConnTestServerN(newFakeConn(), notif)

	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")

	// alice → request bob: bob is woken.
	if rr := do(t, srv, http.MethodPost, "/v1/connections/request", tokA, `{"target":"`+bobID+`"}`); rr.Code != http.StatusOK {
		t.Fatalf("request status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if !notif.woke(bobID) {
		t.Errorf("request: expected bob (%s) to be woken via NotifyConn", bobID)
	}

	// bob accepts alice's request: alice (the requester) is woken.
	if rr := do(t, srv, http.MethodPost, "/v1/connections/accept", tokB, `{"requester":"`+aliceID+`"}`); rr.Code != http.StatusNoContent {
		t.Fatalf("accept status = %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
	if !notif.woke(aliceID) {
		t.Errorf("accept: expected alice (%s) to be woken via NotifyConn", aliceID)
	}
}

// TestRejectWakesRequester verifies a rejection also pushes the requester (FR-010).
func TestRejectWakesRequester(t *testing.T) {
	notif := &fakeConnNotifier{}
	srv, _, _ := newConnTestServerN(newFakeConn(), notif)

	_, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, _, _ := registerNamed(t, srv, "bob")

	if rr := do(t, srv, http.MethodPost, "/v1/connections/reject", tokB, `{"requester":"`+aliceID+`"}`); rr.Code != http.StatusNoContent {
		t.Fatalf("reject status = %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
	if !notif.woke(aliceID) {
		t.Errorf("reject: expected alice (%s) to be woken via NotifyConn", aliceID)
	}
}

func TestWithdrawConnectionRemovesPendingRequest(t *testing.T) {
	conn := newFakeConn()
	srv, _ := newConnTestServer(conn)

	tokA, _, _ := registerNamed(t, srv, "alice")
	_, bobID, _ := registerNamed(t, srv, "bob")

	rr := do(t, srv, http.MethodPost, "/v1/connections/withdraw", tokA, `{"target":"`+bobID+`"}`)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("withdraw status = %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
	// The handler must call WithdrawConnection(requester=alice, target=bob).
	aliceID := registerLookup(t, srv, tokA)
	if !conn.withdrawn[[2]string{aliceID, bobID}] {
		t.Fatalf("WithdrawConnection not called with (alice,bob); recorded=%v", conn.withdrawn)
	}
}

func TestWithdrawConnectionRejectsBadTarget(t *testing.T) {
	conn := newFakeConn()
	srv, _ := newConnTestServer(conn)
	tokA, _, _ := registerNamed(t, srv, "alice")

	// Not a UUID.
	if rr := do(t, srv, http.MethodPost, "/v1/connections/withdraw", tokA, `{"target":"nope"}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("bad target status = %d, want 400", rr.Code)
	}
	// Self-target is rejected.
	self := registerLookup(t, srv, tokA)
	if rr := do(t, srv, http.MethodPost, "/v1/connections/withdraw", tokA, `{"target":"`+self+`"}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("self target status = %d, want 400", rr.Code)
	}
}

func TestWithdrawConnectionRequiresAuth(t *testing.T) {
	conn := newFakeConn()
	srv, _ := newConnTestServer(conn)
	if rr := do(t, srv, http.MethodPost, "/v1/connections/withdraw", "", `{"target":"00000000-0000-0000-0000-000000000009"}`); rr.Code != http.StatusUnauthorized {
		t.Fatalf("no-token status = %d, want 401", rr.Code)
	}
}

// registerLookup returns the userID behind a token via /v1/me.
func registerLookup(t *testing.T, srv http.Handler, token string) string {
	t.Helper()
	rr := do(t, srv, http.MethodGet, "/v1/me", token, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("/v1/me status = %d", rr.Code)
	}
	var me struct {
		UserID string `json:"userId"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode me: %v", err)
	}
	return me.UserID
}
