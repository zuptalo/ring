package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ring/server/internal/ws"
)

func TestServerConfigIsPublic(t *testing.T) {
	srv := newTestServer()
	rr := httptest.NewRecorder()
	// No auth header - /v1/config must be reachable without a token.
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/config", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("config status = %d, want 200", rr.Code)
	}
	var got map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["publicUrl"] != "https://ring.example" || got["vapidPublicKey"] != "VAPID_PUB" {
		t.Fatalf("unexpected config: %+v", got)
	}
}

// /v1/config advertises this build's release notes (public, non-secret build
// metadata) so the PWA can show a per-user "what's new" between versions.
func TestServerConfigIncludesReleaseNotes(t *testing.T) {
	notes := []ReleaseNote{
		{SHA: "abc123", Subject: "fix(sync): stabilize message status"},
		{SHA: "def456", Subject: "feat: add full-text search"},
	}
	srv := NewRouter(&Handlers{
		Hub:            ws.NewHub(),
		PublicURL:      "https://ring.example",
		VapidPublicKey: "VAPID_PUB",
		ReleaseNotes:   notes,
	}, []string{"http://localhost:5173"})

	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/config", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("config status = %d, want 200", rr.Code)
	}
	var got struct {
		Notes []ReleaseNote `json:"notes"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Notes) != 2 || got.Notes[0].SHA != "abc123" || got.Notes[1].Subject != "feat: add full-text search" {
		t.Fatalf("unexpected notes: %+v", got.Notes)
	}
}

// When unset, notes serialize as an empty array (not null) so the client can treat
// it uniformly.
func TestServerConfigReleaseNotesEmptyWhenUnset(t *testing.T) {
	srv := newTestServer() // no ReleaseNotes
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/config", nil))
	var got map[string]json.RawMessage
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if string(got["notes"]) != "[]" {
		t.Fatalf("notes = %s, want []", got["notes"])
	}
}
