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

// Recall: a caller already in the room can re-ring ONE invitee who hasn't joined (the
// per-tile "ring again" button) via a call-ring frame, which re-sends the invite.
func TestGroupCallRecallRingsMember(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// A starts a group call in g2 ringing B; A is now in the room, B gets the initial ring.
	if err := a.WriteJSON(map[string]any{
		"t": "call-join", "roomId": "g2", "kind": "audio", "members": []string{"user-b"},
	}); err != nil {
		t.Fatalf("A call-join: %v", err)
	}
	if gotA := readFrame(t, a); gotA["t"] != "call-roster" {
		t.Fatalf("A expected call-roster, got: %v", gotA)
	}
	if gotB := readFrame(t, b); gotB["t"] != "call-group-invite" {
		t.Fatalf("B expected the initial call-group-invite, got: %v", gotB)
	}

	// B still hasn't joined → A taps recall, re-ringing just B.
	if err := a.WriteJSON(map[string]any{
		"t": "call-ring", "roomId": "g2", "to": "user-b", "kind": "audio", "members": []string{"user-b"},
	}); err != nil {
		t.Fatalf("A call-ring (recall): %v", err)
	}
	gotB := readFrame(t, b)
	if gotB["t"] != "call-group-invite" || gotB["roomId"] != "g2" || gotB["from"] != "user-a" {
		t.Fatalf("B expected a re-ring call-group-invite for g2, got: %v", gotB)
	}
}

// A non-participant cannot recall-ring into a room they aren't in (no unsolicited rings).
func TestGroupCallRecallRequiresMembership(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// A is NOT in room g3; a recall must be ignored (B receives nothing).
	if err := a.WriteJSON(map[string]any{
		"t": "call-ring", "roomId": "g3", "to": "user-b", "kind": "audio", "members": []string{"user-b"},
	}); err != nil {
		t.Fatalf("A call-ring: %v", err)
	}
	_ = b.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := b.ReadMessage(); err == nil {
		t.Fatal("B should receive nothing from a non-participant's recall")
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

// spec 2012 US1: a 1:1 offer delivered LIVE to an online callee is ALSO retained, so a callee
// that reloads mid-ring (its in-memory call state and the offer lost) re-rings on reconnect via
// flushBufferedCalls() and can still answer.
func TestCallOfferReDeliveredToReloadedCallee(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	time.Sleep(50 * time.Millisecond)

	// A calls B (online) → B gets it live, A flips to ringing.
	if err := a.WriteJSON(map[string]any{
		"t": "call-offer", "to": "user-b", "callId": "c-reload", "kind": "video", "ciphertext": "SDP_A",
	}); err != nil {
		t.Fatalf("A call-offer: %v", err)
	}
	if got := readFrame(t, b); got["t"] != "call-offer" || got["callId"] != "c-reload" {
		t.Fatalf("B expected live call-offer, got: %v", got)
	}
	if got := readFrame(t, a); got["t"] != "call-ringing" {
		t.Fatalf("A expected call-ringing, got: %v", got)
	}

	// B reloads: drop its socket and reconnect (call still active).
	b.Close()
	time.Sleep(50 * time.Millisecond)
	b2 := dial(t, srv, "tokB")
	defer b2.Close()

	// The retained offer is re-delivered → B's incoming-call screen comes back.
	got := readFrame(t, b2)
	if got["t"] != "call-offer" || got["callId"] != "c-reload" || got["from"] != "user-a" {
		t.Fatalf("reloaded B expected the recovered call-offer, got: %v", got)
	}
	if got["ciphertext"] != "SDP_A" {
		t.Fatalf("recovered offer must carry the same opaque ciphertext, got: %v", got["ciphertext"])
	}
}

// spec 2012 US1 FR-003: once a 1:1 call RESOLVES (here, B answers), its retained invite is
// cleared, so a later B reconnect does NOT re-ring a call that's already over (no ghost ring).
func TestResolvedCallNotReDeliveredOnReconnect(t *testing.T) {
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	time.Sleep(50 * time.Millisecond)

	if err := a.WriteJSON(map[string]any{
		"t": "call-offer", "to": "user-b", "callId": "c-done", "kind": "audio", "ciphertext": "SDP_A",
	}); err != nil {
		t.Fatalf("A call-offer: %v", err)
	}
	if got := readFrame(t, b); got["t"] != "call-offer" {
		t.Fatalf("B expected live call-offer, got: %v", got)
	}
	if got := readFrame(t, a); got["t"] != "call-ringing" {
		t.Fatalf("A expected call-ringing, got: %v", got)
	}

	// B answers → the call is settled; the retained invite must be cleared.
	if err := b.WriteJSON(map[string]any{"t": "call-answer", "to": "user-a", "callId": "c-done", "ciphertext": "SDP_B"}); err != nil {
		t.Fatalf("B call-answer: %v", err)
	}
	if got := readFrame(t, a); got["t"] != "call-answer" {
		t.Fatalf("A expected call-answer, got: %v", got)
	}
	time.Sleep(50 * time.Millisecond)

	// B reconnects later → NO ghost incoming call for the settled c-done.
	b.Close()
	time.Sleep(50 * time.Millisecond)
	b2 := dial(t, srv, "tokB")
	defer b2.Close()
	_ = b2.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	if _, _, err := b2.ReadMessage(); err == nil {
		t.Fatal("reconnecting B must NOT re-ring a call that was already answered")
	}
}

// spec 2012 US2 FR-005: when the callee's socket drops mid-ring and they do NOT re-ack within
// the grace, the caller is told the callee is unreachable (call-end{reason:"unreachable"}) so it
// ends promptly instead of ringing out the full no-answer window.
func TestCallerNotifiedWhenCalleeVanishes(t *testing.T) {
	defer ws.SetRingDropGraceForTest(150 * time.Millisecond)()
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	time.Sleep(50 * time.Millisecond)

	if err := a.WriteJSON(map[string]any{
		"t": "call-offer", "to": "user-b", "callId": "c-gone", "kind": "video", "ciphertext": "SDP_A",
	}); err != nil {
		t.Fatalf("A call-offer: %v", err)
	}
	if got := readFrame(t, b); got["t"] != "call-offer" {
		t.Fatalf("B expected live call-offer, got: %v", got)
	}
	if got := readFrame(t, a); got["t"] != "call-ringing" {
		t.Fatalf("A expected call-ringing, got: %v", got)
	}

	// B vanishes (closes and does NOT come back) → after the grace, A is told it's unreachable.
	b.Close()
	got := readFrame(t, a) // readFrame allows up to 2s; the 150ms grace fires well within it
	if got["t"] != "call-end" || got["reason"] != "unreachable" || got["callId"] != "c-gone" {
		t.Fatalf("A expected call-end{reason:unreachable} for c-gone, got: %v", got)
	}
}

// spec 2012 US2 scenario 2 / FR-006: a callee that drops but reconnects, recovers the offer, and
// re-acks ringing WITHIN the grace must NOT cause the caller's call to falsely end.
func TestCallerNotEndedWhenCalleeReAcksWithinGrace(t *testing.T) {
	defer ws.SetRingDropGraceForTest(700 * time.Millisecond)()
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	time.Sleep(50 * time.Millisecond)

	if err := a.WriteJSON(map[string]any{
		"t": "call-offer", "to": "user-b", "callId": "c-flap", "kind": "video", "ciphertext": "SDP_A",
	}); err != nil {
		t.Fatalf("A call-offer: %v", err)
	}
	if got := readFrame(t, b); got["t"] != "call-offer" {
		t.Fatalf("B expected live call-offer, got: %v", got)
	}
	if got := readFrame(t, a); got["t"] != "call-ringing" {
		t.Fatalf("A expected the initial call-ringing, got: %v", got)
	}

	// B reloads: drop, reconnect, receive the recovered offer, and re-ack by echoing call-ringing
	// (the foregrounded in-app re-ack path) — all within the grace.
	b.Close()
	time.Sleep(50 * time.Millisecond)
	b2 := dial(t, srv, "tokB")
	defer b2.Close()
	if got := readFrame(t, b2); got["t"] != "call-offer" || got["callId"] != "c-flap" {
		t.Fatalf("reloaded B expected the recovered offer, got: %v", got)
	}
	if err := b2.WriteJSON(map[string]any{"t": "call-ringing", "to": "user-a", "callId": "c-flap"}); err != nil {
		t.Fatalf("B re-ack call-ringing: %v", err)
	}
	// A receives the re-acked call-ringing (still reachable) ...
	if got := readFrame(t, a); got["t"] != "call-ringing" || got["callId"] != "c-flap" {
		t.Fatalf("A expected the re-acked call-ringing, got: %v", got)
	}
	// ... and must NOT subsequently receive a terminal unreachable frame (grace was cancelled).
	_ = a.SetReadDeadline(time.Now().Add(900 * time.Millisecond))
	if _, data, err := a.ReadMessage(); err == nil {
		t.Fatalf("A must NOT receive a terminal frame after a within-grace re-ack, got: %s", data)
	}
}

// NOTE: the SFU-era call-key-request / call-streamid relays were removed with the SFU
// (spec 0004 US6) — the mesh distributes nothing of the sort, so those tests are gone.
