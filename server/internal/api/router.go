// Package api wires the HTTP surface: routing, middleware, and handlers.
package api

import (
	"context"
	"net/http"
	"time"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
	"ring/server/internal/store"
	"ring/server/internal/ws"
)

// AuthStore is the account/auth persistence the API depends on. *store.Store
// satisfies it; tests provide a fake.
type AuthStore interface {
	auth.TokenVerifier // UserIDForToken
	Register(ctx context.Context, code, username, usernameFold string, tokenHash []byte) (userID, inviterID string, err error)
	AddToken(ctx context.Context, userID string, tokenHash []byte) error
	TouchToken(ctx context.Context, tokenHash []byte) error
	DeleteUser(ctx context.Context, userID string) error
	UserStates(ctx context.Context, ids []string) (map[string]string, error)
	Ping(ctx context.Context) error
}

// DirectoryStore is the public in-network directory + self-profile persistence.
// *store.Store satisfies it; tests provide a fake.
type DirectoryStore interface {
	ListUsers(ctx context.Context, viewerID, query, cursor string, limit int) ([]store.DirectoryUser, string, error)
	GetUser(ctx context.Context, viewerID, targetID string) (*store.DirectoryUser, error)
	UserProfile(ctx context.Context, userID string) (*store.DirectoryUser, error)
	UpdateProfile(ctx context.Context, userID, displayName, avatar, about string) error
	ClaimUsername(ctx context.Context, userID, username, usernameFold string) error
}

// ContactStore is the per-user contact-edge persistence (for the presence
// 'contacts' audience). *store.Store satisfies it.
type ContactStore interface {
	SetContacts(ctx context.Context, owner string, contactIDs []string) error
}

// ConnectionStore is the connect-request relationship persistence (the gate state).
// *store.Store satisfies it.
type ConnectionStore interface {
	Connected(ctx context.Context, a, b string) (bool, error)
	ConnectionState(ctx context.Context, requester, target string) (string, error)
	RequestConnection(ctx context.Context, requester, target string) (string, error)
	AcceptConnection(ctx context.Context, target, requester string) error
	RejectConnection(ctx context.Context, target, requester string, block bool) error
	WithdrawConnection(ctx context.Context, requester, target string) error
	IncomingRequests(ctx context.Context, user string) ([]store.ConnectionReq, error)
	OutgoingRequests(ctx context.Context, user string) ([]store.ConnectionReq, error)
	// Spec 1040: OutgoingRequests + accepted rows updated within 24h, served only
	// for GET /v1/connections?include=accepted (the SW's accepted-note reconcile).
	OutgoingWithRecentAccepts(ctx context.Context, user string) ([]store.ConnectionReq, error)
	// Spec 2040: every accepted peer (either direction), served for
	// GET /v1/connections?include=friends — the ledger a recovered device
	// rebuilds its local friends list from.
	AcceptedPeers(ctx context.Context, user string) ([]string, error)
}

// BlockStore is the per-user block-list persistence. *store.Store satisfies it.
type BlockStore interface {
	Block(ctx context.Context, blocker, blocked string) error
	Unblock(ctx context.Context, blocker, blocked string) error
	ListBlocks(ctx context.Context, blocker string) ([]string, error)
	IsBlocked(ctx context.Context, blocker, blocked string) (bool, error)
}

// KeysStore is the prekey persistence the API depends on. *store.Store
// satisfies it; tests provide a fake.
type KeysStore interface {
	PublishBundle(ctx context.Context, userID string, b store.PublicBundle) error
	AddOneTimePreKeys(ctx context.Context, userID string, keys []store.OneTimePreKey) error
	OneTimePreKeyCount(ctx context.Context, userID string) (int, error)
	FetchBundle(ctx context.Context, targetUserID string) (*store.PeerBundle, error)
	EdPub(ctx context.Context, userID string) (string, bool, error)
}

// BlobStore is the encrypted-media persistence the API depends on.
type BlobStore interface {
	PutBlob(ctx context.Context, id, owner string, bytes []byte) error
	GetBlob(ctx context.Context, id string) ([]byte, bool, error)
	DeleteBlobOwnedBy(ctx context.Context, id, owner string) (bool, error)
}

// SyncStore is the encrypted own-data sync + recovery persistence.
type SyncStore interface {
	PushRecords(ctx context.Context, userID string, recs []store.SyncRecordIn) (int64, error)
	PullRecords(ctx context.Context, userID string, cursor int64, limit int) ([]store.SyncRecordOut, int64, error)
	PutRecoveryWrap(ctx context.Context, userID, salt, envelope, lookup string) error
	GetRecoveryWrap(ctx context.Context, userID string) (salt, envelope string, found bool, err error)
	FindByRecoveryLookup(ctx context.Context, lookup string) (userID, salt, envelope string, found bool, err error)
}

// PushStore is the Web Push subscription persistence.
type PushStore interface {
	SaveSubscription(ctx context.Context, userID string, sub store.PushSubscription, installedVersion *string, tzOffsetMinutes *int) error
	// SavePrefs replaces the user's push routing prefs whole (spec 1050).
	SavePrefs(ctx context.Context, userID string, prefs []byte) error
	DeleteSubscription(ctx context.Context, userID, endpoint string) error
}

// EmojiStore is the Postgres-backed cache for the self-hosted Noto emoji proxy.
type EmojiStore interface {
	GetEmoji(ctx context.Context, path string) (bytes []byte, contentType string, found bool, err error)
	PutEmoji(ctx context.Context, path, contentType string, bytes []byte) error
}

// InviteStore mints + lists user-generated invitation codes.
type InviteStore interface {
	CreateInvitation(ctx context.Context, creatorID string) (string, error)
	ListInvitations(ctx context.Context, creatorID string) ([]store.Invitation, error)
	ExtendInvitation(ctx context.Context, creatorID, code string) (time.Time, error)
	CancelInvitation(ctx context.Context, creatorID, code string) error
	// MintInvite creates a fresh, single-use code with no creator. Used only by
	// the dev-only mint endpoint (see Handlers.DevMode).
	MintInvite(ctx context.Context) (string, error)
}

// PostStore is the social-Wall persistence (spec 0003): opaque post ciphertext +
// per-recipient wrapped-key envelopes. *store.Store satisfies it. Engagement + view
// methods are added with US4/US7.
type PostStore interface {
	CreatePost(ctx context.Context, p store.NewPost) error
	ListPosts(ctx context.Context, recipient string, sinceMs int64) ([]store.PostForRecipient, error)
	DeletePost(ctx context.Context, author, id string) ([]string, error)
	KeepAlive(ctx context.Context, author, id string) (bool, error)
	AddEnvelopes(ctx context.Context, author, postID string, envs []store.NewPostEnvelope) ([]string, error)
	RemovePostRecipient(ctx context.Context, postID, author, recipient string) (bool, error)
	ListRevocations(ctx context.Context, recipient string) ([]string, error)
	RecentPostCount(ctx context.Context, author string, withinSec int) (int, error)
	RecentEngagementCount(ctx context.Context, actor string, withinSec int) (int, error)
	RecentCommentCount(ctx context.Context, postID, actor string, withinSec int) (int, error)
	CanSeePost(ctx context.Context, postID, user string) (bool, error)
	PostAudience(ctx context.Context, postID string) ([]string, error)
	GameParticipants(ctx context.Context, postID string) ([]string, error)
	GameFollowers(ctx context.Context, postID string) ([]string, error)
	PostAuthor(ctx context.Context, postID string) (string, error)
	SubmitEngagement(ctx context.Context, postID, id, actor, kind, payload string) error
	EngagementActor(ctx context.Context, postID, engID string) (string, error)
	ListEngagement(ctx context.Context, postID string, page store.EngagementPage) ([]store.PostEngagementRow, error)
	RecordView(ctx context.Context, postID, viewer string) error
	ListViews(ctx context.Context, postID string) ([]store.PostView, error)
}

// Handlers carries the dependencies the HTTP handlers need.
type Handlers struct {
	Store       AuthStore
	Directory   DirectoryStore
	Contacts    ContactStore
	Connections ConnectionStore
	Blocks      BlockStore
	Keys        KeysStore
	Relay       ws.RelayStore
	Hub         *ws.Hub
	Blobs       BlobStore
	Sync        SyncStore
	Push        PushStore
	Invites     InviteStore
	Posts       PostStore
	Notifier    ws.Notifier // sends push tickles when a relayed message can't be delivered live
	// Public, non-secret config advertised at GET /v1/config.
	PublicURL      string
	VapidPublicKey string
	// Version is the running server build (main.version, stamped via -ldflags),
	// advertised at GET /v1/config so a possibly-stale PWA can detect a new deploy.
	Version string
	// ReleaseNotes is this build's changelog since the last release tag (stamped via
	// -ldflags, decoded from base64 JSON), advertised at GET /v1/config so the PWA can
	// show a per-user "what's new" between the running and the newly deployed build.
	ReleaseNotes []ReleaseNote
	// MaxBlobBytes caps a single encrypted media upload (bytes); advertised at
	// GET /v1/config so clients can pre-validate before encrypting + uploading.
	MaxBlobBytes int
	// Calling (WebRTC). CallsEnabled gates GET /v1/turn-credentials; TurnSharedSecret
	// mints ephemeral TURN credentials; TurnURLs are the actually-reachable relay
	// URLs advertised to clients (turns:<host>:443 in prod, turn:<ip>:<port> in
	// dev). StunURLs, when the operator opted into the UDP endpoint, are the
	// credential-less stun: entries clients use to discover their public address
	// for direct call paths (spec 1043).
	CallsEnabled     bool
	TurnSharedSecret string
	TurnURLs         []string
	StunURLs         []string
	// Postgres-backed cache for the self-hosted Noto emoji proxy (GET /v1/emoji/...).
	Emoji EmojiStore
	// RequireConnection enables the server-enforced connect-request gate: fetching a
	// peer's prekey bundle (GET /v1/keys/{id}) requires an accepted connection, so an
	// unsolicited user cannot start a session. Off by default (open network); flip it
	// on (REQUIRE_CONNECTION=true) once clients use the connect-request flow.
	RequireConnection bool
	// StaticDir, when non-empty, is a directory of built PWA assets served at /
	// with SPA fallback so a single container serves the app and the API on the
	// same origin. Empty in dev/tests (Vite serves the client), so the catch-all
	// route is not mounted and the API 404s unknown paths as before.
	StaticDir string
	// DevProxy, when non-empty (dev only), reverse-proxies all non-API requests -
	// including the Vite HMR websocket - to this dev-server URL instead of serving
	// StaticDir, so the public dev URL gets true hot reload. Takes precedence over
	// StaticDir. Empty in production.
	DevProxy string
	// DevMode mounts dev/test-only routes (currently POST /v1/dev/invite, which
	// mints fresh invite codes for the e2e harness). Off in production.
	DevMode bool
}

// NewRouter builds the fully wired HTTP handler (routes + middleware chain).
func NewRouter(h *Handlers, allowedOrigins []string) http.Handler {
	mux := http.NewServeMux()

	// Public.
	mux.HandleFunc("GET /healthz", h.health)
	mux.HandleFunc("GET /v1/config", h.serverConfig)
	// Self-hosted Noto emoji proxy (public; emoji art is not user data). Cached on
	// disk so the client never contacts a third-party CDN.
	mux.HandleFunc("GET /v1/emoji/{path...}", h.emojiProxy)
	// The unauthenticated auth endpoints share one per-IP rate limiter so an
	// attacker can't spread guesses across them. Generous enough for real use
	// (register once; restore is a couple of calls), tight enough to throttle
	// brute-force / abuse. In dev/e2e the whole test suite registers many accounts
	// from one IP in a couple of minutes, which would trip the production limit, so
	// dev gets an effectively-unlimited bucket (never mounted as a public surface).
	authPerMin := 20 // 20 requests / minute / IP, combined
	if h.DevMode {
		authPerMin = 100000
	}
	authRL := httpx.NewLimiter(authPerMin)
	mux.Handle("POST /v1/register", authRL.Middleware(http.HandlerFunc(h.register)))
	// New-device restore (recovery code): unauthenticated by design - the new
	// device has no token yet; it authenticates by signing the server's
	// challenge with the recovered identity key (see recovery_handlers.go).
	mux.Handle("POST /v1/recovery/begin", authRL.Middleware(http.HandlerFunc(h.recoveryBegin)))
	mux.Handle("POST /v1/recovery/complete", authRL.Middleware(http.HandlerFunc(h.recoveryComplete)))

	// Protected (bearer token required).
	authMW := auth.Middleware(h.Store)
	mux.Handle("POST /v1/session", authMW(http.HandlerFunc(h.session)))
	mux.Handle("GET /v1/me", authMW(http.HandlerFunc(h.me)))
	mux.Handle("DELETE /v1/me", authMW(http.HandlerFunc(h.deleteMe)))

	// Account lifecycle: look up whether peers are active/terminated, and the
	// per-user block list (server-enforced in fetchKeys + the relay).
	mux.Handle("POST /v1/status", authMW(http.HandlerFunc(h.userStatuses)))

	// Contact edges (presence audience for the 'contacts' visibility tier).
	mux.Handle("PUT /v1/contacts", authMW(http.HandlerFunc(h.setContacts)))
	// Connect-request lifecycle (the directory-initiated handshake).
	mux.Handle("GET /v1/connections", authMW(http.HandlerFunc(h.listConnections)))
	mux.Handle("POST /v1/connections/request", authMW(http.HandlerFunc(h.requestConnection)))
	mux.Handle("POST /v1/connections/accept", authMW(http.HandlerFunc(h.acceptConnection)))
	mux.Handle("POST /v1/connections/reject", authMW(http.HandlerFunc(h.rejectConnection)))
	mux.Handle("POST /v1/connections/withdraw", authMW(http.HandlerFunc(h.withdrawConnection)))
	mux.Handle("POST /v1/connections/link", authMW(http.HandlerFunc(h.linkConnection)))

	// Social Wall (spec 0003): posts are opaque ciphertext + per-recipient envelopes.
	mux.Handle("POST /v1/posts", authMW(http.HandlerFunc(h.createPost)))
	mux.Handle("GET /v1/posts", authMW(http.HandlerFunc(h.listPosts)))
	mux.Handle("DELETE /v1/posts/{id}", authMW(http.HandlerFunc(h.deletePost)))
	mux.Handle("POST /v1/posts/{id}/keepalive", authMW(http.HandlerFunc(h.keepAlivePost)))
	mux.Handle("POST /v1/posts/{id}/envelopes", authMW(http.HandlerFunc(h.addPostEnvelopes)))
	mux.Handle("DELETE /v1/posts/{id}/recipient/{userId}", authMW(http.HandlerFunc(h.removePostRecipient)))
	mux.Handle("POST /v1/posts/{id}/engagement", authMW(http.HandlerFunc(h.submitEngagement)))
	mux.Handle("GET /v1/posts/{id}/engagement", authMW(http.HandlerFunc(h.listEngagement)))
	mux.Handle("POST /v1/posts/{id}/view", authMW(http.HandlerFunc(h.recordView)))
	mux.Handle("GET /v1/posts/{id}/views", authMW(http.HandlerFunc(h.listViews)))

	// Public in-network directory: discover any member, fetch one profile, update
	// your own profile, and (legacy) claim a username. The literal /me/* patterns
	// take precedence over the /{id} wildcard in the stdlib mux, so no collision.
	mux.Handle("GET /v1/users", authMW(http.HandlerFunc(h.listUsers)))
	mux.Handle("PUT /v1/me/profile", authMW(http.HandlerFunc(h.updateProfile)))
	mux.Handle("POST /v1/me/username", authMW(http.HandlerFunc(h.claimUsername)))
	mux.Handle("GET /v1/users/{id}", authMW(http.HandlerFunc(h.getUser)))

	mux.Handle("GET /v1/blocks", authMW(http.HandlerFunc(h.listBlocks)))
	mux.Handle("PUT /v1/blocks/{userId}", authMW(http.HandlerFunc(h.blockUser)))
	mux.Handle("DELETE /v1/blocks/{userId}", authMW(http.HandlerFunc(h.unblockUser)))

	// Prekey distribution. The literal /count pattern takes precedence over the
	// /{userId} wildcard in the stdlib mux, so no collision.
	mux.Handle("PUT /v1/keys", authMW(http.HandlerFunc(h.publishKeys)))
	mux.Handle("POST /v1/keys/onetime", authMW(http.HandlerFunc(h.addOneTimeKeys)))
	mux.Handle("GET /v1/keys/count", authMW(http.HandlerFunc(h.keyCount)))
	mux.Handle("GET /v1/keys/{userId}", authMW(http.HandlerFunc(h.fetchKeys)))

	// Relay drain over HTTP (for the service worker's background decrypt path; the
	// live client still drains + acks over the WebSocket).
	mux.Handle("GET /v1/relay/pending", authMW(http.HandlerFunc(h.relayPending)))
	// Side-effect-free queue metadata (age + count) for the spec-2043 zombie
	// self-heal; never dequeues, never emits a receipt, so it's safe to poll.
	mux.Handle("GET /v1/relay/status", authMW(http.HandlerFunc(h.relayStatus)))
	mux.Handle("POST /v1/relay/ack", authMW(http.HandlerFunc(h.relayAck)))
	mux.Handle("POST /v1/relay/notified", authMW(http.HandlerFunc(h.relayNotified)))
	// Sender-side reconcile: which of my still-'sent' messages were delivered while
	// I was offline (so a dropped 'delivered' receipt is recovered on reconnect).
	mux.Handle("POST /v1/deliveries/check", authMW(http.HandlerFunc(h.deliveriesCheck)))
	// Sender-side reconcile for SEEN (spec 1010): which of my messages have been seen
	// (so a 'seen' receipt dropped while I was offline is recovered on reconnect).
	mux.Handle("POST /v1/seen/check", authMW(http.HandlerFunc(h.seenCheck)))
	// A callee's service worker acks an incoming-call ring push (proves reachable →
	// the caller's UI flips Calling -> Ringing).
	mux.Handle("POST /v1/call/ack", authMW(http.HandlerFunc(h.callAck)))

	// Encrypted media blobs (7d).
	mux.Handle("POST /v1/blobs", authMW(http.HandlerFunc(h.uploadBlob)))
	mux.Handle("GET /v1/blobs/{id}", authMW(http.HandlerFunc(h.downloadBlob)))
	mux.Handle("DELETE /v1/blobs/{id}", authMW(http.HandlerFunc(h.deleteBlob)))

	// Link-preview relay: fetches a user-supplied URL's raw bytes so the sender can
	// unfurl it client-side (CORS blocks a direct fetch). It makes outbound requests
	// on the user's behalf, so it gets its own tighter per-IP bucket to bound abuse.
	unfurlRL := httpx.NewLimiter(30) // 30 requests / minute / IP
	if h.DevMode {
		unfurlRL = httpx.NewLimiter(100000)
	}
	mux.Handle("POST /v1/unfurl", authMW(unfurlRL.Middleware(http.HandlerFunc(h.unfurl))))

	// Encrypted own-data sync + recovery-wrap storage (7e).
	mux.Handle("POST /v1/sync/push", authMW(http.HandlerFunc(h.pushSync)))
	mux.Handle("GET /v1/sync/pull", authMW(http.HandlerFunc(h.pullSync)))
	mux.Handle("PUT /v1/recovery", authMW(http.HandlerFunc(h.putRecovery)))
	mux.Handle("GET /v1/recovery", authMW(http.HandlerFunc(h.getRecovery)))

	// Web Push subscriptions (7f).
	mux.Handle("POST /v1/push/subscribe", authMW(http.HandlerFunc(h.subscribePush)))
	// Push routing prefs (spec 1050): full-state replace of the caller's blob.
	mux.Handle("PUT /v1/push/prefs", authMW(http.HandlerFunc(h.savePushPrefs)))
	mux.Handle("POST /v1/push/unsubscribe", authMW(http.HandlerFunc(h.unsubscribePush)))

	// User-generated invitations (7g): create, list, extend (+24h), cancel.
	mux.Handle("POST /v1/invitations", authMW(http.HandlerFunc(h.createInvitation)))
	mux.Handle("GET /v1/invitations", authMW(http.HandlerFunc(h.listInvitations)))
	mux.Handle("POST /v1/invitations/{code}/extend", authMW(http.HandlerFunc(h.extendInvitation)))
	mux.Handle("DELETE /v1/invitations/{code}", authMW(http.HandlerFunc(h.cancelInvitation)))

	// WebRTC calling: ephemeral TURN/ICE credentials for the embedded relay.
	mux.Handle("GET /v1/turn-credentials", authMW(http.HandlerFunc(h.turnCredentials)))

	// WebSocket relay. Authenticates via the ?token= query param (not the bearer
	// middleware), since browsers can't set headers on a WebSocket.
	authFn := func(ctx context.Context, token string) (string, bool, error) {
		return h.Store.UserIDForToken(ctx, auth.HashToken(token))
	}
	mux.Handle("GET /v1/ws", ws.Handler(h.Hub, h.Relay, h.Notifier, authFn, allowedOrigins))

	// Dev/test only: mint fresh invite codes so the e2e harness registers with a
	// code that is fresh on every attempt (no fixed pool to re-consume on a retry).
	// Never mounted in production.
	if h.DevMode {
		mux.HandleFunc("POST /v1/dev/invite", h.devMintInvite)
		mux.HandleFunc("POST /v1/dev/pushtest", h.devPushTest)
		// e2e-only: shrink participant caps + ring/recovery cadence so the cap/re-ring tests
		// run fast and need only a few browser contexts (spec 0004 US1/US2/US3).
		mux.HandleFunc("POST /v1/dev/call-config", h.devCallConfig)
	}

	// Single-container mode: serve the built PWA at / (with SPA fallback) so one
	// image serves both the app and the API. The bare "/" pattern is the lowest
	// precedence in the stdlib mux, so every API route above still wins; only
	// non-API paths reach the static handler. Unmounted when STATIC_DIR is empty
	// (dev/tests), leaving the API-only surface untouched.
	// DevProxy wins over StaticDir: in dev hot-reload mode we forward the app
	// (and the HMR websocket) to the running Vite dev server instead of serving
	// built files, so the public dev URL gets true HMR.
	if h.DevProxy != "" {
		mux.Handle("/", devProxyHandler(h.DevProxy))
	} else if h.StaticDir != "" {
		mux.Handle("/", spaHandler(h.StaticDir))
	}

	// Outermost first: recover → log → CORS → routes.
	return httpx.Chain(mux,
		httpx.Recover,
		httpx.Log,
		httpx.CORS(allowedOrigins),
	)
}
