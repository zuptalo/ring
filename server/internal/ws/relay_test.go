package ws_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"ring/server/internal/store"
	"ring/server/internal/ws"
)

// memRelay is an in-memory RelayStore for the relay tests (no database).
type memRelay struct {
	mu      sync.Mutex
	seq     int64
	queue   map[string][]store.RelayItem // recipient -> items (FIFO)
	senders map[string]map[string]string // recipient -> msgID -> sender
	blocks  map[string]map[string]bool   // blocker -> blocked -> true
	deliv   []store.Delivery             // recorded deliveries (sender-scoped lookup)
	delivBy map[string]string            // msgID -> sender, for the lookup
	seen    []store.Seen                 // recorded seen receipts (sender-scoped lookup)
	seenBy  map[string]string            // msgID -> sender, for the lookup
}

func newMemRelay() *memRelay {
	return &memRelay{
		queue:   map[string][]store.RelayItem{},
		senders: map[string]map[string]string{},
		blocks:  map[string]map[string]bool{},
		delivBy: map[string]string{},
		seenBy:  map[string]string{},
	}
}

func (m *memRelay) IsBlocked(_ context.Context, blocker, blocked string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.blocks[blocker][blocked], nil
}

func (m *memRelay) block(blocker, blocked string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.blocks[blocker] == nil {
		m.blocks[blocker] = map[string]bool{}
	}
	m.blocks[blocker][blocked] = true
}

func (m *memRelay) unblock(blocker, blocked string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.blocks[blocker] != nil {
		delete(m.blocks[blocker], blocked)
	}
}

func (m *memRelay) EnqueueRelay(_ context.Context, recipient, sender, msgID string, payload []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.senders[recipient] == nil {
		m.senders[recipient] = map[string]string{}
	}
	if _, dup := m.senders[recipient][msgID]; dup {
		return nil // idempotent
	}
	m.seq++
	m.senders[recipient][msgID] = sender
	m.queue[recipient] = append(m.queue[recipient], store.RelayItem{Seq: m.seq, Payload: payload})
	return nil
}

func (m *memRelay) PendingForRecipient(_ context.Context, recipient string) ([]store.RelayItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]store.RelayItem(nil), m.queue[recipient]...), nil
}

func (m *memRelay) OldestPendingForRecipient(_ context.Context, recipient string) (int64, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return 0, len(m.queue[recipient]), nil
}

func (m *memRelay) DeleteRelay(_ context.Context, recipient, msgID string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sender, ok := m.senders[recipient][msgID]
	if !ok {
		return "", false, nil
	}
	delete(m.senders[recipient], msgID)
	kept := m.queue[recipient][:0]
	for _, it := range m.queue[recipient] {
		var f map[string]any
		_ = json.Unmarshal(it.Payload, &f)
		if f["id"] != msgID {
			kept = append(kept, it)
		}
	}
	m.queue[recipient] = kept
	return sender, true, nil
}

func (m *memRelay) StampNotified(_ context.Context, recipient, msgID string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sender, ok := m.senders[recipient][msgID]
	if !ok {
		return "", false, nil
	}
	return sender, true, nil // stamp only; frame stays queued (no dequeue)
}

func (m *memRelay) RecordDelivery(_ context.Context, sender, recipient, msgID string) error {
	if sender == "" || recipient == "" || msgID == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, d := range m.deliv {
		if d.MsgID == msgID && d.Recipient == recipient {
			return nil // idempotent
		}
	}
	m.deliv = append(m.deliv, store.Delivery{MsgID: msgID, Recipient: recipient, DeliveredMs: 1})
	m.delivBy[msgID] = sender
	return nil
}

func (m *memRelay) DeliveriesFor(_ context.Context, sender string, msgIDs []string) ([]store.Delivery, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	want := map[string]bool{}
	for _, id := range msgIDs {
		want[id] = true
	}
	var out []store.Delivery
	for _, d := range m.deliv {
		if want[d.MsgID] && m.delivBy[d.MsgID] == sender {
			out = append(out, d)
		}
	}
	return out, nil
}

func (m *memRelay) RecordSeen(_ context.Context, sender, recipient, msgID string) error {
	if sender == "" || recipient == "" || msgID == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.seen {
		if s.MsgID == msgID && s.Recipient == recipient {
			return nil // idempotent
		}
	}
	m.seen = append(m.seen, store.Seen{MsgID: msgID, Recipient: recipient, SeenMs: 1})
	m.seenBy[msgID] = sender
	return nil
}

func (m *memRelay) SeenFor(_ context.Context, sender string, msgIDs []string) ([]store.Seen, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	want := map[string]bool{}
	for _, id := range msgIDs {
		want[id] = true
	}
	var out []store.Seen
	for _, s := range m.seen {
		if want[s.MsgID] && m.seenBy[s.MsgID] == sender {
			out = append(out, s)
		}
	}
	return out, nil
}

func (m *memRelay) SetPresencePrefs(_ context.Context, _, _, _ string) error { return nil }

func (m *memRelay) TouchLastSeen(_ context.Context, _ string) error { return nil }

func (m *memRelay) GetPresence(_ context.Context, ids []string) (map[string]store.PresenceInfo, error) {
	out := make(map[string]store.PresenceInfo, len(ids))
	for _, id := range ids {
		out[id] = store.PresenceInfo{OnlineTier: "everyone", LastSeenTier: "everyone"}
	}
	return out, nil
}

func (m *memRelay) PresenceAudience(_ context.Context, _ string) (map[string]bool, error) {
	return map[string]bool{}, nil
}

func (m *memRelay) ContactEdgesWith(_ context.Context, _ string, _ []string) (map[string]bool, error) {
	return map[string]bool{}, nil
}
func (m *memRelay) SetPresenceOverrides(_ context.Context, _ string, _ map[string]string) error {
	return nil
}
func (m *memRelay) PresenceOverrides(_ context.Context, _ string) (map[string]string, error) {
	return map[string]string{}, nil
}
func (m *memRelay) PresenceOverridesFor(_ context.Context, _ string, _ []string) (map[string]string, error) {
	return map[string]string{}, nil
}

func testAuth(_ context.Context, token string) (string, bool, error) {
	switch token {
	case "tokA":
		return "user-a", true, nil
	case "tokB":
		return "user-b", true, nil
	case "tokC":
		return "user-c", true, nil
	}
	return "", false, nil
}

func newRelayServer() (*httptest.Server, *memRelay) {
	relay := newMemRelay()
	h := ws.Handler(ws.NewHub(), relay, nil, testAuth, nil)
	return httptest.NewServer(h), relay
}

func dial(t *testing.T, srv *httptest.Server, token string) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/v1/ws?token=" + token
	conn, resp, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		code := 0
		if resp != nil {
			code = resp.StatusCode
		}
		t.Fatalf("dial %s: %v (status %d)", token, err, code)
	}
	return conn
}

func readFrame(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	var f map[string]any
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("decode frame: %v", err)
	}
	return f
}

func TestRelayOnlineDeliveryAndReceipts(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond) // let both register

	// A sends a sealed message to B.
	if err := a.WriteJSON(map[string]any{"t": "msg", "id": "m1", "to": "user-b", "ciphertext": "SEALED"}); err != nil {
		t.Fatalf("A send: %v", err)
	}

	// B receives it, attributed to A, ciphertext intact.
	got := readFrame(t, b)
	if got["t"] != "msg" || got["from"] != "user-a" || got["id"] != "m1" || got["ciphertext"] != "SEALED" {
		t.Fatalf("B received unexpected frame: %v", got)
	}

	// A gets a 'sent' receipt from the server.
	sent := readFrame(t, a)
	if sent["t"] != "receipt" || sent["messageId"] != "m1" || sent["status"] != "sent" {
		t.Fatalf("A expected sent receipt, got: %v", sent)
	}

	// B acknowledges → A gets a 'delivered' receipt.
	if err := b.WriteJSON(map[string]any{"t": "ack", "refId": "m1"}); err != nil {
		t.Fatalf("B ack: %v", err)
	}
	delivered := readFrame(t, a)
	if delivered["t"] != "receipt" || delivered["messageId"] != "m1" || delivered["status"] != "delivered" {
		t.Fatalf("A expected delivered receipt, got: %v", delivered)
	}
}

func TestRelayOfflineQueueDrainsOnConnect(t *testing.T) {
	srv, relay := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	time.Sleep(50 * time.Millisecond)

	// B is offline. A sends a message → it must be queued.
	if err := a.WriteJSON(map[string]any{"t": "msg", "id": "m2", "to": "user-b", "ciphertext": "WHILE_OFFLINE"}); err != nil {
		t.Fatalf("A send: %v", err)
	}
	// A still gets a 'sent' receipt.
	if sent := readFrame(t, a); sent["status"] != "sent" {
		t.Fatalf("A expected sent receipt, got: %v", sent)
	}
	if pending, _ := relay.PendingForRecipient(context.Background(), "user-b"); len(pending) != 1 {
		t.Fatalf("expected 1 queued frame for B, got %d", len(pending))
	}

	// B connects later → the queued message drains to it.
	b := dial(t, srv, "tokB")
	defer b.Close()
	got := readFrame(t, b)
	if got["t"] != "msg" || got["id"] != "m2" || got["ciphertext"] != "WHILE_OFFLINE" {
		t.Fatalf("B did not receive queued message, got: %v", got)
	}
}

// The client-originated SEEN receipt relay (replacing the old 'read' relay,
// post-cutover) is covered in seen_test.go: TestRelaySeenReceiptRelayedAndRecorded
// (relayed + recorded) and TestRelayDropsClientReadReceiptPostCutover (a now-stale
// 'read' is dropped).

func TestRelayRoutesDownloadedReceipt(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// B (recipient) reports it downloaded m1's media → routed to A (the sender) so A can
	// free the blob. From is stamped to the authenticated recipient.
	if err := b.WriteJSON(map[string]any{"t": "receipt", "messageId": "m1", "status": "downloaded", "to": "user-a"}); err != nil {
		t.Fatalf("B send downloaded receipt: %v", err)
	}
	got := readFrame(t, a)
	if got["t"] != "receipt" || got["messageId"] != "m1" || got["status"] != "downloaded" || got["from"] != "user-b" {
		t.Fatalf("A expected downloaded receipt from user-b, got: %v", got)
	}
}

// A client may NOT forge 'delivered'/'sent' (server-authoritative); such a receipt is
// dropped so a peer can't evict a sender's still-unsent group copies.
func TestRelayDropsClientForgedDeliveredReceipt(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	if err := b.WriteJSON(map[string]any{"t": "receipt", "messageId": "m1", "status": "delivered", "to": "user-a"}); err != nil {
		t.Fatalf("B send forged delivered: %v", err)
	}
	_ = a.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := a.ReadMessage(); err == nil {
		t.Fatal("A must receive nothing for a client-forged 'delivered' receipt")
	}
}

// 'sent' is server-authoritative too: only the relay emits it (when it accepts a
// message). A client claiming 'sent' for a peer is dropped, like 'delivered'.
func TestRelayDropsClientForgedSentReceipt(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	if err := b.WriteJSON(map[string]any{"t": "receipt", "messageId": "m1", "status": "sent", "to": "user-a"}); err != nil {
		t.Fatalf("B send forged sent: %v", err)
	}
	_ = a.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := a.ReadMessage(); err == nil {
		t.Fatal("A must receive nothing for a client-forged 'sent' receipt")
	}
}

func TestRelayHoldsBlockedSenderUntilUnblock(t *testing.T) {
	srv, relay := newRelayServer()
	defer srv.Close()
	relay.block("user-b", "user-a") // B has blocked A

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	time.Sleep(50 * time.Millisecond)

	// A (blocked) sends to B. The message is HELD: not delivered live, but durably
	// queued - and A still gets a 'sent' receipt so the block stays invisible.
	if err := a.WriteJSON(map[string]any{"t": "msg", "id": "mb", "to": "user-b", "ciphertext": "X"}); err != nil {
		t.Fatalf("A send: %v", err)
	}
	if sent := readFrame(t, a); sent["t"] != "receipt" || sent["status"] != "sent" {
		t.Fatalf("A expected sent receipt, got: %v", sent)
	}
	// B (still blocking) must receive nothing live...
	_ = b.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := b.ReadMessage(); err == nil {
		t.Fatalf("B should have received nothing while still blocking A")
	}
	// ...but the message IS queued, held until unblock.
	if pending, _ := relay.PendingForRecipient(context.Background(), "user-b"); len(pending) != 1 {
		t.Fatalf("expected 1 held frame for B, got %d", len(pending))
	}

	// B unblocks A and reconnects → the held message flushes on connect.
	b.Close()
	relay.unblock("user-b", "user-a")
	b2 := dial(t, srv, "tokB")
	defer b2.Close()
	got := readFrame(t, b2)
	if got["t"] != "msg" || got["id"] != "mb" {
		t.Fatalf("after unblock B expected the held msg, got: %v", got)
	}
}

type fakeNotifier struct{ ch chan string }

func (f *fakeNotifier) Notify(_ context.Context, userID string)            { f.ch <- userID }
func (f *fakeNotifier) NotifyFrame(_ context.Context, userID, _, _ string)  { f.ch <- userID }
func (f *fakeNotifier) NotifyFramePreview(_ context.Context, userID, _, _ string, _ []byte) {
	f.ch <- userID
}
func (f *fakeNotifier) NotifyCall(_ context.Context, userID string)        { f.ch <- userID }
func (f *fakeNotifier) NotifyConn(_ context.Context, userID string)        { f.ch <- userID }
func (f *fakeNotifier) NotifyPost(_ context.Context, userID, _ string)     { f.ch <- userID }
func (f *fakeNotifier) NotifyPostActivity(context.Context, string, string) {}

func TestRelayPushesWhenRecipientOffline(t *testing.T) {
	relay := newMemRelay()
	notif := &fakeNotifier{ch: make(chan string, 4)}
	srv := httptest.NewServer(ws.Handler(ws.NewHub(), relay, notif, testAuth, nil))
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	time.Sleep(50 * time.Millisecond)

	// B is offline → sending to B should trigger a push notify for user-b.
	if err := a.WriteJSON(map[string]any{"t": "msg", "id": "m9", "to": "user-b", "ciphertext": "X"}); err != nil {
		t.Fatalf("A send: %v", err)
	}
	select {
	case uid := <-notif.ch:
		if uid != "user-b" {
			t.Fatalf("notified %q, want user-b", uid)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected a push notify for the offline recipient")
	}
}

func TestRelayRejectsBadToken(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/v1/ws?token=nope"
	_, resp, err := websocket.DefaultDialer.Dial(u, nil)
	if err == nil {
		t.Fatal("expected dial to fail with bad token")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %v", resp)
	}
}
