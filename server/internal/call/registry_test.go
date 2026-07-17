package call

import "testing"

func TestSharesRoom(t *testing.T) {
	r := NewRegistry()

	// Nobody in any room yet.
	if r.SharesRoom("a", "b") {
		t.Fatal("empty registry should not report a shared room")
	}

	// a and b join the same room; c joins a different one.
	r.Join("room1", "a")
	r.Join("room1", "b")
	r.Join("room2", "c")

	if !r.SharesRoom("a", "b") {
		t.Fatal("a and b are in room1, want shared")
	}
	if !r.SharesRoom("b", "a") {
		t.Fatal("SharesRoom must be symmetric")
	}
	if r.SharesRoom("a", "c") {
		t.Fatal("a (room1) and c (room2) are not in a common room")
	}
	if r.SharesRoom("a", "ghost") {
		t.Fatal("a and an absent user do not share a room")
	}

	// When a leaves, the pair no longer shares a room.
	r.Leave("room1", "a")
	if r.SharesRoom("a", "b") {
		t.Fatal("a left room1, should no longer share with b")
	}
}

// JoinIfRoom admits up to max members, refuses an over-cap join without mutating, and
// always re-admits a user already in the room (idempotent re-join / ICE recovery).
func TestJoinIfRoom(t *testing.T) {
	r := NewRegistry()

	if roster, ok := r.JoinIfRoom("room", "a", 2); !ok || len(roster) != 1 {
		t.Fatalf("first join should be admitted, got ok=%v roster=%v", ok, roster)
	}
	if roster, ok := r.JoinIfRoom("room", "b", 2); !ok || len(roster) != 2 {
		t.Fatalf("second join (at cap-1) should be admitted, got ok=%v roster=%v", ok, roster)
	}
	// Room is now full (2/2): a third distinct user is refused, roster unchanged.
	roster, ok := r.JoinIfRoom("room", "c", 2)
	if ok {
		t.Fatalf("over-cap join should be refused")
	}
	if len(roster) != 2 {
		t.Fatalf("refused join must not mutate the room, got roster=%v", roster)
	}
	if r.InRoom("room", "c") {
		t.Fatal("refused user must not be in the room")
	}
	// An already-present user is always re-admitted even at cap (idempotent recovery).
	if _, ok := r.JoinIfRoom("room", "a", 2); !ok {
		t.Fatal("an already-present member must be re-admitted at cap")
	}
}
