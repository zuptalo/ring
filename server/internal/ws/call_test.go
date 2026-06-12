package ws_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"ring/server/internal/ws"
)

// A 1:1 call offer to an online callee is relayed live (with the authoritative
// sender stamped) and the answer flows back - none of it durably queued.
func TestCallOfferRelayedLiveToOnlinePeer(t *testing.T) {
	srv, relay := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// A calls B.
	if err := a.WriteJSON(map[string]any{
		"t": "call-offer", "to": "user-b", "callId": "c1", "kind": "video", "ciphertext": "SDP_A",
	}); err != nil {
		t.Fatalf("A call-offer: %v", err)
	}
	got := readFrame(t, b)
	if got["t"] != "call-offer" || got["from"] != "user-a" || got["callId"] != "c1" || got["kind"] != "video" {
		t.Fatalf("B expected call-offer from user-a, got: %v", got)
	}
	if got["ciphertext"] != "SDP_A" {
		t.Fatalf("B expected opaque ciphertext relayed verbatim, got: %v", got["ciphertext"])
	}

	// The offer reached a live callee socket → the server tells the caller it's reachable so
	// its UI flips "Calling" → "Ringing" without waiting on the callee's app to echo it.
	gotR := readFrame(t, a)
	if gotR["t"] != "call-ringing" || gotR["from"] != "user-b" || gotR["callId"] != "c1" {
		t.Fatalf("A expected server-issued call-ringing (callee reachable), got: %v", gotR)
	}

	// B answers → A receives it.
	if err := b.WriteJSON(map[string]any{
		"t": "call-answer", "to": "user-a", "callId": "c1", "ciphertext": "SDP_B",
	}); err != nil {
		t.Fatalf("B call-answer: %v", err)
	}
	got = readFrame(t, a)
	if got["t"] != "call-answer" || got["from"] != "user-b" || got["callId"] != "c1" {
		t.Fatalf("A expected call-answer from user-b, got: %v", got)
	}

	// Nothing was durably queued for either party.
	if items, _ := relay.PendingForRecipient(nil, "user-b"); len(items) != 0 {
		t.Fatalf("call frames must not be durably queued; found %d for user-b", len(items))
	}
}

// Calling an offline callee push-wakes them and BUFFERS the offer briefly, so a
// device that reconnects (woken by the push) still rings - background ringing.
func TestCallOfferBuffersAndPushesWhenOffline(t *testing.T) {
	relay := newMemRelay()
	notif := &fakeNotifier{ch: make(chan string, 4)}
	srv := httptest.NewServer(ws.Handler(ws.NewHub(), relay, notif, testAuth, nil))
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	time.Sleep(50 * time.Millisecond)

	// B is offline → A calls.
	if err := a.WriteJSON(map[string]any{
		"t": "call-offer", "to": "user-b", "callId": "c2", "kind": "audio", "ciphertext": "SDP_A",
	}); err != nil {
		t.Fatalf("A call-offer: %v", err)
	}

	// A push tickle was fired to wake the offline device.
	select {
	case uid := <-notif.ch:
		if uid != "user-b" {
			t.Fatalf("notified %q, want user-b", uid)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected a push notify for the offline callee")
	}

	// B reconnects (as if push-woken) → it receives the buffered offer and rings.
	b := dial(t, srv, "tokB")
	defer b.Close()
	got := readFrame(t, b)
	if got["t"] != "call-offer" || got["callId"] != "c2" || got["from"] != "user-a" {
		t.Fatalf("B expected the buffered call-offer on reconnect, got: %v", got)
	}
}

// A 1:1 caller trickles ICE right after the offer. If the callee is offline, those
// candidates must be BUFFERED alongside the offer (not dropped on a live-only relay) and
// delivered, after the offer, when the device reconnects - otherwise an answered call can
// never connect (the ">30s backgrounded" stuck-connecting bug).
func TestCallIceBufferedAndFlushedForOfflineCallee(t *testing.T) {
	relay := newMemRelay()
	notif := &fakeNotifier{ch: make(chan string, 4)}
	srv := httptest.NewServer(ws.Handler(ws.NewHub(), relay, notif, testAuth, nil))
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	time.Sleep(50 * time.Millisecond)

	// B is offline → A sends the offer, then trickles two ICE candidates.
	if err := a.WriteJSON(map[string]any{
		"t": "call-offer", "to": "user-b", "callId": "c3", "kind": "audio", "ciphertext": "SDP_A",
	}); err != nil {
		t.Fatalf("A call-offer: %v", err)
	}
	for _, cand := range []string{"ICE_1", "ICE_2"} {
		if err := a.WriteJSON(map[string]any{
			"t": "call-ice", "to": "user-b", "callId": "c3", "ciphertext": cand,
		}); err != nil {
			t.Fatalf("A call-ice: %v", err)
		}
	}
	// Let the server process + buffer them before B reconnects.
	time.Sleep(100 * time.Millisecond)

	// B reconnects → receives the offer first, then both candidates in order.
	b := dial(t, srv, "tokB")
	defer b.Close()
	if got := readFrame(t, b); got["t"] != "call-offer" || got["callId"] != "c3" {
		t.Fatalf("B expected the buffered call-offer first, got: %v", got)
	}
	for _, want := range []string{"ICE_1", "ICE_2"} {
		got := readFrame(t, b)
		if got["t"] != "call-ice" || got["from"] != "user-a" || got["ciphertext"] != want {
			t.Fatalf("B expected buffered call-ice %q in order, got: %v", want, got)
		}
	}
}

// An initiator's group call-join (carrying the member list) rings the rest of the
// group with a live call-group-invite - the server has no group object, so the
// initiator supplies who to ring. Nothing is durably queued.
func TestGroupCallJoinRingsMembers(t *testing.T) {
	srv, relay := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// A starts a group call in room g1 and asks the server to ring user-b.
	if err := a.WriteJSON(map[string]any{
		"t": "call-join", "roomId": "g1", "kind": "video", "members": []string{"user-b"},
	}); err != nil {
		t.Fatalf("A call-join: %v", err)
	}

	// A (in the room) gets the roster; B (not in the room) gets the ring invite.
	if gotA := readFrame(t, a); gotA["t"] != "call-roster" || gotA["roomId"] != "g1" {
		t.Fatalf("A expected call-roster for g1, got: %v", gotA)
	}
	gotB := readFrame(t, b)
	if gotB["t"] != "call-group-invite" || gotB["roomId"] != "g1" ||
		gotB["from"] != "user-a" || gotB["kind"] != "video" {
		t.Fatalf("B expected call-group-invite from user-a for g1, got: %v", gotB)
	}

	// Not durably queued - a missed group ring is a missed call, not a stored msg.
	if items, _ := relay.PendingForRecipient(nil, "user-b"); len(items) != 0 {
		t.Fatalf("group invites must not be durably queued; found %d for user-b", len(items))
	}
}

// A later joiner (no member list) must NOT re-ring the group: only the first join
// carrying members rings, so accepting an invite never re-notifies everyone.
func TestGroupCallSecondJoinDoesNotRering(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// A initiates and rings B.
	if err := a.WriteJSON(map[string]any{
		"t": "call-join", "roomId": "g2", "kind": "audio", "members": []string{"user-b"},
	}); err != nil {
		t.Fatalf("A call-join: %v", err)
	}
	if gotA := readFrame(t, a); gotA["t"] != "call-roster" { // A: roster [user-a]
		t.Fatalf("A expected call-roster, got: %v", gotA)
	}
	if gotB := readFrame(t, b); gotB["t"] != "call-group-invite" { // B: the ring
		t.Fatalf("B expected call-group-invite, got: %v", gotB)
	}

	// B accepts → joins WITHOUT a member list (roster now has 2). Both get the
	// updated roster; neither gets a (re-)invite.
	if err := b.WriteJSON(map[string]any{"t": "call-join", "roomId": "g2", "kind": "audio"}); err != nil {
		t.Fatalf("B call-join: %v", err)
	}
	if gotA := readFrame(t, a); gotA["t"] != "call-roster" {
		t.Fatalf("A expected call-roster after B joined (no re-invite), got: %v", gotA)
	}
	if gotB := readFrame(t, b); gotB["t"] != "call-roster" {
		t.Fatalf("B expected call-roster after joining, got: %v", gotB)
	}
}

// A member missing the group key asks the master to resend it; the request is
// relayed live to the addressed master (stamped with the requester as sender).
func TestGroupCallKeyRequestRelayed(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// B (missing the key) asks the master A to resend.
	if err := b.WriteJSON(map[string]any{
		"t": "call-key-request", "to": "user-a", "roomId": "g3",
	}); err != nil {
		t.Fatalf("B call-key-request: %v", err)
	}
	got := readFrame(t, a)
	if got["t"] != "call-key-request" || got["from"] != "user-b" || got["roomId"] != "g3" {
		t.Fatalf("A expected call-key-request from user-b for g3, got: %v", got)
	}
}

func TestGroupCallStreamIdRelayed(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// B announces (sealed) which stream id is theirs to A; the server relays it live,
	// stamping the sender, without inspecting the opaque ciphertext.
	if err := b.WriteJSON(map[string]any{
		"t": "call-streamid", "to": "user-a", "roomId": "g4", "ciphertext": map[string]any{"v": 1},
	}); err != nil {
		t.Fatalf("B call-streamid: %v", err)
	}
	got := readFrame(t, a)
	if got["t"] != "call-streamid" || got["from"] != "user-b" || got["roomId"] != "g4" {
		t.Fatalf("A expected call-streamid from user-b for g4, got: %v", got)
	}
	if got["ciphertext"] == nil {
		t.Fatalf("A expected the sealed ciphertext to be relayed, got: %v", got)
	}
}
