package api

import (
	"regexp"
	"strings"
)

// usernameRE mirrors the client's USERNAME_RE (src/services/auth.ts): 3-30 chars,
// ASCII letters/digits/underscore plus interior dots, can't start or end with a
// dot. Case is preserved for display; uniqueness folds to lowercase.
var usernameRE = regexp.MustCompile(`^[A-Za-z0-9_](?:[A-Za-z0-9_.]{1,28}[A-Za-z0-9_])$`)

// reservedUsernames are handles that can't be claimed (folded to lowercase). They
// would be confusing or impersonate the system/UI.
var reservedUsernames = map[string]bool{
	"admin": true, "administrator": true, "root": true, "system": true,
	"ring": true, "ringd": true, "support": true, "help": true, "info": true,
	"me": true, "you": true, "self": true, "null": true, "undefined": true,
	"everyone": true, "here": true, "all": true, "none": true, "nobody": true,
	"ghost": true, "ghosted": true, "deleted": true, "anonymous": true,
}

// normalizeUsername validates a requested username and returns its canonical
// (trimmed, case-preserved) form plus the case-folded uniqueness key. ok is false
// if the format is invalid, the name is reserved, or it contains consecutive dots.
func normalizeUsername(raw string) (username, fold string, ok bool) {
	username = strings.TrimSpace(raw)
	if !usernameRE.MatchString(username) {
		return "", "", false
	}
	if strings.Contains(username, "..") {
		return "", "", false
	}
	fold = strings.ToLower(username)
	if reservedUsernames[fold] {
		return "", "", false
	}
	return username, fold, true
}
