package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

// newTestServerWithTurn builds a router with calling enabled and the given
// optional stun advertisement — the two knobs turnCredentials cares about.
func newTestServerWithTurn(stunURLs []string) http.Handler {
	as := newFakeStore()
	return NewRouter(&Handlers{
		Store:            as,
		Directory:        as,
		Contacts:         as,
		Blocks:           as,
		Relay:            as,
		Hub:              nil,
		Keys:             newFakeKeysStore(),
		Blobs:            newFakeBlobStore(),
		Sync:             newFakeSyncStore(),
		Push:             newFakePushStore(),
		Invites:          as,
		PublicURL:        "https://ring.example",
		CallsEnabled:     true,
		TurnSharedSecret: "test-shared-secret",
		TurnURLs:         []string{"turns:ring.example:443?transport=tcp"},
		StunURLs:         stunURLs,
	}, []string{"http://localhost:5173"})
}

// iceServerEntry mirrors one iceServers element loosely so tests can assert
// which keys are present (the stun entry must carry no credentials at all).
type iceServerEntry map[string]any

func decodeTurnResponse(t *testing.T, body []byte) (entries []iceServerEntry, ttl int) {
	t.Helper()
	var resp struct {
		IceServers []iceServerEntry `json:"iceServers"`
		TTL        int              `json:"ttl"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode: %v (body=%s)", err, body)
	}
	return resp.IceServers, resp.TTL
}

func TestTurnCredentialsDisabled(t *testing.T) {
	srv := newTestServer() // CallsEnabled defaults to false
	token, _ := registerUser(t, srv)
	rr := do(t, srv, http.MethodGet, "/v1/turn-credentials", token, "")
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rr.Code)
	}
}

func TestTurnCredentialsUnauthenticated(t *testing.T) {
	srv := newTestServerWithTurn(nil)
	rr := do(t, srv, http.MethodGet, "/v1/turn-credentials", "", "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestTurnCredentialsTurnOnly(t *testing.T) {
	srv := newTestServerWithTurn(nil)
	token, _ := registerUser(t, srv)
	rr := do(t, srv, http.MethodGet, "/v1/turn-credentials", token, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
	entries, ttl := decodeTurnResponse(t, rr.Body.Bytes())
	if ttl != 3600 {
		t.Fatalf("ttl = %d, want 3600", ttl)
	}
	// Without a configured stun advertisement the response keeps its historic
	// shape: exactly one credentialed relay entry (old-client compatibility).
	if len(entries) != 1 {
		t.Fatalf("iceServers count = %d, want 1 (%v)", len(entries), entries)
	}
	cred := entries[0]
	if u, _ := cred["username"].(string); u == "" {
		t.Fatalf("credentialed entry missing username: %v", cred)
	}
	if c, _ := cred["credential"].(string); c == "" {
		t.Fatalf("credentialed entry missing credential: %v", cred)
	}
}

func TestTurnCredentialsWithStun(t *testing.T) {
	srv := newTestServerWithTurn([]string{"stun:ring.example:3478"})
	token, _ := registerUser(t, srv)
	rr := do(t, srv, http.MethodGet, "/v1/turn-credentials", token, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
	}
	entries, _ := decodeTurnResponse(t, rr.Body.Bytes())
	if len(entries) != 2 {
		t.Fatalf("iceServers count = %d, want 2 (%v)", len(entries), entries)
	}
	// First entry: the credentialed relay, unchanged.
	cred := entries[0]
	if u, _ := cred["username"].(string); u == "" {
		t.Fatalf("credentialed entry missing username: %v", cred)
	}
	// Second entry: the stun advertisement — urls only, NO credentials (STUN
	// Binding is unauthenticated address discovery).
	stun := entries[1]
	urls, ok := stun["urls"].([]any)
	if !ok || len(urls) != 1 || urls[0] != "stun:ring.example:3478" {
		t.Fatalf("stun urls = %v, want [stun:ring.example:3478]", stun["urls"])
	}
	if _, has := stun["username"]; has {
		t.Fatalf("stun entry must not carry a username: %v", stun)
	}
	if _, has := stun["credential"]; has {
		t.Fatalf("stun entry must not carry a credential: %v", stun)
	}
}
