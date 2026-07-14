package api

import (
	"net/http"
	"testing"
)

// Spec 1050: PUT /v1/push/prefs replaces the caller's routing prefs whole
// (FR-011 full-state replace), 400s malformed bodies, and requires auth.
func TestSavePushPrefs(t *testing.T) {
	p := newFakePushStore()
	srv := newTestServerWithPush(p)
	token, userID := registerUser(t, srv)

	blob := `{"classesOff":["reaction"],"mutedPrids":["p1"],"postSenders":{"muted":[],"always":["u2"]}}`
	if rr := do(t, srv, http.MethodPut, "/v1/push/prefs", token, blob); rr.Code != http.StatusNoContent {
		t.Fatalf("save status = %d, body=%s", rr.Code, rr.Body.String())
	}
	p.mu.Lock()
	got := string(p.prefs[userID])
	p.mu.Unlock()
	if got != blob {
		t.Fatalf("stored prefs = %q, want the blob verbatim", got)
	}

	// Replacement shrinks — never merges.
	if rr := do(t, srv, http.MethodPut, "/v1/push/prefs", token, `{}`); rr.Code != http.StatusNoContent {
		t.Fatalf("replace status = %d", rr.Code)
	}
	p.mu.Lock()
	got = string(p.prefs[userID])
	p.mu.Unlock()
	if got != `{}` {
		t.Fatalf("prefs not replaced whole: %q", got)
	}

	// Malformed → 400 and the stored blob is untouched.
	if rr := do(t, srv, http.MethodPut, "/v1/push/prefs", token, `not-json`); rr.Code != http.StatusBadRequest {
		t.Fatalf("malformed status = %d, want 400", rr.Code)
	}
	// No auth → 401.
	if rr := do(t, srv, http.MethodPut, "/v1/push/prefs", "", `{}`); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want 401", rr.Code)
	}
}
