package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
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

func (f *fakeConnNotifier) Notify(context.Context, string)                     {}
func (f *fakeConnNotifier) NotifyCall(context.Context, string)                 {}
func (f *fakeConnNotifier) NotifyPost(context.Context, string)                 {}
func (f *fakeConnNotifier) NotifyPostActivity(context.Context, string, string) {}
func (f *fakeConnNotifier) NotifyConn(_ context.Context, userID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.conn = append(f.conn, userID)
}
func (f *fakeConnNotifier) woke(userID string) bool {
	return f.wokeCount(userID) > 0
}
func (f *fakeConnNotifier) wokeCount(userID string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, u := range f.conn {
		if u == userID {
			n++
		}
	}
	return n
}

// fakeConn is a minimal in-memory ConnectionsStore for handler tests. It records
// the last withdraw so the test can assert the handler called the store correctly.
type fakeConn struct {
	withdrawn map[[2]string]bool // (requester,target) -> true
	rejected  map[[2]string]bool // (requester,target) declined → suppressed (FR-007)
	outgoing  []store.ConnectionReq // what OutgoingRequests returns (spec 1040)
}

func newFakeConn() *fakeConn {
	return &fakeConn{withdrawn: map[[2]string]bool{}, rejected: map[[2]string]bool{}}
}

func (c *fakeConn) Connected(_ context.Context, _, _ string) (bool, error)         { return false, nil }
func (c *fakeConn) ConnectionState(_ context.Context, _, _ string) (string, error) { return "", nil }

// RequestConnection models FR-007: once requester→target was declined it stays
// "rejected" (the cooldown is always "active" in tests since no wall-clock passes), so
// the handler won't re-notify the target. Otherwise it's a fresh pending request.
func (c *fakeConn) RequestConnection(_ context.Context, requester, target string) (string, error) {
	if c.rejected[[2]string{requester, target}] {
		return "rejected", nil
	}
	return "pending", nil
}
func (c *fakeConn) AcceptConnection(_ context.Context, _, _ string) error { return nil }
func (c *fakeConn) RejectConnection(_ context.Context, target, requester string, _ bool) error {
	c.rejected[[2]string{requester, target}] = true
	return nil
}
func (c *fakeConn) WithdrawConnection(_ context.Context, requester, target string) error {
	c.withdrawn[[2]string{requester, target}] = true
	return nil
}
func (c *fakeConn) IncomingRequests(_ context.Context, _ string) ([]store.ConnectionReq, error) {
	return nil, nil
}
func (c *fakeConn) OutgoingRequests(_ context.Context, _ string) ([]store.ConnectionReq, error) {
	// Models the real store's contract (spec 1040): pending + rejected always,
	// accepted only while fresh (updated within 24h) — the SW's accepted-note
	// window. Tests inject rows via `outgoing`.
	return c.outgoing, nil
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

// TestFriendRequestSuppressedAfterDecline verifies FR-007: once a request is declined,
// a repeat request from the same sender is suppressed (state stays "rejected") and the
// target is NOT notified again, so a declined sender cannot harass via re-requests.
func TestFriendRequestSuppressedAfterDecline(t *testing.T) {
	notif := &fakeConnNotifier{}
	srv, _, _ := newConnTestServerN(newFakeConn(), notif)

	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")

	// alice → request bob (pending): bob is woken once.
	if rr := do(t, srv, http.MethodPost, "/v1/connections/request", tokA, `{"target":"`+bobID+`"}`); rr.Code != http.StatusOK {
		t.Fatalf("request status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	// bob declines alice (no block).
	if rr := do(t, srv, http.MethodPost, "/v1/connections/reject", tokB, `{"requester":"`+aliceID+`"}`); rr.Code != http.StatusNoContent {
		t.Fatalf("reject status = %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
	wokeBefore := notif.wokeCount(bobID)

	// alice re-requests bob: suppressed → state "rejected", bob NOT woken again.
	rr := do(t, srv, http.MethodPost, "/v1/connections/request", tokA, `{"target":"`+bobID+`"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("re-request status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if got := rr.Body.String(); !strings.Contains(got, `"rejected"`) {
		t.Errorf("re-request after decline: state = %s, want rejected (suppressed)", got)
	}
	if after := notif.wokeCount(bobID); after != wokeBefore {
		t.Errorf("re-request after decline woke bob again (%d → %d); FR-007 expects suppression", wokeBefore, after)
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

// TestListConnectionsPassesAcceptedOutcomeThrough (spec 1040 US3): the outgoing
// list carries accepted/rejected states verbatim to the requester — the service
// worker's "accepted your friend request" note is built from exactly this
// payload, and a handler-side filter would silently revive the "New friend
// request" mis-copy bug. (The store-side recency window — accepted rows only
// while updated within 24h — lives in the SQL and is covered by the e2e stack's
// real database.)
func TestListConnectionsPassesAcceptedOutcomeThrough(t *testing.T) {
	conn := newFakeConn()
	srv, _ := newConnTestServer(conn)
	tok, uid, _ := registerNamed(t, srv, "alice")

	conn.outgoing = []store.ConnectionReq{
		{Requester: uid, Target: "friend-1", State: "accepted", UpdatedMs: 1000},
		{Requester: uid, Target: "friend-2", State: "rejected", UpdatedMs: 900},
		{Requester: uid, Target: "friend-3", State: "pending", UpdatedMs: 800},
	}

	rr := do(t, srv, http.MethodGet, "/v1/connections", tok, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Outgoing []struct {
			Target string `json:"target"`
			State  string `json:"state"`
		} `json:"outgoing"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	got := map[string]string{}
	for _, o := range resp.Outgoing {
		got[o.Target] = o.State
	}
	want := map[string]string{"friend-1": "accepted", "friend-2": "rejected", "friend-3": "pending"}
	for target, state := range want {
		if got[target] != state {
			t.Errorf("outgoing[%s] state = %q, want %q (full: %v)", target, got[target], state, got)
		}
	}
	if strings.Contains(rr.Body.String(), "friend-1") && got["friend-1"] != "accepted" {
		t.Errorf("accepted row must pass through with its state intact")
	}
}
