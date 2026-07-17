package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestHealthOK(t *testing.T) {
	srv := newTestServer()
	rr := do(t, srv, http.MethodGet, "/healthz", "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" || body["db"] != "up" {
		t.Fatalf("body = %v, want status=ok db=up", body)
	}
}
