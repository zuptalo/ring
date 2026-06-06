package ws

import (
	"testing"

	"ring/server/internal/store"
)

func TestPresenceTierGating(t *testing.T) {
	pi := func(onlineTier, lastSeenTier string) store.PresenceInfo {
		return store.PresenceInfo{LastSeenMs: 1000, OnlineTier: onlineTier, LastSeenTier: lastSeenTier}
	}

	// everyone tier → online/lastSeen visible to anyone (in or out of audience).
	f := presenceFrame("u", true, pi("everyone", "everyone"), false)
	if !f.Online || f.LastSeen != 1000 {
		t.Fatalf("everyone tier should reveal to a non-contact: %+v", f)
	}

	// contacts tier → visible to an audience member, hidden from a stranger.
	f = presenceFrame("u", true, pi("contacts", "contacts"), true)
	if !f.Online || f.LastSeen != 1000 {
		t.Fatalf("contacts tier should reveal to an audience member: %+v", f)
	}
	f = presenceFrame("u", true, pi("contacts", "contacts"), false)
	if f.Online || f.LastSeen != 0 {
		t.Fatalf("contacts tier should hide from a stranger: %+v", f)
	}

	// nobody tier → never visible, even to an audience member.
	f = presenceFrame("u", true, pi("nobody", "nobody"), true)
	if f.Online || f.LastSeen != 0 {
		t.Fatalf("nobody tier should always hide: %+v", f)
	}

	// mixed: online everyone, last-seen contacts-only → stranger sees online, not last-seen.
	f = presenceFrame("u", true, pi("everyone", "contacts"), false)
	if !f.Online || f.LastSeen != 0 {
		t.Fatalf("mixed tiers: %+v", f)
	}
}
