package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func listBlocked(t *testing.T, srv http.Handler, tok string) []string {
	t.Helper()
	rr := do(t, srv, http.MethodGet, "/v1/blocks", tok, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list blocks status = %d, want 200", rr.Code)
	}
	var body struct {
		Blocked []string `json:"blocked"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body.Blocked
}

func TestBlockUnblockLifecycle(t *testing.T) {
	srv := newTestServer()
	aliceTok, _, _ := registerNamed(t, srv, "alice")
	_, bobID, _ := registerNamed(t, srv, "bob")

	if got := listBlocked(t, srv, aliceTok); len(got) != 0 {
		t.Fatalf("fresh account blocked = %v, want empty", got)
	}

	// Block bob → 204, then he's in the list.
	if rr := do(t, srv, http.MethodPut, "/v1/blocks/"+bobID, aliceTok, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("block status = %d, want 204", rr.Code)
	}
	if got := listBlocked(t, srv, aliceTok); len(got) != 1 || got[0] != bobID {
		t.Fatalf("after block = %v, want [%s]", got, bobID)
	}

	// Blocking again is idempotent (still 204, no duplicate).
	if rr := do(t, srv, http.MethodPut, "/v1/blocks/"+bobID, aliceTok, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("re-block status = %d, want 204", rr.Code)
	}
	if got := listBlocked(t, srv, aliceTok); len(got) != 1 {
		t.Fatalf("after re-block = %v, want one entry", got)
	}

	// Unblock → 204, gone from the list.
	if rr := do(t, srv, http.MethodDelete, "/v1/blocks/"+bobID, aliceTok, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("unblock status = %d, want 204", rr.Code)
	}
	if got := listBlocked(t, srv, aliceTok); len(got) != 0 {
		t.Fatalf("after unblock = %v, want empty", got)
	}
}

func TestBlockRejectsSelfAndBadID(t *testing.T) {
	srv := newTestServer()
	tok, selfID, _ := registerNamed(t, srv, "alice")

	if rr := do(t, srv, http.MethodPut, "/v1/blocks/"+selfID, tok, ""); rr.Code != http.StatusBadRequest {
		t.Fatalf("self-block status = %d, want 400", rr.Code)
	}
	if rr := do(t, srv, http.MethodPut, "/v1/blocks/not-a-uuid", tok, ""); rr.Code != http.StatusBadRequest {
		t.Fatalf("bad-id block status = %d, want 400", rr.Code)
	}
}

func TestBlockRequiresAuth(t *testing.T) {
	srv := newTestServer()
	for _, tc := range []struct {
		method, path string
	}{
		{http.MethodGet, "/v1/blocks"},
		{http.MethodPut, "/v1/blocks/11111111-1111-4111-8111-111111111111"},
		{http.MethodDelete, "/v1/blocks/11111111-1111-4111-8111-111111111111"},
	} {
		if rr := do(t, srv, tc.method, tc.path, "", ""); rr.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s without token = %d, want 401", tc.method, tc.path, rr.Code)
		}
	}
}
