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
