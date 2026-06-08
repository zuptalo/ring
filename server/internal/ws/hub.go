// Package ws implements the authenticated WebSocket relay: it routes sealed
// message frames between connected devices and drains each recipient's durable
// offline queue on connect. It treats message ciphertext as opaque - only
// routing metadata (to/from/id) is ever read.
package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"
	"slices"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"ring/server/internal/call"
	"ring/server/internal/store"
)

// CallSFU is the embedded group-call SFU the hub drives. *sfu.SFU satisfies it;
// kept as an interface so the ws package needn't import pion/webrtc.
type CallSFU interface {
	Join(roomID, userID string) error
	Answer(roomID, userID string, sdp json.RawMessage) error
	ICE(roomID, userID string, cand json.RawMessage) error
	Leave(roomID, userID string)
	// Renegotiate re-offers to a room's peers after a client changed its tracks
	// mid-call (e.g. a group member toggled their camera on or off).
	Renegotiate(roomID string)
}

const (
	writeWait = 10 * time.Second
	// pongWait bounds how long a sudden, silent disconnect (network drop, frozen
	// tab) goes unnoticed: no PONG within this window → the connection is reaped
	// and the user is broadcast offline. pingPeriod must be < pongWait so a PING
	// always precedes the deadline. Kept ~20s for snappy presence without
	// false-reaping connections whose PONG is merely delayed by jitter.
	pongWait       = 20 * time.Second
	pingPeriod     = (pongWait * 9) / 10 // ~18s
	maxMessageSize = 1 << 20
	sendBuffer     = 64
	// pushFreshness bounds how recently an "active" (foregrounded) connection must
	// have ponged for us to TRUST it enough to suppress an out-of-band push. A tab
	// that froze ungracefully (OS suspended it before it could send
	// presence-self{active:false}) still looks active, but its socket goes quiet;
	// once its last pong is older than this we treat it as not-really-there and push
	// anyway, instead of waiting the full pongWait reap. Slightly above pingPeriod
	// so a healthy client (which pongs every ~pingPeriod) is never falsely doubted.
	pushFreshness = pingPeriod + 2*time.Second
)

// RelayStore is the durable offline queue + presence persistence the relay
// depends on.
type RelayStore interface {
	EnqueueRelay(ctx context.Context, recipient, sender, msgID string, payload []byte) error
	PendingForRecipient(ctx context.Context, recipient string) ([]store.RelayItem, error)
	DeleteRelay(ctx context.Context, recipient, msgID string) (sender string, found bool, err error)
	// RecordDelivery durably notes msgID (from sender) reached recipient, so the
	// sender can reconcile a dropped 'delivered' receipt on reconnect.
	RecordDelivery(ctx context.Context, sender, recipient, msgID string) error
	DeliveriesFor(ctx context.Context, sender string, msgIDs []string) ([]store.Delivery, error)
	SetPresencePrefs(ctx context.Context, userID, onlineTier, lastSeenTier string) error
	TouchLastSeen(ctx context.Context, userID string) error
	GetPresence(ctx context.Context, ids []string) (map[string]store.PresenceInfo, error)
	// PresenceAudience returns who may see `owner`'s presence under the 'contacts'
	// tier (contact edges either direction, minus blocked pairs).
	PresenceAudience(ctx context.Context, owner string) (map[string]bool, error)
	// ContactEdgesWith returns which of `targets` share a contact edge with
	// `viewer` (used to gate a presence-sub reply for many targets at once).
	ContactEdgesWith(ctx context.Context, viewer string, targets []string) (map[string]bool, error)
	// Per-contact presence overrides (allow/deny), layered on top of the tier.
	SetPresenceOverrides(ctx context.Context, owner string, overrides map[string]string) error
	PresenceOverrides(ctx context.Context, owner string) (map[string]string, error)
	PresenceOverridesFor(ctx context.Context, watcher string, owners []string) (map[string]string, error)
	// IsBlocked reports whether `blocker` has blocked `blocked` - the relay drops
	// messages/call-offers from a blocked sender to the blocker.
	IsBlocked(ctx context.Context, blocker, blocked string) (bool, error)
}

// AuthFunc resolves a bearer token (from the ?token= query param) to a user id.
type AuthFunc func(ctx context.Context, token string) (userID string, ok bool, err error)

// Notifier sends an out-of-band push when something can't be delivered to a live
// foreground connection (recipient offline/backgrounded). Notify is for queued
// messages (long-lived, collapsible tickle); NotifyCall is for a ringing call
// (short-lived, never-collapsed tickle). Implemented by the push package; nil
// disables push.
type Notifier interface {
	Notify(ctx context.Context, userID string)
	NotifyCall(ctx context.Context, userID string)
}

// frame is the wire shape. The relay only reads t/id/to/from/refId/messageId;
// ciphertext is opaque and forwarded verbatim.
type frame struct {
	T          string          `json:"t"`
	ID         string          `json:"id,omitempty"`
	To         string          `json:"to,omitempty"`
	From       string          `json:"from,omitempty"`
	Ciphertext json.RawMessage `json:"ciphertext,omitempty"`
	MessageID  string          `json:"messageId,omitempty"`
	Status     string          `json:"status,omitempty"`
	At         int64           `json:"at,omitempty"`
	RefID      string          `json:"refId,omitempty"`
	// Presence fields. For outbound t:"presence", Online is omitted (→ false on
	// the client) when not shared, and LastSeen is omitted (→ null) when not
	// shared or never set. For inbound prefs/self the bools default to false.
	User          string `json:"user,omitempty"`
	Online        bool   `json:"online,omitempty"`
	LastSeen      int64  `json:"lastSeen,omitempty"`
	ShareOnline   bool   `json:"shareOnline,omitempty"`
	ShareLastSeen bool   `json:"shareLastSeen,omitempty"`
	// Inbound presence-prefs visibility tiers ('everyone'|'contacts'|'nobody') and
	// the per-contact allow/deny overrides (target id -> 'allow'|'deny').
	OnlineTier   string            `json:"onlineTier,omitempty"`
	LastSeenTier string            `json:"lastSeenTier,omitempty"`
	Overrides    map[string]string `json:"overrides,omitempty"`
	Active       bool              `json:"active,omitempty"`
	IDs          []string `json:"ids,omitempty"`
	// Call signalling (live-only; never durably queued). For 1:1, SDP/ICE travel
	// E2EE'd in Ciphertext (the server can't read them). RoomID/Members/SDP are
	// used by group calls (SFU). Kind is "audio"|"video"; Reason annotates
	// reject/cancel/end ("declined","busy","timeout","hangup","unavailable",
	// "answered-elsewhere").
	CallID   string          `json:"callId,omitempty"`
	RoomID   string          `json:"roomId,omitempty"`
	Kind     string          `json:"kind,omitempty"`
	Reason   string          `json:"reason,omitempty"`
	Duration int64           `json:"duration,omitempty"`
	Members  []string        `json:"members,omitempty"`
	SDP      json.RawMessage `json:"sdp,omitempty"`
}

// Hub tracks live connections per user id, plus who watches whose presence, and
// (for group calls) room membership + the SFU.
type Hub struct {
	mu       sync.RWMutex
	conns    map[string]map[*Client]struct{}
	watchers map[string]map[*Client]struct{} // targetUserID → clients watching it
	rooms    *call.Registry
	sfu      CallSFU                   // nil when calling is disabled
	callBuf  map[string][]bufferedCall // recipient → briefly-held call offers
	ringMu   sync.Mutex
	ringHist map[string][]time.Time // userID → recent group-ring timestamps (rate limit)
	// Per outgoing 1:1 call: a goroutine that re-pushes a ring tickle every few
	// seconds so a backgrounded callee gets a "ringing" (not one-shot) alert; each
	// push the callee's SW receives is acked (/v1/call/ack) which flips the caller's
	// UI from "Calling" to "Ringing". Keyed by callId; cancelled when the call is
	// answered/declined/cancelled/ended.
	callRingMu sync.Mutex
	callRings  map[string]*callRing
}

type callRing struct {
	caller string
	callee string
	cancel context.CancelFunc
}

const (
	// A backgrounded callee is re-pushed this many times, this far apart, to feel
	// like ringing (distinct visible notifications, not one tickle). The window
	// (count*interval) sits within the dial timeout.
	callRingCount    = 5
	callRingInterval = 5 * time.Second
)

const (
	// maxGroupRing caps how many members one group-call invite fans out to, and
	// ringWindow/ringBurst rate-limit ring events per user. The server has no group
	// object so it can't verify membership; these bound the push-fan-out abuse a
	// malicious/buggy client could cause.
	maxGroupRing = 64
	ringWindow   = time.Minute
	ringBurst    = 4
)

// bufferedCall is a call offer held for a few seconds so a push-woken device
// that reconnects still receives it (background ringing).
type bufferedCall struct {
	payload []byte
	exp     time.Time
}

// callBufferTTL bounds how long an undelivered call offer is held for a
// reconnecting device. Short - a real-time call is stale beyond this - but kept
// in step with the call push TTL (60s) and the caller's answer window so a device
// woken by a call tickle still finds the buffered offer when it cold-starts the app
// from the notification and its WebSocket reconnects.
const callBufferTTL = 60 * time.Second

func NewHub() *Hub {
	return &Hub{
		conns:    make(map[string]map[*Client]struct{}),
		watchers: make(map[string]map[*Client]struct{}),
		rooms:    call.NewRegistry(),
		callBuf:   make(map[string][]bufferedCall),
		ringHist:  make(map[string][]time.Time),
		callRings: make(map[string]*callRing),
	}
}

// startCallRing re-pushes a call tickle to `callee` every few seconds (up to
// callRingCount) so a backgrounded device rings rather than buzzing once. Idempotent
// per callId. The notifier is captured from the originating connection.
func (h *Hub) startCallRing(notifier Notifier, caller, callee, callID string) {
	if notifier == nil || callID == "" || callee == "" {
		return
	}
	h.callRingMu.Lock()
	if _, exists := h.callRings[callID]; exists {
		h.callRingMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.callRings[callID] = &callRing{caller: caller, callee: callee, cancel: cancel}
	h.callRingMu.Unlock()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("call ring goroutine panicked", "recover", r, "stack", string(debug.Stack()))
			}
		}()
		defer h.stopCallRing(callID)
		for i := 0; i < callRingCount; i++ {
			if ctx.Err() != nil {
				return
			}
			func() {
				nctx, ncancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer ncancel()
				notifier.NotifyCall(nctx, callee)
			}()
			select {
			case <-ctx.Done():
				return
			case <-time.After(callRingInterval):
			}
		}
	}()
}

// stopCallRing cancels any active ring loop for a call (answered/declined/ended).
func (h *Hub) stopCallRing(callID string) {
	if callID == "" {
		return
	}
	h.callRingMu.Lock()
	if e := h.callRings[callID]; e != nil {
		e.cancel()
		delete(h.callRings, callID)
	}
	h.callRingMu.Unlock()
}

// AckCallReachable is called when `callee`'s device acknowledged a call ring (its
// service worker showed the notification and posted /v1/call/ack). For every active
// outgoing ring targeting this callee, tell the caller their phone is reachable by
// forwarding a call-ringing frame, so the caller's UI flips "Calling" -> "Ringing".
func (h *Hub) AckCallReachable(callee string) {
	type tgt struct{ caller, callID string }
	var tgts []tgt
	h.callRingMu.Lock()
	for id, e := range h.callRings {
		if e.callee == callee {
			tgts = append(tgts, tgt{e.caller, id})
		}
	}
	h.callRingMu.Unlock()
	for _, t := range tgts {
		if payload, err := json.Marshal(frame{T: "call-ringing", CallID: t.callID, From: callee}); err == nil {
			h.Send(t.caller, payload)
		}
	}
}

// allowRing rate-limits group-call ring events per user (ringBurst per ringWindow).
func (h *Hub) allowRing(userID string) bool {
	h.ringMu.Lock()
	defer h.ringMu.Unlock()
	cutoff := time.Now().Add(-ringWindow)
	kept := h.ringHist[userID][:0]
	for _, t := range h.ringHist[userID] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= ringBurst {
		h.ringHist[userID] = kept
		return false
	}
	h.ringHist[userID] = append(kept, time.Now())
	return true
}

// forgetRingIfGone drops a user's ring history once their last connection closes,
// so ringHist doesn't keep one entry forever per lifetime group-call initiator.
func (h *Hub) forgetRingIfGone(userID string) {
	h.mu.RLock()
	_, stillConnected := h.conns[userID]
	h.mu.RUnlock()
	if stillConnected {
		return
	}
	h.ringMu.Lock()
	delete(h.ringHist, userID)
	h.ringMu.Unlock()
}

// bufferCall holds a call offer for `to` for a short TTL (expiring older ones).
func (h *Hub) bufferCall(to string, payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	kept := h.callBuf[to][:0]
	for _, b := range h.callBuf[to] {
		if b.exp.After(now) {
			kept = append(kept, b)
		}
	}
	h.callBuf[to] = append(kept, bufferedCall{payload: payload, exp: now.Add(callBufferTTL)})
}

// takeBufferedCalls returns and clears the non-expired buffered offers for a user.
func (h *Hub) takeBufferedCalls(userID string) [][]byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	bufs := h.callBuf[userID]
	delete(h.callBuf, userID)
	now := time.Now()
	var out [][]byte
	for _, b := range bufs {
		if b.exp.After(now) {
			out = append(out, b.payload)
		}
	}
	return out
}

// SetSFU wires the embedded SFU (called once at startup when calls are enabled).
func (h *Hub) SetSFU(s CallSFU) { h.sfu = s }

// SendCallSignal delivers an SFU→client signalling frame (sfu-offer/sfu-ice).
// The SFU invokes this via a callback so it needn't know the frame shape.
func (h *Hub) SendCallSignal(userID, t, roomID string, data json.RawMessage) {
	f := frame{T: t, RoomID: roomID}
	if t == "sfu-offer" {
		f.SDP = data
	} else { // sfu-ice
		f.Ciphertext = data
	}
	if payload, err := json.Marshal(f); err == nil {
		h.Send(userID, payload)
	}
}

// broadcastRoster sends the current room roster to every member.
func (h *Hub) broadcastRoster(roomID string, roster []string) {
	payload, err := json.Marshal(frame{T: "call-roster", RoomID: roomID, Members: roster})
	if err != nil {
		return
	}
	for _, uid := range roster {
		h.Send(uid, payload)
	}
}

func (h *Hub) add(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.conns[c.userID]
	if set == nil {
		set = make(map[*Client]struct{})
		h.conns[c.userID] = set
	}
	set[c] = struct{}{}
}

func (h *Hub) remove(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set := h.conns[c.userID]; set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(h.conns, c.userID)
		}
	}
}

// Send delivers payload to every live connection for userID. Returns true if at
// least one connection received it. Never blocks: a connection whose buffer is
// full is skipped (its readPump will fall behind and disconnect).
func (h *Hub) Send(userID string, payload []byte) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	delivered := false
	for c := range h.conns[userID] {
		select {
		case c.send <- payload:
			delivered = true
		default:
		}
	}
	return delivered
}

// Client is one device's WebSocket connection.
type Client struct {
	hub      *Hub
	store    RelayStore
	notifier Notifier
	conn     *websocket.Conn
	userID   string
	send     chan []byte
	active   bool                // app foregrounded? (toggled by presence-self); guarded by hub.mu
	lastPong time.Time           // last pong (or connect) time; guarded by hub.mu - see pushFreshness
	watching map[string]struct{} // target ids this client watches; guarded by hub.mu
}

// isOnline reports whether userID has at least one active (foregrounded) live
// connection. Used for PRESENCE (last-seen / online dot).
func (h *Hub) isOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.conns[userID] {
		if c.active {
			return true
		}
	}
	return false
}

// isActiveFresh reports whether userID has an active (foregrounded) connection
// whose socket is still demonstrably alive (ponged within pushFreshness). Used
// ONLY for the push-SUPPRESSION decision: unlike isOnline it doesn't trust a
// frozen-but-"active" tab whose socket has gone quiet, so such a recipient still
// gets a push instead of silently missing it until the ~pongWait reap.
func (h *Hub) isActiveFresh(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.conns[userID] {
		if c.active && time.Since(c.lastPong) < pushFreshness {
			return true
		}
	}
	return false
}

// notifyAsync fires a content-free push tickle (message, or a call when call is
// true) to userID from a panic-safe, time-bounded goroutine. A panic in a bare
// `go func` would otherwise take down the whole process and drop EVERY WebSocket,
// so it is always recovered here; one device's push problem can never become an
// outage. No-op when this connection has no notifier (push disabled).
func (c *Client) notifyAsync(userID string, call bool) {
	if c.notifier == nil {
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("push: notify goroutine panicked", "recover", r, "stack", string(debug.Stack()))
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if call {
			c.notifier.NotifyCall(ctx, userID)
		} else {
			c.notifier.Notify(ctx, userID)
		}
	}()
}

// markPong records that a client's socket is alive (a pong arrived).
func (h *Hub) markPong(c *Client) {
	h.mu.Lock()
	c.lastPong = time.Now()
	h.mu.Unlock()
}

// setActive updates a client's foreground flag.
func (h *Hub) setActive(c *Client, active bool) {
	h.mu.Lock()
	c.active = active
	h.mu.Unlock()
}

// addWatch registers c as a watcher of each id.
func (h *Hub) addWatch(c *Client, ids []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, id := range ids {
		if id == "" {
			continue
		}
		set := h.watchers[id]
		if set == nil {
			set = make(map[*Client]struct{})
			h.watchers[id] = set
		}
		set[c] = struct{}{}
		c.watching[id] = struct{}{}
	}
}

// removeWatches drops c from every watcher set it joined (on disconnect).
func (h *Hub) removeWatches(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id := range c.watching {
		if set := h.watchers[id]; set != nil {
			delete(set, c)
			if len(set) == 0 {
				delete(h.watchers, id)
			}
		}
	}
}

// visibleTo decides whether a presence field governed by `tier` is shown to a
// watcher, given an optional per-contact override and whether the watcher is a
// contact (inAudience). Overrides win; otherwise ONLY contacts see presence
// ('everyone' no longer means the whole network - a non-contact never sees it
// unless explicitly allowed), and 'nobody' hides from all.
func visibleTo(tier, override string, inAudience bool) bool {
	switch override {
	case "allow":
		return true
	case "deny":
		return false
	}
	if tier == "nobody" {
		return false
	}
	return inAudience
}

// presenceFrame builds a t:"presence" frame for userID gated for ONE watcher: a
// field is included only if visibleTo permits (tier + per-contact override +
// contact-edge audience). A frame with both omitted shows "unknown".
func presenceFrame(userID string, online bool, pi store.PresenceInfo, inAudience bool, override string) frame {
	f := frame{T: "presence", User: userID}
	if visibleTo(pi.OnlineTier, override, inAudience) {
		f.Online = online
	}
	if visibleTo(pi.LastSeenTier, override, inAudience) {
		f.LastSeen = pi.LastSeenMs
	}
	return f
}

// broadcastPresence sends userID's current presence to each watcher, gated per
// watcher by userID's tier + per-contact override + contact-edge audience.
func (h *Hub) broadcastPresence(ctx context.Context, st RelayStore, userID string) {
	online := h.isOnline(userID)
	info, err := st.GetPresence(ctx, []string{userID})
	if err != nil {
		slog.Error("get presence", "user", userID, "err", err)
		return
	}
	pi := info[userID]
	// Presence is now contacts-only by default, so the audience is always needed
	// (unless both tiers are 'nobody', when nothing is shown without an allow).
	audience, err := st.PresenceAudience(ctx, userID)
	if err != nil {
		slog.Error("presence audience", "user", userID, "err", err)
		audience = map[string]bool{}
	}
	overrides, err := st.PresenceOverrides(ctx, userID)
	if err != nil {
		overrides = map[string]string{}
	}
	// Snapshot watcher ids under the lock, then marshal per-watcher outside it.
	h.mu.RLock()
	watchers := make([]*Client, 0, len(h.watchers[userID]))
	for c := range h.watchers[userID] {
		watchers = append(watchers, c)
	}
	h.mu.RUnlock()
	for _, c := range watchers {
		payload, err := json.Marshal(presenceFrame(userID, online, pi, audience[c.userID], overrides[c.userID]))
		if err != nil {
			continue
		}
		select {
		case c.send <- payload:
		default:
		}
	}
}

// Handler upgrades authenticated GET /v1/ws requests and runs the relay for the
// connection. The token is taken from the ?token= query param (browsers can't
// set Authorization on a WebSocket).
func Handler(hub *Hub, st RelayStore, notifier Notifier, authenticate AuthFunc, allowedOrigins []string) http.HandlerFunc {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			o := r.Header.Get("Origin")
			return o == "" || slices.Contains(allowedOrigins, o)
		},
	}
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "missing token", http.StatusUnauthorized)
			return
		}
		uid, ok, err := authenticate(r.Context(), token)
		if err != nil {
			http.Error(w, "auth error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return // Upgrade already wrote the error response
		}

		c := &Client{
			hub: hub, store: st, notifier: notifier, conn: conn, userID: uid,
			// Default inactive: a live socket does NOT mean the user is online. A
			// backgrounded/locked device reconnects on its own (e.g. woken by a
			// push) just to drain the relay queue and ack messages. The client
			// reports real presence via presence-self once it knows it's
			// foregrounded AND unlocked.
			send: make(chan []byte, sendBuffer), active: false, lastPong: time.Now(), watching: make(map[string]struct{}),
		}
		hub.add(c)
		slog.Info("ws connected", "user", uid)
		go c.writePump()
		go c.readPump()
		c.flushPending()
		c.flushBufferedCalls() // deliver any call offer held while we were away
		// Deliberately NOT touching last_seen or broadcasting presence here:
		// presence changes only when the client reports it's active (see the
		// "presence-self" frame), so a background push-drain never appears online
		// or moves last_seen.
	}
}

func (c *Client) cleanup() {
	// Was the user online (had any active connection) BEFORE we drop this one?
	wasOnline := c.hub.isOnline(c.userID)
	c.hub.remove(c)
	c.hub.removeWatches(c)
	c.hub.forgetRingIfGone(c.userID) // bound ringHist to connected users
	// Leave any group calls this connection was in (best-effort; a user with
	// other live devices stays in the room via those).
	if c.hub.rooms != nil {
		for _, roomID := range c.hub.rooms.RoomsForUser(c.userID) {
			roster, _ := c.hub.rooms.Leave(roomID, c.userID)
			c.hub.broadcastRoster(roomID, roster)
			if c.hub.sfu != nil {
				c.hub.sfu.Leave(roomID, c.userID)
			}
		}
	}
	_ = c.conn.Close()
	// Only a genuine online→offline transition is a presence change. A
	// backgrounded/locked drain connection (never active) dropping must not stamp
	// last_seen or broadcast - otherwise fetching a pushed message would leak
	// "last seen just now" to peers.
	if wasOnline && !c.hub.isOnline(c.userID) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		_ = c.store.TouchLastSeen(ctx, c.userID)
		c.hub.broadcastPresence(ctx, c.store, c.userID)
		cancel()
	}
	slog.Info("ws disconnected", "user", c.userID)
}

// flushBufferedCalls delivers any briefly-held call offers to this freshly
// connected device (background-ringing: it was offline when the call started).
func (c *Client) flushBufferedCalls() {
	for _, payload := range c.hub.takeBufferedCalls(c.userID) {
		select {
		case c.send <- payload:
		default:
		}
	}
}

// flushPending pushes any queued offline frames to the freshly connected client.
func (c *Client) flushPending() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	items, err := c.store.PendingForRecipient(ctx, c.userID)
	if err != nil {
		slog.Error("flush pending", "user", c.userID, "err", err)
		return
	}
	for _, it := range items {
		select {
		case c.send <- it.Payload:
		case <-time.After(writeWait):
			return
		}
	}
}

func (c *Client) readPump() {
	defer c.cleanup()
	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.hub.markPong(c) // socket proven alive → keeps it trusted for push-suppression
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		c.handleFrame(data)
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// forwardedCallPayload marshals f for delivery to the recipient, stamping the
// authoritative sender.
func (c *Client) forwardedCallPayload(f frame) []byte {
	out := frame{
		T: f.T, From: c.userID, CallID: f.CallID, RoomID: f.RoomID,
		Kind: f.Kind, Reason: f.Reason, Duration: f.Duration,
		Ciphertext: f.Ciphertext, SDP: f.SDP,
	}
	payload, err := json.Marshal(out)
	if err != nil {
		return nil
	}
	return payload
}

// ringGroup notifies the rest of the group of an incoming group call. The server
// has no group object, so the initiator supplies the member list (f.Members); we
// cap it and rate-limit per user to bound abuse. Each target gets a live
// call-group-invite plus, if not foregrounded, a call push + a short buffer (so a
// push-woken device that reconnects still rings).
//
// Runs in its own goroutine off the caller's readPump (and its own context, NOT the
// short per-frame one): the per-member IsBlocked lookups must not head-of-line-block
// the initiator's own call-setup frames.
func (c *Client) ringGroup(f frame) {
	if !c.hub.allowRing(c.userID) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	members := f.Members
	if len(members) > maxGroupRing {
		members = members[:maxGroupRing]
	}
	invite := frame{T: "call-group-invite", From: c.userID, RoomID: f.RoomID, Kind: f.Kind, Members: members}
	payload, err := json.Marshal(invite)
	if err != nil {
		return
	}
	for _, to := range members {
		if to == "" || to == c.userID {
			continue
		}
		// A blocked initiator can't ring the person who blocked them.
		if blocked, err := c.store.IsBlocked(ctx, to, c.userID); err == nil && blocked {
			continue
		}
		delivered := c.hub.Send(to, payload)
		if !c.hub.isActiveFresh(to) || !delivered {
			c.notifyAsync(to, true)
		}
		if !delivered {
			c.hub.bufferCall(to, payload)
		}
	}
}

// relayCall forwards a call-signalling frame live to f.To. Call frames are NEVER
// durably queued - a real-time call that can't be delivered now is a missed
// call, not a stored message. Returns true if at least one live socket got it.
func (c *Client) relayCall(f frame) bool {
	if f.To == "" {
		return false
	}
	payload := c.forwardedCallPayload(f)
	if payload == nil {
		return false
	}
	return c.hub.Send(f.To, payload)
}

func (c *Client) send1(f frame) {
	payload, err := json.Marshal(f)
	if err != nil {
		return
	}
	select {
	case c.send <- payload:
	default:
	}
}

// handleFrame dispatches one inbound frame from this client.
func (c *Client) handleFrame(data []byte) {
	var f frame
	if err := json.Unmarshal(data, &f); err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	switch f.T {
	case "msg":
		// Sender is authoritative from the connection; recipient is f.To.
		if f.To == "" || f.ID == "" {
			return
		}
		// If the recipient has blocked the sender, drop the message silently - no
		// queue, no live delivery, no push - but still tell the sender it was
		// "sent" so the block stays invisible to them (their message just never
		// turns "delivered").
		if blocked, err := c.store.IsBlocked(ctx, f.To, c.userID); err == nil && blocked {
			c.send1(frame{T: "receipt", MessageID: f.ID, Status: "sent", At: time.Now().UnixMilli(), From: f.To})
			return
		}
		delivered := frame{T: "msg", ID: f.ID, From: c.userID, Ciphertext: f.Ciphertext}
		payload, err := json.Marshal(delivered)
		if err != nil {
			return
		}
		if err := c.store.EnqueueRelay(ctx, f.To, c.userID, f.ID, payload); err != nil {
			slog.Error("enqueue relay", "err", err)
			return
		}
		// Deliver to any live sockets (best-effort; the durable copy is already
		// queued above). Decide the push on *foregrounded, proven-live* presence: a
		// recipient with no fresh active connection - offline, backgrounded, OR a
		// frozen tab whose socket went quiet - gets a push tickle, as does one whose
		// every live socket's buffer was full (delivered to zero). A foregrounded,
		// responsive recipient gets it in-app and needs no push.
		sent := c.hub.Send(f.To, payload)
		if !c.hub.isActiveFresh(f.To) || !sent {
			c.notifyAsync(f.To, false)
		}
		// Tell the sender the server accepted it.
		c.send1(frame{T: "receipt", MessageID: f.ID, Status: "sent", At: time.Now().UnixMilli(), From: f.To})

	case "ack":
		// Recipient confirms receipt → drop from queue and notify the sender.
		if f.RefID == "" {
			return
		}
		sender, found, err := c.store.DeleteRelay(ctx, c.userID, f.RefID)
		if err != nil {
			slog.Error("delete relay", "err", err)
			return
		}
		if found {
			// Record durably first so the sender can reconcile this 'delivered' on its
			// next reconnect even if it's offline right now and the receipt below is
			// dropped (non-blocking Send to an absent sender is a no-op).
			if err := c.store.RecordDelivery(ctx, sender, c.userID, f.RefID); err != nil {
				slog.Error("record delivery", "err", err)
			}
			// From = the recipient that acked, so the sender scopes the outbox removal
			// to this recipient's copy (a group message has one copy per member, all
			// sharing the message id).
			receipt := frame{T: "receipt", MessageID: f.RefID, Status: "delivered", At: time.Now().UnixMilli(), From: c.userID}
			if payload, err := json.Marshal(receipt); err == nil {
				c.hub.Send(sender, payload)
			}
		}

	case "receipt":
		// Client-originated receipt addressed to another user. Clients may ONLY
		// originate 'read'; 'sent'/'delivered' are server-authoritative, so a client
		// claiming them is dropped (otherwise a peer could forge a 'delivered' for a
		// victim's group message id and make the sender evict its other unsent copies).
		// Stamp From = the authenticated sender so the recipient can scope it.
		if f.To == "" || f.Status != "read" {
			return
		}
		out := frame{T: "receipt", MessageID: f.MessageID, Status: "read", At: f.At, From: c.userID}
		if payload, err := json.Marshal(out); err == nil {
			c.hub.Send(f.To, payload)
		}

	case "presence-prefs":
		// Client uploaded its visibility tiers (derived from privacy settings) and
		// its per-contact allow/deny overrides.
		if err := c.store.SetPresencePrefs(ctx, c.userID, f.OnlineTier, f.LastSeenTier); err != nil {
			slog.Error("set presence prefs", "err", err)
			return
		}
		if err := c.store.SetPresenceOverrides(ctx, c.userID, f.Overrides); err != nil {
			slog.Error("set presence overrides", "err", err)
		}
		c.hub.broadcastPresence(ctx, c.store, c.userID)

	case "presence-sub":
		// Client subscribes to presence for some ids (contacts or directory-browse
		// results). Reply with each target's CURRENT state, gated per the target's
		// tier + whether this subscriber shares a contact edge with them.
		c.hub.addWatch(c, f.IDs)
		if len(f.IDs) == 0 {
			return
		}
		info, err := c.store.GetPresence(ctx, f.IDs)
		if err != nil {
			slog.Error("get presence", "err", err)
			return
		}
		edges, err := c.store.ContactEdgesWith(ctx, c.userID, f.IDs)
		if err != nil {
			slog.Error("contact edges", "err", err)
			edges = map[string]bool{}
		}
		// The override each subscribed owner set for THIS watcher (allow/deny).
		ov, err := c.store.PresenceOverridesFor(ctx, c.userID, f.IDs)
		if err != nil {
			ov = map[string]string{}
		}
		for _, id := range f.IDs {
			if id == "" {
				continue
			}
			c.send1(presenceFrame(id, c.hub.isOnline(id), info[id], edges[id], ov[id]))
		}

	case "presence-self":
		// Foreground/background transition. Only act on a real change in the
		// user's online state, so a background connection reporting active:false
		// (e.g. a locked device that just connected to drain messages) doesn't
		// stamp last_seen or broadcast - that was a source of the presence leak.
		wasOnline := c.hub.isOnline(c.userID)
		c.hub.setActive(c, f.Active)
		nowOnline := c.hub.isOnline(c.userID)
		if wasOnline == nowOnline {
			return
		}
		if !nowOnline {
			// User just went offline → record when they were last seen.
			_ = c.store.TouchLastSeen(ctx, c.userID)
		}
		c.hub.broadcastPresence(ctx, c.store, c.userID)

	case "call-offer":
		// Start of a 1:1 call. Fan out to all the callee's devices (first to
		// accept wins, arbitrated client-side).
		if f.To == "" || f.CallID == "" {
			return
		}
		// A blocked caller can't ring the person who blocked them.
		if blocked, err := c.store.IsBlocked(ctx, f.To, c.userID); err == nil && blocked {
			return
		}
		payload := c.forwardedCallPayload(f)
		if payload == nil {
			return
		}
		delivered := c.hub.Send(f.To, payload)
		// Push whenever the callee isn't foregrounded-and-responsive, so a
		// backgrounded, locked, or frozen device gets the OS ring even if a socket
		// is live but the in-app ringtone is autoplay-blocked. NotifyCall sends the
		// short-lived, high-urgency call tickle (distinct from a message tickle) so
		// the service worker shows an "Incoming call" alert immediately.
		if !c.hub.isActiveFresh(f.To) || !delivered {
			// Re-push every few seconds (up to a cap) so a backgrounded callee rings
			// instead of buzzing once; the callee's SW acks each push (/v1/call/ack),
			// which flips the caller's UI to "Ringing". Cancelled on answer/decline/end.
			c.hub.startCallRing(c.notifier, c.userID, f.To, f.CallID)
		}
		// No live socket at all → hold the offer briefly so a push-woken device
		// that reconnects still rings. The caller keeps ringing; its own dial
		// timeout ends the call if nobody answers.
		if !delivered {
			c.hub.bufferCall(f.To, payload)
		}

	case "call-ringing", "call-answer", "call-ice", "call-accept",
		"call-reject", "call-cancel", "call-busy", "call-end",
		"call-upgrade-request", "call-upgrade-accept", "call-upgrade-reject":
		// Pure live relay of the remaining 1:1 signalling (incl. the consent-gated
		// audio<->video upgrade). The sender is authoritative; SDP/ICE stay E2EE'd.
		c.relayCall(f)
		// Once the callee engages (ringing/answered) or the call resolves, stop the
		// re-push ring loop so it can't keep buzzing a settled call.
		switch f.T {
		case "call-ringing", "call-answer", "call-accept", "call-reject", "call-cancel", "call-busy", "call-end":
			c.hub.stopCallRing(f.CallID)
		}

	case "call-key":
		// Group media key, sealed peer-to-peer; relayed live, never inspected.
		c.relayCall(f)

	case "call-key-request":
		// A member missing the current group key asks the master (f.To) to resend it.
		// Live relay only (like call-key); the master re-seals and sends.
		c.relayCall(f)

	case "call-join":
		// Join a group-call room: update membership, tell everyone the roster,
		// and bring the participant into the SFU (which then offers).
		if f.RoomID == "" {
			return
		}
		roster := c.hub.rooms.Join(f.RoomID, c.userID)
		c.hub.broadcastRoster(f.RoomID, roster)
		if c.hub.sfu != nil {
			if err := c.hub.sfu.Join(f.RoomID, c.userID); err != nil {
				slog.Error("sfu join", "room", f.RoomID, "err", err)
			}
		}
		// The initiator (first into the room) supplies the group member list → ring
		// the rest of the group. Later joiners and ICE-recovery re-joins omit Members,
		// and a non-initiator (roster already has others) never re-rings. Fanned out
		// on its own goroutine so the per-member block checks don't stall this client.
		if len(roster) == 1 && len(f.Members) > 0 {
			go c.ringGroup(f)
		}

	case "call-leave":
		if f.RoomID == "" {
			return
		}
		roster, _ := c.hub.rooms.Leave(f.RoomID, c.userID)
		c.hub.broadcastRoster(f.RoomID, roster)
		if c.hub.sfu != nil {
			c.hub.sfu.Leave(f.RoomID, c.userID)
		}

	case "sfu-answer":
		if c.hub.sfu == nil || f.RoomID == "" || len(f.SDP) == 0 {
			return
		}
		if err := c.hub.sfu.Answer(f.RoomID, c.userID, f.SDP); err != nil {
			slog.Error("sfu answer", "err", err)
		}

	case "sfu-ice":
		if c.hub.sfu == nil || f.RoomID == "" || len(f.Ciphertext) == 0 {
			return
		}
		if err := c.hub.sfu.ICE(f.RoomID, c.userID, f.Ciphertext); err != nil {
			slog.Error("sfu ice", "err", err)
		}

	case "sfu-renegotiate":
		// A participant added/removed a track mid-call (camera on/off) → have the SFU
		// re-offer so the new track set is negotiated and forwarded.
		if c.hub.sfu == nil || f.RoomID == "" {
			return
		}
		c.hub.sfu.Renegotiate(f.RoomID)
	}
}
