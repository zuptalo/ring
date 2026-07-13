package push

import (
	"context"
	"testing"

	"ring/server/internal/store"
)

// prefsSubStore serves a fixed prefs blob (and no subscriptions).
type prefsSubStore struct{ raw []byte }

func (p prefsSubStore) SubscriptionsFor(context.Context, string) ([]store.PushSubscription, error) {
	return nil, nil
}
func (p prefsSubStore) DeleteSubscriptionByEndpoint(context.Context, string) error { return nil }
func (p prefsSubStore) PrefsFor(context.Context, string) ([]byte, error)           { return p.raw, nil }

// Spec 1050: NotifyFrame consults the stored prefs blob per hit — the loaded
// decision, end to end minus the network.
func TestNotifierAllowFrame(t *testing.T) {
	n := NewNotifier(NewSender("", "", "mailto:t@t"), prefsSubStore{raw: []byte(`{"classesOff":["reaction"],"mutedPrids":["m1"]}`)})
	ctx := context.Background()
	for _, tc := range []struct {
		class, prid string
		want        bool
	}{
		{"housekeeping", "", false},
		{"reaction", "", false},
		{"mention", "m1", true},
		{"message", "m1", false},
		{"message", "", true},
		{"", "", true}, // untagged old-client frame
	} {
		if got := n.allowFrame(ctx, "u1", tc.class, tc.prid); got != tc.want {
			t.Fatalf("allowFrame(%q,%q)=%v want %v", tc.class, tc.prid, got, tc.want)
		}
	}
}

// Spec 1050: the per-subscription push gate — contract rows 3–7b of
// specs/1050-quiet-housekeeping-frames/contracts/push-routing.md. Rows 1–2
// (blocking, active-fresh presence) are decided before this gate runs.
func TestAllowPush(t *testing.T) {
	prefs := Prefs{
		ClassesOff: []string{"reaction", "game"},
		MutedPrids: []string{"prid-muted"},
	}
	prefs.PostSenders.Muted = []string{"alice"}
	prefs.PostSenders.Always = []string{"bob"}
	postOff := Prefs{ClassesOff: []string{"post"}}
	postOff.PostSenders.Always = []string{"bob"}

	cases := []struct {
		name   string
		class  string
		prid   string
		sender string
		prefs  Prefs
		want   bool
	}{
		// Row 3: housekeeping never pushes, prefs irrelevant.
		{"housekeeping never", "housekeeping", "", "", Prefs{}, false},
		{"housekeeping ignores prefs", "housekeeping", "prid-x", "x", prefs, false},
		// Row 4: mention always pushes — pierces class opt-outs AND prid mutes.
		{"mention pierces muted prid", "mention", "prid-muted", "", prefs, true},
		{"mention pierces class off", "mention", "", "", Prefs{ClassesOff: []string{"mention", "message"}}, true},
		// Row 5: class opt-out.
		{"reaction opted out", "reaction", "", "", prefs, false},
		{"game opted out", "game", "", "", prefs, false},
		{"activity not opted out", "activity", "", "", prefs, true},
		// Row 6: prid mute applies to ordinary classes.
		{"message in muted conversation", "message", "prid-muted", "", prefs, false},
		{"message in other conversation", "message", "prid-live", "", prefs, true},
		{"reaction allowed class but muted prid", "reaction", "prid-muted", "", Prefs{MutedPrids: []string{"prid-muted"}}, false},
		// Row 7: per-sender post mute.
		{"post from muted sender", "post", "", "alice", prefs, false},
		{"post from ordinary sender", "post", "", "carol", prefs, true},
		// Row 7b: always-override beats the global post opt-out.
		{"post class off but sender always", "post", "", "bob", postOff, true},
		{"post class off, ordinary sender", "post", "", "carol", postOff, false},
		// Row 8 + interop: defaults push; absent class = message; empty prefs = everything.
		{"default class empty prefs", "message", "", "", Prefs{}, true},
		{"absent class treated as message", "", "prid-live", "", prefs, true},
		{"absent class in muted conversation", "", "prid-muted", "", prefs, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := AllowPush(tc.class, tc.prid, tc.sender, tc.prefs); got != tc.want {
				t.Fatalf("AllowPush(%q,%q,%q) = %v, want %v", tc.class, tc.prid, tc.sender, got, tc.want)
			}
		})
	}
}

func TestParsePrefs(t *testing.T) {
	p, err := ParsePrefs([]byte(`{"classesOff":["reaction"],"mutedPrids":["a"],"postSenders":{"muted":["m"],"always":["y"]}}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(p.ClassesOff) != 1 || p.ClassesOff[0] != "reaction" || len(p.MutedPrids) != 1 ||
		len(p.PostSenders.Muted) != 1 || len(p.PostSenders.Always) != 1 {
		t.Fatalf("parsed wrong: %+v", p)
	}
	// Empty / absent / malformed all degrade to push-everything (old behavior).
	for _, raw := range []string{"", "{}", "null", "not-json"} {
		p, _ := ParsePrefs([]byte(raw))
		if !AllowPush("message", "", "", p) || !AllowPush("reaction", "x", "s", p) {
			t.Fatalf("degraded prefs %q must push everything", raw)
		}
	}
}
