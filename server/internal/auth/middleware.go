package auth

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey int

const (
	userIDKey ctxKey = iota
	tokenHashKey
)

// TokenVerifier resolves a token hash to a user id. Returns found=false when no
// token matches. Implemented by the tokens store.
type TokenVerifier interface {
	UserIDForToken(ctx context.Context, tokenHash []byte) (userID string, found bool, err error)
}

// Middleware authenticates requests via "Authorization: Bearer <token>". On
// success it stashes the user id and token hash in the request context;
// otherwise it responds 401 (or 500 if the lookup itself fails).
func Middleware(v TokenVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := bearer(r)
			if !ok {
				http.Error(w, "missing bearer token", http.StatusUnauthorized)
				return
			}
			hash := HashToken(token)
			uid, found, err := v.UserIDForToken(r.Context(), hash)
			if err != nil {
				http.Error(w, "auth lookup failed", http.StatusInternalServerError)
				return
			}
			if !found {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), userIDKey, uid)
			ctx = context.WithValue(ctx, tokenHashKey, hash)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserID returns the authenticated user id from a request context.
func UserID(ctx context.Context) (string, bool) {
	uid, ok := ctx.Value(userIDKey).(string)
	return uid, ok
}

// TokenHash returns the authenticated request's token hash from its context.
func TokenHash(ctx context.Context) ([]byte, bool) {
	h, ok := ctx.Value(tokenHashKey).([]byte)
	return h, ok
}

func bearer(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return "", false
	}
	token := strings.TrimSpace(h[len(prefix):])
	return token, token != ""
}
