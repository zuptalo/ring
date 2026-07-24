package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"ring/server/internal/store"
)

// memSubStore is an in-memory SubStore for the notifier tests.
type memSubStore struct {
	mu      sync.Mutex
	subs    map[string][]store.PushSubscription
	deleted []string
}

func (m *memSubStore) SubscriptionsFor(_ context.Context, userID string) ([]store.PushSubscription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]store.PushSubscription(nil), m.subs[userID]...), nil
}

func (m *memSubStore) PrefsFor(_ context.Context, _ string) ([]byte, error) {
	return []byte("{}"), nil
}

func (m *memSubStore) AllSubscriptions(_ context.Context) ([]store.PushSubscription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []store.PushSubscription
	for _, subs := range m.subs {
		out = append(out, subs...)
	}
	return out, nil
}

func (m *memSubStore) DeleteSubscriptionByEndpoint(_ context.Context, endpoint string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deleted = append(m.deleted, endpoint)
	return nil
}

func (m *memSubStore) wasDeleted(endpoint string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range m.deleted {
		if e == endpoint {
			return true
		}
	}
	return false
}

// newSubKeys returns a valid (p256dh, auth) pair so webpush-go can encrypt to it.
func newSubKeys(t *testing.T) (string, string) {
	t.Helper()
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("gen ecdh key: %v", err)
	}
	authBytes := make([]byte, 16)
	if _, err := rand.Read(authBytes); err != nil {
		t.Fatalf("rand auth: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(priv.PublicKey().Bytes()),
		base64.RawURLEncoding.EncodeToString(authBytes)
}

func newNotifier(t *testing.T, st SubStore) *Notifier {
	t.Helper()
	vpriv, vpub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("gen vapid: %v", err)
	}
	return NewNotifier(NewSender(vpub, vpriv, "mailto:test@ring.test"), st)
}

// capturedReq records the transport headers of the last push the fake service got.
type capturedReq struct {
	mu      sync.Mutex
	ttl     string
	urgency string
	topic   string
	bodyLen int // encrypted aes128gcm body length (spec 2046: must stay small)
	hits    int32
}

func (c *capturedReq) record(r *http.Request) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ttl = r.Header.Get("TTL")
	c.urgency = r.Header.Get("Urgency")
	c.topic = r.Header.Get("Topic")
	body, _ := io.ReadAll(r.Body)
	c.bodyLen = len(body)
	atomic.AddInt32(&c.hits, 1)
}

// TestNotifyHeaders verifies the MESSAGE path is long-lived, high-urgency, and
// collapsible while the CALL path is short-lived, high-urgency, and uncollapsed.
func TestNotifyHeaders(t *testing.T) {
	cap := &capturedReq{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.record(r)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	p256dh, auth := newSubKeys(t)
	st := &memSubStore{subs: map[string][]store.PushSubscription{
		"u1": {{Endpoint: srv.URL, P256dh: p256dh, Auth: auth}},
	}}
	n := newNotifier(t, st)

	n.Notify(context.Background(), "u1")
	if cap.ttl != "2419200" {
		t.Errorf("message TTL = %q, want 2419200", cap.ttl)
	}
	if cap.urgency != "high" {
		t.Errorf("message Urgency = %q, want high", cap.urgency)
	}
	if want := base64.RawURLEncoding.EncodeToString([]byte("ring-msg")); cap.topic != want {
		t.Errorf("message Topic = %q, want %q (base64url of ring-msg — Apple rejects a non-base64 topic)", cap.topic, want)
	}

	n.NotifyCall(context.Background(), "u1")
	if cap.ttl != "60" {
		t.Errorf("call TTL = %q, want 60", cap.ttl)
	}
	if cap.urgency != "high" {
		t.Errorf("call Urgency = %q, want high", cap.urgency)
	}
	if cap.topic != "" {
		t.Errorf("call Topic = %q, want empty (uncollapsed)", cap.topic)
	}
}

// TestNotifyConnHeaders verifies the CONNECTION (friend-request) path is
// long-ish-lived, high-urgency, and collapsible under its own topic (so a burst
// of connection events folds to one wake and never collapses a message/call).
func TestNotifyConnHeaders(t *testing.T) {
	cap := &capturedReq{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.record(r)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	p256dh, auth := newSubKeys(t)
	st := &memSubStore{subs: map[string][]store.PushSubscription{
		"u1": {{Endpoint: srv.URL, P256dh: p256dh, Auth: auth}},
	}}
	n := newNotifier(t, st)

	n.NotifyConn(context.Background(), "u1")
	if cap.ttl != "2419200" {
		t.Errorf("conn TTL = %q, want 2419200 (28d)", cap.ttl)
	}
	if cap.urgency != "high" {
		t.Errorf("conn Urgency = %q, want high", cap.urgency)
	}
	if want := base64.RawURLEncoding.EncodeToString([]byte("ring-conn")); cap.topic != want {
		t.Errorf("conn Topic = %q, want %q (base64url of ring-conn)", cap.topic, want)
	}
}

// TestNotifyConnFansOutToAllSubs verifies the connection tickle reaches every one
// of a user's devices (parity with Notify/NotifyCall).
func TestNotifyConnFansOutToAllSubs(t *testing.T) {
	cap := &capturedReq{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.record(r)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	p1, a1 := newSubKeys(t)
	p2, a2 := newSubKeys(t)
	st := &memSubStore{subs: map[string][]store.PushSubscription{
		"u1": {
			{Endpoint: srv.URL, P256dh: p1, Auth: a1},
			{Endpoint: srv.URL, P256dh: p2, Auth: a2},
		},
	}}
	newNotifier(t, st).NotifyConn(context.Background(), "u1")
	if got := atomic.LoadInt32(&cap.hits); got != 2 {
		t.Errorf("conn fan-out hits = %d, want 2 (one per device)", got)
	}
}

// TestPrunesGoneSubscription verifies a 410 endpoint is removed.
func TestPrunesGoneSubscription(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusGone)
	}))
	defer srv.Close()

	p256dh, auth := newSubKeys(t)
	st := &memSubStore{subs: map[string][]store.PushSubscription{
		"u1": {{Endpoint: srv.URL, P256dh: p256dh, Auth: auth}},
	}}
	newNotifier(t, st).Notify(context.Background(), "u1")

	if !st.wasDeleted(srv.URL) {
		t.Errorf("expected gone subscription %q to be pruned", srv.URL)
	}
}

// TestRetriesTransientThenDelivers verifies a 503 is retried and not pruned.
func TestRetriesTransientThenDelivers(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&hits, 1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable) // transient first
			return
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	p256dh, auth := newSubKeys(t)
	st := &memSubStore{subs: map[string][]store.PushSubscription{
		"u1": {{Endpoint: srv.URL, P256dh: p256dh, Auth: auth}},
	}}
	newNotifier(t, st).Notify(context.Background(), "u1")

	if got := atomic.LoadInt32(&hits); got < 2 {
		t.Errorf("hits = %d, want >= 2 (a retry after 503)", got)
	}
	if st.wasDeleted(srv.URL) {
		t.Errorf("a transiently-failing subscription must not be pruned")
	}
}

// TestConcurrentSendsDontSerialize verifies a user's devices are delivered in
// parallel: two slow endpoints finish in ~one delay, not the sum.
func TestConcurrentSendsDontSerialize(t *testing.T) {
	const delay = 300 * time.Millisecond
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(delay)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	p1, a1 := newSubKeys(t)
	p2, a2 := newSubKeys(t)
	st := &memSubStore{subs: map[string][]store.PushSubscription{
		"u1": {
			{Endpoint: srv.URL, P256dh: p1, Auth: a1},
			{Endpoint: srv.URL, P256dh: p2, Auth: a2},
		},
	}}
	n := newNotifier(t, st)

	start := time.Now()
	n.Notify(context.Background(), "u1")
	elapsed := time.Since(start)
	if elapsed > 2*delay-50*time.Millisecond {
		t.Errorf("two sends took %v; expected concurrent (~%v), not serialized (~%v)", elapsed, delay, 2*delay)
	}
}

// panicSubStore panics in SubscriptionsFor, to exercise the recover in notify()'s
// own body (the path before any fan-out goroutine is spawned).
type panicSubStore struct{}

func (panicSubStore) SubscriptionsFor(context.Context, string) ([]store.PushSubscription, error) {
	panic("boom: SubscriptionsFor")
}
func (panicSubStore) AllSubscriptions(context.Context) ([]store.PushSubscription, error) {
	panic("boom: AllSubscriptions")
}
func (panicSubStore) DeleteSubscriptionByEndpoint(context.Context, string) error { return nil }
func (panicSubStore) PrefsFor(context.Context, string) ([]byte, error) { return []byte("{}"), nil }

// A panic in push delivery must never escape Notify - it runs in a bare goroutine
// off the WS handler, so an unrecovered panic would crash the whole process and
// drop every connection. These tests assert Notify returns normally instead (a
// missing recover would abort the entire test binary, failing the package).
func TestNotifyRecoversPanicInBody(t *testing.T) {
	n := NewNotifier(nil, panicSubStore{})
	n.Notify(context.Background(), "u1") // SubscriptionsFor panics; recover must contain it
}

func TestNotifyRecoversPanicInFanout(t *testing.T) {
	// One subscription but a nil Sender: the per-subscription goroutine panics on a
	// nil-pointer deref inside attempt() (s.subject). The per-goroutine recover, not
	// the body recover, must contain it.
	st := &memSubStore{subs: map[string][]store.PushSubscription{
		"u1": {{Endpoint: "https://example.com/x", P256dh: "x", Auth: "y"}},
	}}
	n := NewNotifier(nil, st)
	n.Notify(context.Background(), "u1") // returns only if the fan-out recover holds
}

// TestSendVersionHeaders verifies the version-announcement push to ONE device is a
// content-free tickle: low-urgency, SHORT-lived (expires by ~local midday, not days), and
// collapsible under its own topic (spec 1016 FR-015).
func TestSendVersionHeaders(t *testing.T) {
	cap := &capturedReq{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.record(r)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	p256dh, auth := newSubKeys(t)
	n := newNotifier(t, &memSubStore{subs: map[string][]store.PushSubscription{}})

	n.SendVersion(context.Background(), store.PushSubscription{Endpoint: srv.URL, P256dh: p256dh, Auth: auth})
	if cap.ttl != "10800" {
		t.Errorf("version TTL = %q, want 10800 (~3h, expires by local midday)", cap.ttl)
	}
	if cap.urgency != "low" {
		t.Errorf("version Urgency = %q, want low", cap.urgency)
	}
	if want := base64.RawURLEncoding.EncodeToString([]byte("ring-version")); cap.topic != want {
		t.Errorf("version Topic = %q, want %q (base64url of ring-version)", cap.topic, want)
	}
}

// TestPostActivityTopicFitsApple guards the BadWebPushTopic regression: the per-post
// activity topic is base64url-encoded by notify() before it goes on the wire, and Apple
// 400s ({"reason":"BadWebPushTopic"}) on a topic that isn't decodable base64 OR exceeds 32
// chars. postActivityTopic once returned a 28-char label that double-encoded to 38 chars,
// silently dropping every Wall-activity push to iOS post owners (FCM is lenient, so only
// Apple failed). Pin the FINAL wire topic to Apple's two constraints.
func TestPostActivityTopicFitsApple(t *testing.T) {
	cap := &capturedReq{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.record(r)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	p256dh, auth := newSubKeys(t)
	st := &memSubStore{subs: map[string][]store.PushSubscription{
		"owner": {{Endpoint: srv.URL, P256dh: p256dh, Auth: auth}},
	}}
	n := newNotifier(t, st)

	// A realistic 36-char UUID post id — the worst case for topic length.
	n.NotifyPostActivity(context.Background(), "owner", "a1b2c3d4-e5f6-7890-abcd-ef0123456789")

	if cap.topic == "" {
		t.Fatal("post-activity push carried no Topic (want a per-post collapse topic)")
	}
	if len(cap.topic) > 32 {
		t.Errorf("post-activity Topic = %q is %d chars, Apple caps it at 32 (BadWebPushTopic)", cap.topic, len(cap.topic))
	}
	if _, err := base64.RawURLEncoding.DecodeString(cap.topic); err != nil {
		t.Errorf("post-activity Topic = %q is not decodable base64url (Apple rejects with BadWebPushTopic): %v", cap.topic, err)
	}
}

// TestTickleBodyIsSmall (spec 2046) asserts the encrypted push body is sized to fit the
// content-free tickle, not padded to webpush-go's 4096-byte default — the padding that made
// constrained Firefox/Mozilla endpoints reject our sends with 413.
func TestTickleBodyIsSmall(t *testing.T) {
	cap := &capturedReq{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.record(r)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	p256dh, auth := newSubKeys(t)
	n := newNotifier(t, &memSubStore{subs: map[string][]store.PushSubscription{}})
	n.SendVersion(context.Background(), store.PushSubscription{Endpoint: srv.URL, P256dh: p256dh, Auth: auth})

	if cap.bodyLen == 0 {
		t.Fatal("no push body captured")
	}
	if cap.bodyLen >= 512 {
		t.Errorf("push body = %d bytes, want < 512 (was ~4096 before the RecordSize fix)", cap.bodyLen)
	}
}

// TestRecordSizeFor pins the record-size math: always strictly above the payload (or
// webpush-go's encryption underflows), and small.
func TestRecordSizeFor(t *testing.T) {
	for _, p := range [][]byte{
		[]byte(`{"t":"version"}`),
		[]byte(`{"t":"msg"}`),
		[]byte(`{"t":"post-activity","post":"00000000-0000-0000-0000-000000000000"}`),
	} {
		got := recordSizeFor(p)
		if int(got) <= len(p)+103 { // 103 = aes128gcm framing the library requires
			t.Errorf("recordSizeFor(%q) = %d, must exceed payload(%d)+103", p, got, len(p))
		}
		if got >= 512 {
			t.Errorf("recordSizeFor(%q) = %d, want < 512", p, got)
		}
	}
}

// TestPreviewParamsConstantSize (spec 1055 SC-004 / FR-003) pins that every preview push
// is padded to the SAME record size regardless of the sealed preview's length — so the
// push service learns nothing about the message length — and carries NO Topic header
// (each preview must survive independently; a shared Topic would collapse a burst).
func TestPreviewParamsConstantSize(t *testing.T) {
	small := previewParams([]byte(`{"h":{},"p":{"ct":"aa"}}`))
	large := previewParams([]byte(`{"h":{"dh":"` + strings.Repeat("x", 800) + `"},"p":{"ct":"` + strings.Repeat("y", 1500) + `"}}`))
	if pickRecordSize(small) != pickRecordSize(large) {
		t.Errorf("preview record size varies with payload length: %d vs %d (leaks message size)",
			pickRecordSize(small), pickRecordSize(large))
	}
	if pickRecordSize(small) != previewRecordSize {
		t.Errorf("preview record size = %d, want the constant %d", pickRecordSize(small), previewRecordSize)
	}
	if small.topic != "" {
		t.Errorf("preview push must carry NO Topic header, got %q", small.topic)
	}
	// A tickle still derives its size from the payload (spec 2046), unchanged.
	if got := pickRecordSize(msgParams()); got != recordSizeFor(msgParams().payload) {
		t.Errorf("tickle record size = %d, want payload-derived %d", got, recordSizeFor(msgParams().payload))
	}
}

// TestPreviewRecordSizeFitsConstrained pins the constant preview record size below the
// constrained-endpoint ceiling. A Mozilla autopush "constrained device" rejected a 3200-byte
// record with 413 (~2954-byte ceiling), leaving that device with no notifications; the record
// size must stay well under that so preview pushes reach constrained subscriptions.
func TestPreviewRecordSizeFitsConstrained(t *testing.T) {
	const constrainedCeiling = 2954 // observed in prod (413 "too long by 246" at record size 3200)
	if previewRecordSize > constrainedCeiling {
		t.Errorf("previewRecordSize = %d exceeds the observed constrained-endpoint ceiling %d — constrained devices will 413 and get no pushes",
			previewRecordSize, constrainedCeiling)
	}
	// And it must still hold a real bounded preview (body ~256B + fields + header, ~1.3KB).
	if previewMaxPayload < 1536 {
		t.Errorf("previewMaxPayload = %d is too small to inline a normal bounded preview", previewMaxPayload)
	}
}

// TestVersionPayloadContentFree asserts the version tickle carries ONLY the type marker —
// no version string, notes, or any content (NFR-ZK-001). The device fetches the public
// "what's new" itself; nothing about the release rides through the push service.
func TestVersionPayloadContentFree(t *testing.T) {
	if got := string(versionParams().payload); got != `{"t":"version"}` {
		t.Errorf("version payload = %q, want exactly the content-free marker {\"t\":\"version\"}", got)
	}
}

// TestSendVersionRecoversPanic asserts a panic during a single version send can't escape
// (the sweep runs it in a goroutine).
func TestSendVersionRecoversPanic(t *testing.T) {
	n := NewNotifier(nil, panicSubStore{}) // nil sender → deliver panics on s.subject deref
	n.SendVersion(context.Background(), store.PushSubscription{Endpoint: "https://x/y", P256dh: "x", Auth: "y"})
}
