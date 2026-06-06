package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func statusesOf(t *testing.T, rr *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var m struct {
		Statuses map[string]string `json:"statuses"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode statuses: %v (body=%s)", err, rr.Body.String())
	}
	return m.Statuses
}

func TestUserStatusesActiveTerminatedUnknown(t *testing.T) {
	srv := newTestServer()
	tokA, idA := registerUser(t, srv)
	tokB, idB := registerUser(t, srv)
	const unknown = "00000000-0000-0000-0000-999999999999"

	body := `{"ids":["` + idA + `","` + idB + `","` + unknown + `"]}`
	st := statusesOf(t, do(t, srv, http.MethodPost, "/v1/status", tokA, body))
	if st[idA] != "active" || st[idB] != "active" || st[unknown] != "unknown" {
		t.Fatalf("statuses before termination = %+v", st)
	}

	// B deletes (terminates) their account.
	if rr := do(t, srv, http.MethodDelete, "/v1/me", tokB, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("delete B status = %d", rr.Code)
	}
	st = statusesOf(t, do(t, srv, http.MethodPost, "/v1/status", tokA, body))
	if st[idA] != "active" || st[idB] != "terminated" {
		t.Fatalf("statuses after termination = %+v", st)
	}
}

func TestBlockHidesKeyBundleAndListsBlocks(t *testing.T) {
	srv := newTestServer()
	tokA, idA := registerUser(t, srv)
	tokB, idB := registerUser(t, srv)

	// A publishes a bundle so B can normally fetch it.
	if rr := do(t, srv, http.MethodPut, "/v1/keys", tokA, publishBody); rr.Code != http.StatusOK {
		t.Fatalf("A publish keys = %d", rr.Code)
	}
	if rr := do(t, srv, http.MethodGet, "/v1/keys/"+idA, tokB, ""); rr.Code != http.StatusOK {
		t.Fatalf("B fetch A before block = %d, want 200", rr.Code)
	}

	// A blocks B → B can no longer fetch A's bundle (404, can't re-add).
	if rr := do(t, srv, http.MethodPut, "/v1/blocks/"+idB, tokA, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("A block B = %d", rr.Code)
	}
	if rr := do(t, srv, http.MethodGet, "/v1/keys/"+idA, tokB, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("B fetch A while blocked = %d, want 404", rr.Code)
	}

	// GET /v1/blocks lists B for A.
	var lb struct {
		Blocked []string `json:"blocked"`
	}
	rr := do(t, srv, http.MethodGet, "/v1/blocks", tokA, "")
	_ = json.Unmarshal(rr.Body.Bytes(), &lb)
	if len(lb.Blocked) != 1 || lb.Blocked[0] != idB {
		t.Fatalf("blocks list = %+v, want [%s]", lb.Blocked, idB)
	}

	// Unblock restores B's access.
	if rr := do(t, srv, http.MethodDelete, "/v1/blocks/"+idB, tokA, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("A unblock B = %d", rr.Code)
	}
	if rr := do(t, srv, http.MethodGet, "/v1/keys/"+idA, tokB, ""); rr.Code != http.StatusOK {
		t.Fatalf("B fetch A after unblock = %d, want 200", rr.Code)
	}
}
