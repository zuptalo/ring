package push

import "encoding/json"

// Prefs are a device's push routing preferences (spec 1050), stored as JSONB on
// its push_subscriptions row and replaced whole (never diffed — FR-011). They gate
// ONLY the content-free tickle: delivery, drain, ack, receipts and blocking are
// identical for every frame regardless of anything here.
//
// Zero-knowledge ledger (spec 1050 ZK Impact, user-approved): the server learns a
// coarse per-frame class, an opaque per-conversation route id, and this posture —
// nothing readable. Empty/absent/malformed prefs mean "push everything", which is
// exactly the pre-1050 behavior and the old-client interop story (FR-006).
type Prefs struct {
	// ClassesOff lists frame classes this device never wants to be woken for.
	ClassesOff []string `json:"classesOff"`
	// MutedPrids lists opaque conversation route ids the device muted. Hidden
	// chats are structurally absent — the CLIENT never registers them (FR-008c).
	MutedPrids []string `json:"mutedPrids"`
	// PostSenders refine the `post` class per author: Muted always holds that
	// author's post tickles; Always pushes them even past a global post opt-out
	// (the per-friend "notify me about new posts" control, FR-008a).
	PostSenders struct {
		Muted  []string `json:"muted"`
		Always []string `json:"always"`
	} `json:"postSenders"`
}

// ParsePrefs decodes a stored prefs blob. Malformed or empty input degrades to
// the zero value — push everything — never an error that could block a tickle.
func ParsePrefs(raw []byte) (Prefs, error) {
	var p Prefs
	if len(raw) == 0 {
		return p, nil
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return Prefs{}, nil //nolint:nilerr // degrade open: a broken blob must not silence a device
	}
	return p, nil
}

func inList(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// AllowPush is the per-subscription push gate — contract rows 3–7b of
// contracts/push-routing.md, evaluated in order. Rows 1–2 (recipient blocked the
// sender; recipient is active-fresh with a successful live send) are decided by
// the callers before any tickle is considered. `class` is the sender-set coarse
// frame class (absent = "message" — old clients), `prid` the opaque route id
// (absent = matches no mute), `sender` the frame's sender id (used only for the
// per-author post overrides).
func AllowPush(class, prid, sender string, p Prefs) bool {
	if class == "" {
		class = "message"
	}
	// Row 3: housekeeping is never notification-worthy, by the sender's own word.
	if class == "housekeeping" {
		return false
	}
	// Row 4: a personally-directed frame pierces every preference below, exactly
	// as mentions pierce mutes on-device (specs 1020/1048 parity, FR-008b). The
	// trust boundary is unchanged: only connected, unblocked peers reach this path.
	if class == "mention" {
		return true
	}
	// Row 7b before the class check: the per-friend "always" override is the whole
	// point of that control — it must beat a global post opt-out (FR-008a).
	if class == "post" && inList(p.PostSenders.Always, sender) {
		return true
	}
	// Row 5: class opt-out.
	if inList(p.ClassesOff, class) {
		return false
	}
	// Row 6: muted conversation.
	if prid != "" && inList(p.MutedPrids, prid) {
		return false
	}
	// Row 7: per-author post mute.
	if class == "post" && inList(p.PostSenders.Muted, sender) {
		return false
	}
	// Row 8: push (the existing debounced tickle machinery takes it from here).
	return true
}
