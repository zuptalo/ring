package ws_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"ring/server/internal/ws"
)

// callServer builds a relay server WITH a notifier, so the group-ring reminder loop
// (which no-ops without a notifier) is actually armed.
func callServer(t *testing.T) *httptest.Server {
	t.Helper()
	notif := &fakeNotifier{ch: make(chan string, 64)} // big buffer: reminders push each round
	return httptest.NewServer(ws.Handler(ws.NewHub(), newMemRelay(), notif, testAuth, nil))
}

// Positive control: a group invitee who neither joins nor declines keeps getting
// reminded — proves the reminder loop (and the test cadence seam) is live.
func TestGroupRingReminderRerings(t *testing.T) {
	defer ws.SetGroupRingCadenceForTest(120*time.Millisecond, 5)()
	srv := callServer(t)
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	if err := a.WriteJSON(map[string]any{
		"t": "call-join", "roomId": "g1", "kind": "audio", "members": []string{"user-b"},
	}); err != nil {
		t.Fatalf("A call-join: %v", err)
	}
	if got := readFrame(t, a); got["t"] != "call-roster" {
		t.Fatalf("A expected roster, got %v", got)
	}
	if got := readFrame(t, b); got["t"] != "call-group-invite" {
		t.Fatalf("B expected initial invite, got %v", got)
	}
	if got := readFrame(t, b); got["t"] != "call-group-invite" {
		t.Fatalf("B expected a reminder re-ring, got %v", got)
	}
}

// Regression (spec 0004 US1): a group invitee who DECLINES (sends call-leave for the
// room) must stop the server's re-ring reminders — no further invites arrive.
func TestGroupDeclineStopsRering(t *testing.T) {
	defer ws.SetGroupRingCadenceForTest(120*time.Millisecond, 5)()
	srv := callServer(t)
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	if err := a.WriteJSON(map[string]any{
		"t": "call-join", "roomId": "g1", "kind": "audio", "members": []string{"user-b"},
	}); err != nil {
		t.Fatalf("A call-join: %v", err)
	}
	if got := readFrame(t, a); got["t"] != "call-roster" {
		t.Fatalf("A expected roster, got %v", got)
	}
	if got := readFrame(t, b); got["t"] != "call-group-invite" {
		t.Fatalf("B expected initial invite, got %v", got)
	}
	// B declines → tells the server it won't join this room.
	if err := b.WriteJSON(map[string]any{"t": "call-leave", "roomId": "g1"}); err != nil {
		t.Fatalf("B call-leave (decline): %v", err)
	}
	// No further re-ring should arrive across several reminder intervals.
	_ = b.SetReadDeadline(time.Now().Add(600 * time.Millisecond))
	if _, data, err := b.ReadMessage(); err == nil {
		t.Fatalf("REGRESSION: B re-rung after declining: %s", data)
	}
}

// Regression (spec 0004 US2): a busy invitee replying to a group invite with a roomId-scoped
// call-busy is relayed to the caller AND stops the server re-ringing the busy member.
func TestGroupBusyRelayedAndStopsRering(t *testing.T) {
	defer ws.SetGroupRingCadenceForTest(120*time.Millisecond, 5)()
	srv := callServer(t)
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	if err := a.WriteJSON(map[string]any{
		"t": "call-join", "roomId": "g1", "kind": "audio", "members": []string{"user-b"},
	}); err != nil {
		t.Fatalf("A call-join: %v", err)
	}
	if got := readFrame(t, a); got["t"] != "call-roster" {
		t.Fatalf("A expected roster, got %v", got)
	}
	if got := readFrame(t, b); got["t"] != "call-group-invite" {
		t.Fatalf("B expected initial invite, got %v", got)
	}
	// B is busy → replies busy to the caller, scoped by roomId.
	if err := b.WriteJSON(map[string]any{"t": "call-busy", "to": "user-a", "roomId": "g1"}); err != nil {
		t.Fatalf("B call-busy: %v", err)
	}
	// A learns B is unavailable (busy relayed with the authoritative sender stamped).
	got := readFrame(t, a)
	if got["t"] != "call-busy" || got["from"] != "user-b" || got["roomId"] != "g1" {
		t.Fatalf("A expected call-busy from user-b for g1, got %v", got)
	}
	// B is not re-rung after replying busy.
	_ = b.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	if _, data, err := b.ReadMessage(); err == nil {
		t.Fatalf("REGRESSION: B re-rung after replying busy: %s", data)
	}
}

// Regression (spec 0004 US3): an over-cap call-join is refused by the server with a call-full
// frame to the joiner and NO roster broadcast (the existing call is undisturbed).
func TestVideoCallCapRefusesOverCapJoin(t *testing.T) {
	// Shrink the video cap to 2 so the test needs only 3 participants.
	defer ws.SetVideoMaxForTest(2)()
	srv, _ := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	cc := dial(t, srv, "tokC")
	defer cc.Close()
	time.Sleep(50 * time.Millisecond)

	// A and B fill the 2-seat video room.
	if err := a.WriteJSON(map[string]any{"t": "call-join", "roomId": "g1", "kind": "video"}); err != nil {
		t.Fatalf("A join: %v", err)
	}
	if got := readFrame(t, a); got["t"] != "call-roster" {
		t.Fatalf("A expected roster, got %v", got)
	}
	if err := b.WriteJSON(map[string]any{"t": "call-join", "roomId": "g1", "kind": "video"}); err != nil {
		t.Fatalf("B join: %v", err)
	}
	readFrame(t, a) // roster [a,b]
	readFrame(t, b) // roster [a,b]

	// C tries to join the full room → gets call-full, and A/B get NO further roster.
	if err := cc.WriteJSON(map[string]any{"t": "call-join", "roomId": "g1", "kind": "video"}); err != nil {
		t.Fatalf("C join: %v", err)
	}
	got := readFrame(t, cc)
	if got["t"] != "call-full" || got["roomId"] != "g1" {
		t.Fatalf("C expected call-full for g1, got %v", got)
	}
	_ = a.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, data, err := a.ReadMessage(); err == nil {
		t.Fatalf("A should see no roster change for a refused join, got %s", data)
	}
}
