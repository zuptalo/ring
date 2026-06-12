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
