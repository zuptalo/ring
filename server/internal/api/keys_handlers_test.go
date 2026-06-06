package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"ring/server/internal/store"
)

// fakeKeysStore is an in-memory KeysStore for handler tests (no database).
type fakeKeysStore struct {
	mu       sync.Mutex
	identity map[string]store.PublicBundle    // userID -> identity + spk
	pool     map[string][]store.OneTimePreKey // userID -> FIFO one-time prekeys
}

func newFakeKeysStore() *fakeKeysStore {
	return &fakeKeysStore{identity: map[string]store.PublicBundle{}, pool: map[string][]store.OneTimePreKey{}}
}

func (f *fakeKeysStore) PublishBundle(_ context.Context, userID string, b store.PublicBundle) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.identity[userID] = store.PublicBundle{EdPub: b.EdPub, XPub: b.XPub, SignedPreKey: b.SignedPreKey}
	f.pool[userID] = append(f.pool[userID], b.OneTimePreKeys...)
	return nil
}

func (f *fakeKeysStore) AddOneTimePreKeys(_ context.Context, userID string, keys []store.OneTimePreKey) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pool[userID] = append(f.pool[userID], keys...)
	return nil
}

func (f *fakeKeysStore) OneTimePreKeyCount(_ context.Context, userID string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.pool[userID]), nil
}

func (f *fakeKeysStore) EdPub(_ context.Context, userID string) (string, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.identity[userID]
	if !ok {
		return "", false, nil
	}
	return id.EdPub, true, nil
}

func (f *fakeKeysStore) FetchBundle(_ context.Context, target string) (*store.PeerBundle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.identity[target]
	if !ok {
		return nil, store.ErrNoBundle
	}
	pb := &store.PeerBundle{UserID: target, EdPub: id.EdPub, XPub: id.XPub, SignedPreKey: id.SignedPreKey}
	if pool := f.pool[target]; len(pool) > 0 {
		otk := pool[0]
		f.pool[target] = pool[1:]
		pb.OneTimePreKey = &otk
	}
	return pb, nil
}

// testUserSeq gives each registerUser call a unique username (usernames are
// network-unique, so two registrations can't share one).
var testUserSeq atomic.Int64

// registerUser drives the real register handler and returns (token, userID).
func registerUser(t *testing.T, srv http.Handler) (string, string) {
	t.Helper()
	rr := httptest.NewRecorder()
	body := fmt.Sprintf(`{"invitationCode":"RING01","username":"user%d"}`, testUserSeq.Add(1))
	req := httptest.NewRequest(http.MethodPost, "/v1/register", strings.NewReader(body))
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("register status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var reg registerResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &reg); err != nil {
		t.Fatalf("decode register: %v", err)
	}
	return reg.Token, reg.UserID
}

func do(t *testing.T, srv http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, r)
	return rr
}

const publishBody = `{
	"edPub":"ed-pub","xPub":"x-pub",
	"signedPreKey":{"id":"spk1","pub":"spk-pub","sig":"spk-sig"},
	"oneTimePreKeys":[{"id":"otk1","pub":"otk-pub-1"},{"id":"otk2","pub":"otk-pub-2"}]
}`

func countFrom(t *testing.T, rr *httptest.ResponseRecorder) int {
	t.Helper()
	var m map[string]int
	if err := json.Unmarshal(rr.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode count: %v (body=%s)", err, rr.Body.String())
	}
	return m["oneTimePreKeys"]
}

func TestPublishAndFetchConsumesOneTimeKey(t *testing.T) {
	srv := newTestServer()
	token, userID := registerUser(t, srv)

	// Publish identity + 2 one-time prekeys.
	rr := do(t, srv, http.MethodPut, "/v1/keys", token, publishBody)
	if rr.Code != http.StatusOK {
		t.Fatalf("publish status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if n := countFrom(t, rr); n != 2 {
		t.Fatalf("count after publish = %d, want 2", n)
	}

	// First fetch returns a bundle WITH a one-time prekey; pool drops to 1.
	rr = do(t, srv, http.MethodGet, "/v1/keys/"+userID, token, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("fetch status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var pb peerBundleResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &pb); err != nil {
		t.Fatalf("decode bundle: %v", err)
	}
	if pb.EdPub != "ed-pub" || pb.XPub != "x-pub" || pb.SignedPreKey.ID != "spk1" {
		t.Fatalf("unexpected bundle: %+v", pb)
	}
	if pb.OneTimePreKey == nil || pb.OneTimePreKey.ID != "otk1" {
		t.Fatalf("expected one-time prekey otk1, got %+v", pb.OneTimePreKey)
	}

	if n := countFrom(t, do(t, srv, http.MethodGet, "/v1/keys/count", token, "")); n != 1 {
		t.Fatalf("count after one fetch = %d, want 1", n)
	}

	// Second fetch consumes the last key.
	rr = do(t, srv, http.MethodGet, "/v1/keys/"+userID, token, "")
	_ = json.Unmarshal(rr.Body.Bytes(), &pb)
	if pb.OneTimePreKey == nil || pb.OneTimePreKey.ID != "otk2" {
		t.Fatalf("expected otk2, got %+v", pb.OneTimePreKey)
	}

	// Third fetch: pool empty → bundle returned WITHOUT a one-time prekey.
	rr = do(t, srv, http.MethodGet, "/v1/keys/"+userID, token, "")
	pb = peerBundleResponse{}
	_ = json.Unmarshal(rr.Body.Bytes(), &pb)
	if rr.Code != http.StatusOK {
		t.Fatalf("empty-pool fetch status = %d", rr.Code)
	}
	if pb.OneTimePreKey != nil {
		t.Fatalf("expected no one-time prekey, got %+v", pb.OneTimePreKey)
	}
	if pb.SignedPreKey.Pub != "spk-pub" {
		t.Fatalf("bundle missing signed prekey on empty-pool fetch: %+v", pb)
	}
}

func TestReplenishOneTimeKeys(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)

	do(t, srv, http.MethodPut, "/v1/keys", token, publishBody) // seeds 2
	rr := do(t, srv, http.MethodPost, "/v1/keys/onetime", token,
		`{"oneTimePreKeys":[{"id":"otk3","pub":"otk-pub-3"}]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("replenish status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if n := countFrom(t, rr); n != 3 {
		t.Fatalf("count after replenish = %d, want 3", n)
	}
}

func TestFetchUnknownUser(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)
	rr := do(t, srv, http.MethodGet, "/v1/keys/00000000-0000-0000-0000-999999999999", token, "")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("fetch unknown status = %d, want 404", rr.Code)
	}
}

func TestFetchInvalidUserID(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)
	rr := do(t, srv, http.MethodGet, "/v1/keys/not-a-uuid", token, "")
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("fetch invalid id status = %d, want 400", rr.Code)
	}
}

func TestKeysRequireAuth(t *testing.T) {
	srv := newTestServer()
	if rr := do(t, srv, http.MethodPut, "/v1/keys", "", publishBody); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated publish status = %d, want 401", rr.Code)
	}
	if rr := do(t, srv, http.MethodGet, "/v1/keys/count", "", ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated count status = %d, want 401", rr.Code)
	}
}

func TestPublishRequiresIdentityFields(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)
	rr := do(t, srv, http.MethodPut, "/v1/keys", token, `{"edPub":"","xPub":"x"}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("publish missing fields status = %d, want 400", rr.Code)
	}
}
