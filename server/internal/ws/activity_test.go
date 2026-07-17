package ws_test

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"ring/server/internal/ws"
)

// Spec 1009 — ephemeral activity indicators (typing / recording). These frames
// are a live-only relay (like read receipts): stamped From = authenticated
// sender, fanned only to the peer's live sockets, and dropped if the peer is
// offline — NEVER durably queued, persisted, or pushed. The kind/state ride in
// the sealed Ciphertext, opaque to the server (it sees only {t, to, from}).

func TestActivityRelaysToPeerWithFromStamped(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// A signals activity to B; the sealed kind/state ride in ciphertext.
	if err := a.WriteJSON(map[string]any{"t": "activity", "to": "user-b", "ciphertext": "SEALED"}); err != nil {
		t.Fatalf("A send activity: %v", err)
	}

	got := readFrame(t, b)
	if got["t"] != "activity" || got["from"] != "user-a" || got["ciphertext"] != "SEALED" {
		t.Fatalf("B received unexpected activity frame: %v", got)
	}
}

func TestActivityStampsFromOverridingClientValue(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// A tries to forge from = someone else; the server overwrites it.
	if err := a.WriteJSON(map[string]any{"t": "activity", "to": "user-b", "from": "user-x", "ciphertext": "X"}); err != nil {
		t.Fatalf("A send forged activity: %v", err)
	}

	got := readFrame(t, b)
	if got["t"] != "activity" || got["from"] != "user-a" {
		t.Fatalf("activity from must be stamped to the authenticated sender, got: %v", got)
	}
}

func TestActivityDroppedWhenPeerOffline_NothingQueued(t *testing.T) {
	srv, relay := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	time.Sleep(50 * time.Millisecond)

	// B is offline. The activity frame must be dropped — never queued.
	if err := a.WriteJSON(map[string]any{"t": "activity", "to": "user-b", "ciphertext": "X"}); err != nil {
		t.Fatalf("A send activity: %v", err)
	}
	time.Sleep(100 * time.Millisecond) // let the server process

	if pending, _ := relay.PendingForRecipient(context.Background(), "user-b"); len(pending) != 0 {
		t.Fatalf("activity must NOT be queued for an offline peer, got %d queued", len(pending))
	}
	// A must not get any echo/receipt back for an activity frame.
	_ = a.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := a.ReadMessage(); err == nil {
		t.Fatal("A must receive nothing back for an activity frame")
	}
}

func TestActivityDroppedForBlockedPair(t *testing.T) {
	srv, relay := newRelayServer()
	defer srv.Close()
	relay.block("user-b", "user-a") // B has blocked A

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	if err := a.WriteJSON(map[string]any{"t": "activity", "to": "user-b", "ciphertext": "X"}); err != nil {
		t.Fatalf("A send activity: %v", err)
	}
	// B (blocking A) must receive nothing.
	_ = b.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := b.ReadMessage(); err == nil {
		t.Fatal("B should receive no activity from a blocked sender")
	}
}

func TestActivityNeverPushesOfflinePeer(t *testing.T) {
	relay := newMemRelay()
	notif := &fakeNotifier{ch: make(chan string, 4)}
	srv := httptest.NewServer(ws.Handler(ws.NewHub(), relay, notif, testAuth, nil))
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	time.Sleep(50 * time.Millisecond)

	// B offline: activity must NOT trigger a push (unlike a message).
	if err := a.WriteJSON(map[string]any{"t": "activity", "to": "user-b", "ciphertext": "X"}); err != nil {
		t.Fatalf("A send activity: %v", err)
	}
	select {
	case uid := <-notif.ch:
		t.Fatalf("activity must not push; got a notify for %q", uid)
	case <-time.After(500 * time.Millisecond):
		// no push — correct
	}
}
