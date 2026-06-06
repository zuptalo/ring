package api

import (
	"context"
	"net/http"
	"sync"
	"testing"

	"ring/server/internal/store"
)

type fakePushStore struct {
	mu   sync.Mutex
	subs map[string][]store.PushSubscription
}

func newFakePushStore() *fakePushStore {
	return &fakePushStore{subs: map[string][]store.PushSubscription{}}
}

func (f *fakePushStore) SaveSubscription(_ context.Context, userID string, sub store.PushSubscription) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.subs[userID] = append(f.subs[userID], sub)
	return nil
}

func (f *fakePushStore) DeleteSubscription(_ context.Context, userID, endpoint string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	kept := f.subs[userID][:0]
	for _, s := range f.subs[userID] {
		if s.Endpoint != endpoint {
			kept = append(kept, s)
		}
	}
	f.subs[userID] = kept
	return nil
}

func TestPushSubscribe(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)

	body := `{"endpoint":"https://push.example/abc","keys":{"p256dh":"PUB","auth":"AUTH"}}`
	if rr := do(t, srv, http.MethodPost, "/v1/push/subscribe", token, body); rr.Code != http.StatusOK {
		t.Fatalf("subscribe status = %d, body = %s", rr.Code, rr.Body.String())
	}

	// Missing keys → 400.
	if rr := do(t, srv, http.MethodPost, "/v1/push/subscribe", token, `{"endpoint":"x"}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("bad subscribe status = %d, want 400", rr.Code)
	}
	// No auth → 401.
	if rr := do(t, srv, http.MethodPost, "/v1/push/subscribe", "", body); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated subscribe status = %d, want 401", rr.Code)
	}
	// Unsubscribe.
	if rr := do(t, srv, http.MethodPost, "/v1/push/unsubscribe", token, `{"endpoint":"https://push.example/abc"}`); rr.Code != http.StatusOK {
		t.Fatalf("unsubscribe status = %d", rr.Code)
	}
}
