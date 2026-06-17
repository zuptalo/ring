package ws_test

import (
	"context"
	"testing"
	"time"

	"ring/server/internal/store"
)

// pollSeen waits briefly for the relay's RecordSeen (which runs right after the live
// relay in the same handler goroutine) to land, then returns the recorded rows.
func pollSeen(relay *memRelay, sender string, ids []string) []store.Seen {
	deadline := time.Now().Add(time.Second)
	for {
		rows, _ := relay.SeenFor(context.Background(), sender, ids)
		if len(rows) > 0 || time.Now().After(deadline) {
			return rows
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// A client 'seen' receipt (spec 1010) is relayed to the message author from-stamped
// AND durably recorded, so "Seen X/N" survives the sender being offline. Mirrors the
// 'ack' → RecordDelivery durability.
func TestRelaySeenReceiptRelayedAndRecorded(t *testing.T) {
	srv, relay := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	// B (a recipient) reports it SAW A's message m1 → routed to A (the author),
	// from-stamped to the authenticated viewer.
	if err := b.WriteJSON(map[string]any{"t": "receipt", "messageId": "m1", "status": "seen", "to": "user-a"}); err != nil {
		t.Fatalf("B send seen receipt: %v", err)
	}
	got := readFrame(t, a)
	if got["t"] != "receipt" || got["messageId"] != "m1" || got["status"] != "seen" || got["from"] != "user-b" {
		t.Fatalf("A expected seen receipt from user-b, got: %v", got)
	}

	// ...and it was durably recorded for the author's reconcile (one row per member).
	rows := pollSeen(relay, "user-a", []string{"m1"})
	if len(rows) != 1 || rows[0].Recipient != "user-b" || rows[0].MsgID != "m1" {
		t.Fatalf("expected one recorded seen for user-b/m1, got: %v", rows)
	}
}

// Post-cutover (spec 1010) the server no longer accepts a client-originated 'read';
// such a receipt is dropped (and never recorded), like the forged 'sent'/'delivered'.
func TestRelayDropsClientReadReceiptPostCutover(t *testing.T) {
	srv, relay := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	if err := b.WriteJSON(map[string]any{"t": "receipt", "messageId": "m1", "status": "read", "to": "user-a"}); err != nil {
		t.Fatalf("B send read receipt: %v", err)
	}
	_ = a.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := a.ReadMessage(); err == nil {
		t.Fatal("A must receive nothing for a post-cutover 'read' receipt")
	}
	if rows, _ := relay.SeenFor(context.Background(), "user-a", []string{"m1"}); len(rows) != 0 {
		t.Fatalf("a dropped 'read' must not be recorded as seen, got: %v", rows)
	}
}

// A 'downloaded' receipt still relays (media-bytes signal so the sender can free the
// blob), but it is NOT recorded in the seen store (it's not a "seen" confirmation).
func TestRelayDownloadedNotRecordedAsSeen(t *testing.T) {
	srv, relay := newRelayServer()
	defer srv.Close()

	a := dial(t, srv, "tokA")
	defer a.Close()
	b := dial(t, srv, "tokB")
	defer b.Close()
	time.Sleep(50 * time.Millisecond)

	if err := b.WriteJSON(map[string]any{"t": "receipt", "messageId": "m1", "status": "downloaded", "to": "user-a"}); err != nil {
		t.Fatalf("B send downloaded receipt: %v", err)
	}
	got := readFrame(t, a)
	if got["t"] != "receipt" || got["status"] != "downloaded" || got["from"] != "user-b" {
		t.Fatalf("A expected a downloaded receipt from user-b, got: %v", got)
	}
	// Give the handler a moment, then confirm nothing was recorded as seen.
	time.Sleep(100 * time.Millisecond)
	if rows, _ := relay.SeenFor(context.Background(), "user-a", []string{"m1"}); len(rows) != 0 {
		t.Fatalf("'downloaded' must not be recorded as seen, got: %v", rows)
	}
}

// The seen store's contract (encoded by the in-memory fake the way store/seen.go's
// SQL is): RecordSeen is idempotent, and SeenFor returns one row per member for a
// group message — the shape POST /v1/seen/check relies on to rebuild "Seen X/N".
func TestSeenStoreIdempotentAndPerMember(t *testing.T) {
	relay := newMemRelay()
	ctx := context.Background()

	// Idempotent: recording the same (sender, recipient, msg) twice yields one row.
	_ = relay.RecordSeen(ctx, "author", "memberA", "g1")
	_ = relay.RecordSeen(ctx, "author", "memberA", "g1")
	if rows, _ := relay.SeenFor(ctx, "author", []string{"g1"}); len(rows) != 1 {
		t.Fatalf("RecordSeen not idempotent: got %d rows, want 1", len(rows))
	}

	// One row per member for the same group message id.
	_ = relay.RecordSeen(ctx, "author", "memberB", "g1")
	rows, _ := relay.SeenFor(ctx, "author", []string{"g1"})
	if len(rows) != 2 {
		t.Fatalf("expected one seen row per member (2), got %d: %v", len(rows), rows)
	}

	// Scoped to the querying sender: another author's lookup sees nothing.
	if other, _ := relay.SeenFor(ctx, "someone-else", []string{"g1"}); len(other) != 0 {
		t.Fatalf("SeenFor must be sender-scoped, got: %v", other)
	}
}
