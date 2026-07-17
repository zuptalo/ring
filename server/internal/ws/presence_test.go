package ws

import (
	"testing"

	"ring/server/internal/store"
)

func TestPresenceGating(t *testing.T) {
	pi := func(onlineTier, lastSeenTier string) store.PresenceInfo {
		return store.PresenceInfo{LastSeenMs: 1000, OnlineTier: onlineTier, LastSeenTier: lastSeenTier}
	}

	// Contacts-only default: a contact (in audience) sees presence...
	f := presenceFrame("u", true, pi("everyone", "everyone"), true, "")
	if !f.Online || f.LastSeen != 1000 {
		t.Fatalf("a contact should see presence: %+v", f)
	}
	// ...but a non-contact never does, even on the (now-neutered) 'everyone' tier.
	f = presenceFrame("u", true, pi("everyone", "everyone"), false, "")
	if f.Online || f.LastSeen != 0 {
		t.Fatalf("a non-contact must not see presence: %+v", f)
	}

	// nobody tier → hidden even from a contact.
	f = presenceFrame("u", true, pi("nobody", "nobody"), true, "")
	if f.Online || f.LastSeen != 0 {
		t.Fatalf("nobody tier should always hide: %+v", f)
	}

	// Per-contact 'allow' override reveals to a non-contact regardless of tier.
	f = presenceFrame("u", true, pi("nobody", "nobody"), false, "allow")
	if !f.Online || f.LastSeen != 1000 {
		t.Fatalf("allow override should reveal: %+v", f)
	}

	// Per-contact 'deny' override hides from a contact regardless of tier.
	f = presenceFrame("u", true, pi("everyone", "everyone"), true, "deny")
	if f.Online || f.LastSeen != 0 {
		t.Fatalf("deny override should hide: %+v", f)
	}
}
