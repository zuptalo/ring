package api

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"ring/server/internal/store"
	"ring/server/internal/ws"
)

// fakePushRecord mirrors one push_subscriptions row for assertions. version=="" / tz==nil
// model NULL (not-yet-reported).
type fakePushRecord struct {
	endpoint, p256dh, auth, version string
	tz                              *int
}

type fakePushStore struct {
	mu    sync.Mutex
	recs  map[string][]*fakePushRecord // userID -> records
	prefs map[string][]byte            // userID -> spec-1050 routing prefs blob
}

func newFakePushStore() *fakePushStore {
	return &fakePushStore{recs: map[string][]*fakePushRecord{}, prefs: map[string][]byte{}}
}

func (f *fakePushStore) SavePrefs(_ context.Context, userID string, prefs []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.prefs[userID] = append([]byte(nil), prefs...)
	return nil
}

// SaveSubscription stores ONE subscription per user, overwriting any previous one (mirrors
// the real ON CONFLICT (user_id) upsert — migration 0026). Keys are always refreshed;
// version/tz are updated ONLY when provided (non-nil), mimicking COALESCE, so a version-less
// re-subscribe preserves the stored values. last_announced_version is never written here.
func (f *fakePushStore) SaveSubscription(_ context.Context, userID string, sub store.PushSubscription, installedVersion *string, tzOffsetMinutes *int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	r := &fakePushRecord{endpoint: sub.Endpoint, p256dh: sub.P256dh, auth: sub.Auth}
	if existing := f.recs[userID]; len(existing) > 0 {
		r.version, r.tz = existing[0].version, existing[0].tz // COALESCE: preserve unless provided below
	}
	if installedVersion != nil {
		r.version = *installedVersion
	}
	if tzOffsetMinutes != nil {
		r.tz = tzOffsetMinutes
	}
	f.recs[userID] = []*fakePushRecord{r} // exactly one per user
	return nil
}

func (f *fakePushStore) DeleteSubscription(_ context.Context, userID, endpoint string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	kept := f.recs[userID][:0]
	for _, r := range f.recs[userID] {
		if r.endpoint != endpoint {
			kept = append(kept, r)
		}
	}
	f.recs[userID] = kept
	return nil
}

func (f *fakePushStore) get(endpoint string) *fakePushRecord {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, recs := range f.recs {
		for _, r := range recs {
			if r.endpoint == endpoint {
				return r
			}
		}
	}
	return nil
}

func newTestServerWithPush(p *fakePushStore) http.Handler {
	as := newFakeStore()
	return NewRouter(&Handlers{
		Store: as, Directory: as, Contacts: as, Blocks: as, Relay: as,
		Hub: ws.NewHub(), Keys: newFakeKeysStore(), Blobs: newFakeBlobStore(),
		Sync: newFakeSyncStore(), Push: p, Invites: as,
		PublicURL: "https://ring.example", VapidPublicKey: "VAPID_PUB",
	}, []string{"http://localhost:5173"})
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

// TestPushSubscribeStoresVersionAndTz: subscribing with installedVersion + tzOffsetMinutes
// persists them; a re-subscribe that OMITS them preserves the stored values (COALESCE) while
// still refreshing the keys (spec 1016 FR-013/FR-014).
func TestPushSubscribeStoresVersionAndTz(t *testing.T) {
	p := newFakePushStore()
	srv := newTestServerWithPush(p)
	token, _ := registerUser(t, srv)

	const ep = "https://push.example/v"
	body := `{"endpoint":"` + ep + `","keys":{"p256dh":"PUB","auth":"AUTH"},"installedVersion":"1.2.3+sha","tzOffsetMinutes":-120}`
	if rr := do(t, srv, http.MethodPost, "/v1/push/subscribe", token, body); rr.Code != http.StatusOK {
		t.Fatalf("subscribe status = %d, body=%s", rr.Code, rr.Body.String())
	}
	r := p.get(ep)
	if r == nil || r.version != "1.2.3+sha" || r.tz == nil || *r.tz != -120 {
		t.Fatalf("after subscribe: %s, want version=1.2.3+sha tz=-120", desc(r))
	}

	// Re-subscribe WITHOUT version/tz (the SW resubscribe path) → previous values preserved.
	if rr := do(t, srv, http.MethodPost, "/v1/push/subscribe", token,
		`{"endpoint":"`+ep+`","keys":{"p256dh":"PUB2","auth":"AUTH2"}}`); rr.Code != http.StatusOK {
		t.Fatalf("re-subscribe status = %d", rr.Code)
	}
	r = p.get(ep)
	if r.version != "1.2.3+sha" || r.tz == nil || *r.tz != -120 {
		t.Errorf("version-less re-subscribe clobbered metadata: %s, want preserved", desc(r))
	}
	if r.p256dh != "PUB2" || r.auth != "AUTH2" {
		t.Errorf("keys not refreshed on re-subscribe: %s/%s", r.p256dh, r.auth)
	}
}

// TestPushOneSubscriptionPerAccount: a new subscription (e.g. a rotated endpoint, or a login
// from another device) REPLACES the account's previous one — so a single message is delivered
// once, not fanned out to every endpoint the account ever registered (migration 0026).
func TestPushOneSubscriptionPerAccount(t *testing.T) {
	p := newFakePushStore()
	srv := newTestServerWithPush(p)
	token, _ := registerUser(t, srv)
	subscribe := func(ep string) {
		body := `{"endpoint":"` + ep + `","keys":{"p256dh":"PUB","auth":"AUTH"}}`
		if rr := do(t, srv, http.MethodPost, "/v1/push/subscribe", token, body); rr.Code != http.StatusOK {
			t.Fatalf("subscribe %s status = %d", ep, rr.Code)
		}
	}
	subscribe("https://push.example/old")
	subscribe("https://push.example/new")

	if p.get("https://push.example/old") != nil {
		t.Error("old subscription was not replaced — account would receive duplicate pushes")
	}
	if p.get("https://push.example/new") == nil {
		t.Error("the current subscription is missing")
	}
}

func desc(r *fakePushRecord) string {
	if r == nil {
		return "<no record>"
	}
	tz := "nil"
	if r.tz != nil {
		tz = fmt.Sprintf("%d", *r.tz)
	}
	return fmt.Sprintf("version=%q tz=%s keys=%s/%s", r.version, tz, r.p256dh, r.auth)
}
