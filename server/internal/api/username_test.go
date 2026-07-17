package api

import "testing"

func TestNormalizeUsername(t *testing.T) {
	cases := []struct {
		raw      string
		wantUser string
		wantFold string
		wantOK   bool
	}{
		{"Alice", "Alice", "alice", true},
		{"  bob  ", "bob", "bob", true}, // trimmed
		{"a.b_c", "a.b_c", "a.b_c", true},
		{"ABC", "ABC", "abc", true}, // case preserved, folded for uniqueness
		{"ab", "", "", false},       // too short
		{".bad", "", "", false},     // leading dot
		{"bad.", "", "", false},     // trailing dot
		{"no..dots", "", "", false}, // consecutive dots
		{"has space", "", "", false},
		{"admin", "", "", false},  // reserved
		{"GHOST", "", "", false},  // reserved, case-folded
		{"", "", "", false},
	}
	for _, c := range cases {
		user, fold, ok := normalizeUsername(c.raw)
		if ok != c.wantOK || user != c.wantUser || fold != c.wantFold {
			t.Errorf("normalizeUsername(%q) = (%q,%q,%v), want (%q,%q,%v)",
				c.raw, user, fold, ok, c.wantUser, c.wantFold, c.wantOK)
		}
	}
}
