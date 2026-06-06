package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
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
