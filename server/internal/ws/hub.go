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
	// RecordSeen durably notes msgID (from sender) was seen by recipient (spec 1010),
	// so the sender can reconcile a dropped 'seen' receipt on reconnect — the
	// symmetric twin of RecordDelivery.
	RecordSeen(ctx context.Context, sender, recipient, msgID string) error
	SeenFor(ctx context.Context, sender string, msgIDs []string) ([]store.Seen, error)
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
	// Per group-call invitee: a goroutine that re-sends the invite + push every few
	// seconds until they JOIN the room (or the reminders run out), so a member who hasn't
	// answered keeps getting reminders regardless of who else joined. Keyed roomID → member.
	groupRingMu sync.Mutex
	groupRings  map[string]map[string]context.CancelFunc
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
	// A group-call invitee who hasn't joined is reminded this many times, this far apart
	// (≈30s total), and stops the moment they join. Less pushy than the 1:1 cadence; after
	// these run out the caller's UI offers a recall (re-ring) or remove for that member.
	groupRingCount    = 4
	groupRingInterval = 7 * time.Second
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

// maxBufferedCallFrames caps the per-callee hold (one offer + its trickled ICE) so an
// offline callee's buffer can't be grown without bound. A normal call setup is far under it.
const maxBufferedCallFrames = 64

func NewHub() *Hub {
	return &Hub{
		conns:    make(map[string]map[*Client]struct{}),
		watchers: make(map[string]map[*Client]struct{}),
		rooms:    call.NewRegistry(),
		callBuf:   make(map[string][]bufferedCall),
		ringHist:   make(map[string][]time.Time),
		callRings:  make(map[string]*callRing),
		groupRings: make(map[string]map[string]context.CancelFunc),
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

// ringMember rings ONE group-call invitee: the initial invite (live + buffered for a
// push-woken reconnect) and a push, then schedules the follow-up reminders. The initial
// push respects foreground (an active member already sees the in-app ring); the reminders
// (startGroupMemberRing) push unconditionally — the whole point is to keep nudging a
// non-joiner. Used for the first ring and for a recall.
func (c *Client) ringMember(roomID, member string, invite []byte) {
	delivered := c.hub.Send(member, invite)
	if !c.hub.isActiveFresh(member) || !delivered {
		c.notifyAsync(member, true)
	}
	if !delivered {
		c.hub.bufferCall(member, invite) // a push-woken reconnect still finds the invite
	}
	c.hub.startGroupMemberRing(c.notifier, roomID, member, invite)
}

// startGroupMemberRing schedules the REMINDER rounds after the initial ring: re-send the
// invite + re-push every groupRingInterval, up to groupRingCount-1 more times (≈30s total
// including the initial), until the member JOINS the room (or the call ends). Idempotent
// per (room, member): a recall cancels any in-flight loop and starts fresh. Independent per
// member, so a non-joiner keeps being reminded regardless of who else has joined.
func (h *Hub) startGroupMemberRing(notifier Notifier, roomID, member string, invite []byte) {
	if notifier == nil || roomID == "" || member == "" {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.groupRingMu.Lock()
	if h.groupRings[roomID] == nil {
		h.groupRings[roomID] = map[string]context.CancelFunc{}
	}
	if old := h.groupRings[roomID][member]; old != nil {
		old() // recall: replace any in-flight loop
	}
	h.groupRings[roomID][member] = cancel
	h.groupRingMu.Unlock()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("group ring goroutine panicked", "recover", r, "stack", string(debug.Stack()))
			}
		}()
		defer h.stopGroupMemberRing(roomID, member)
		for i := 1; i < groupRingCount; i++ {
			select {
			case <-ctx.Done():
				return
			case <-time.After(groupRingInterval):
			}
			if ctx.Err() != nil || h.rooms.InRoom(roomID, member) {
				return // cancelled, or they joined → stop reminding them
			}
			h.Send(member, invite) // a live socket re-rings; a dismissed one re-shows
			func() {
				nctx, ncancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer ncancel()
				notifier.NotifyCall(nctx, member)
			}()
		}
	}()
}

// stopGroupMemberRing cancels the reminder loop for one invitee (they joined, were
// recalled-and-replaced, or the caller removed them).
func (h *Hub) stopGroupMemberRing(roomID, member string) {
	h.groupRingMu.Lock()
	if m := h.groupRings[roomID]; m != nil {
		if cancel := m[member]; cancel != nil {
			cancel()
			delete(m, member)
		}
		if len(m) == 0 {
			delete(h.groupRings, roomID)
		}
	}
	h.groupRingMu.Unlock()
}

// stopRoomRings cancels every invitee reminder loop for a room (the call ended / emptied).
func (h *Hub) stopRoomRings(roomID string) {
	h.groupRingMu.Lock()
	for _, cancel := range h.groupRings[roomID] {
		cancel()
	}
	delete(h.groupRings, roomID)
	h.groupRingMu.Unlock()
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
	buf := append(kept, bufferedCall{payload: payload, exp: now.Add(callBufferTTL)})
	// Bound the hold (offer + trickled ICE) so a chatty/abusive caller can't grow it without
	// limit; a normal call setup is well under this. Dropping the oldest first is acceptable.
	if len(buf) > maxBufferedCallFrames {
		buf = buf[len(buf)-maxBufferedCallFrames:]
	}
	h.callBuf[to] = buf
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

// SharesCallRoom reports whether a and b are currently in a common call room. Used by the
// key-bundle handler to let co-participants of a live call fetch each other's bundles
// (so an ad-hoc group call can mesh between members who aren't contacts) for the duration
// of the call only — no persistent connection is created.
func (h *Hub) SharesCallRoom(a, b string) bool { return h.rooms.SharesRoom(a, b) }

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
			roster, empty := c.hub.rooms.Leave(roomID, c.userID)
			c.hub.broadcastRoster(roomID, roster)
			if empty {
				c.hub.stopRoomRings(roomID) // last one out → stop reminding any non-joiners
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
		// Hold back messages from senders this user has blocked — they stay queued
		// and flush once unblocked (the recipient reconnects after unblocking).
		if it.Sender != "" {
			if blocked, err := c.store.IsBlocked(ctx, c.userID, it.Sender); err == nil && blocked {
				continue
			}
		}
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
		// Ring them now, then keep reminding (every groupRingInterval, up to groupRingCount
		// total) until they join — independent of who else joined.
		c.ringMember(f.RoomID, to, payload)
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
		// If the recipient has blocked the sender, the message is HELD: still durably
		// queued (E2EE ciphertext the server can't read), but NOT delivered live, NOT
		// pushed, and NOT marked delivered. The drain paths skip held senders until
		// the recipient unblocks, at which point the backlog flushes. The sender just
		// sees "sent" (never "delivered") so the block stays invisible to them.
		blocked := false
		if b, err := c.store.IsBlocked(ctx, f.To, c.userID); err == nil {
			blocked = b
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
		if !blocked {
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
		// originate 'seen' (the viewer opened the message) and 'downloaded' (the
		// recipient confirming it has the media bytes, so the sender can delete the
		// blob); 'sent'/'delivered' are server-authoritative, so a client claiming them
		// is dropped (otherwise a peer could forge a 'delivered' for a victim's group
		// message id and make the sender evict its other unsent copies). 'read' is no
		// longer accepted post-cutover (spec 1010). Stamp From = the authenticated
		// sender so the recipient can scope it.
		if f.To == "" || (f.Status != "seen" && f.Status != "downloaded") {
			return
		}
		out := frame{T: "receipt", MessageID: f.MessageID, Status: f.Status, At: f.At, From: c.userID}
		if payload, err := json.Marshal(out); err == nil {
			c.hub.Send(f.To, payload)
		}
		// Durably record a 'seen' so a group's "Seen X/N" survives the sender being
		// offline at the moment a member opened it (spec 1010) — the parallel of how
		// 'ack' calls RecordDelivery. f.To is the message author (the reconciling
		// sender); c.userID is the member who saw it. 'downloaded' is a media-cleanup
		// signal and is NOT recorded (unchanged).
		if f.Status == "seen" {
			if err := c.store.RecordSeen(ctx, f.To, c.userID, f.MessageID); err != nil {
				slog.Error("record seen", "err", err)
			}
		}

	case "activity":
		// Ephemeral "is typing / recording" indicator (spec 1009). Modeled on the
		// read-receipt relay, NOT on presence: the kind + conversation ride in the
		// sealed Ciphertext (the server sees only who→whom), and the frame is
		// relayed LIVE ONLY — never durably queued, never pushed, never persisted,
		// and dropped if the peer has no live socket (an indicator is only
		// meaningful right now). Stamp From = the authenticated sender so a client
		// cannot signal activity "as" someone else (the receipt anti-forgery rule),
		// and drop if the recipient has blocked the sender.
		if f.To == "" {
			return
		}
		if blocked, err := c.store.IsBlocked(ctx, f.To, c.userID); err == nil && blocked {
			return
		}
		out := frame{T: "activity", From: c.userID, Ciphertext: f.Ciphertext}
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
		// A mesh group-call leg (roomId set) is pure peer-to-peer signalling: relay it to
		// the addressed peer WITHOUT the 1:1 ring/push/buffer machinery (the group was
		// already rung once via call-join → ringGroup). Real 1:1 offers have no roomId.
		if f.RoomID != "" {
			c.relayCall(f)
			return
		}
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
		if delivered {
			// The callee has a live socket and just received the offer → it's reachable.
			// Tell the caller so its UI flips "Calling" → "Ringing" without depending on the
			// callee's app echoing call-ringing (which a foregrounded-but-throttled page can
			// miss — the background path already flips via the push /v1/call/ack).
			if rp, err := json.Marshal(frame{T: "call-ringing", CallID: f.CallID, From: f.To}); err == nil {
				c.hub.Send(c.userID, rp)
			}
		}
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
		delivered := c.relayCall(f)
		// A 1:1 caller trickles its ICE candidates right after the offer. If the callee is
		// briefly offline (backgrounded long enough — ~30s — that iOS suspended its socket),
		// those candidates would be lost while only the offer is buffered, so an answered
		// call could never connect. Buffer undelivered 1:1 ICE too, flushed (after the offer,
		// in arrival order) when the device reconnects. Mesh ICE (roomId) is group signalling
		// between already-present peers and stays live-only.
		if !delivered && f.T == "call-ice" && f.RoomID == "" && f.To != "" {
			if rp := c.forwardedCallPayload(f); rp != nil {
				c.hub.bufferCall(f.To, rp)
			}
		}
		// Once the callee engages (ringing/answered) or the call resolves, stop the
		// re-push ring loop so it can't keep buzzing a settled call.
		switch f.T {
		case "call-ringing", "call-answer", "call-accept", "call-reject", "call-cancel", "call-busy", "call-end":
			c.hub.stopCallRing(f.CallID)
		}
		// A group-call recall "remove" (call-cancel carrying a roomId + target) → stop
		// reminding that invitee; the relay above also tells their device to stop ringing.
		if f.T == "call-cancel" && f.RoomID != "" && f.To != "" {
			c.hub.stopGroupMemberRing(f.RoomID, f.To)
		}

	case "call-key":
		// Group media key, sealed peer-to-peer; relayed live, never inspected.
		c.relayCall(f)

	case "call-streamid":
		// A member's "this stream is mine" announcement, sealed peer-to-peer (lets
		// peers label tiles with names/avatars); relayed live, never inspected.
		c.relayCall(f)

	case "call-key-request":
		// A member missing the current group key asks the master (f.To) to resend it.
		// Live relay only (like call-key); the master re-seals and sends.
		c.relayCall(f)

	case "call-join":
		// Join a group-call room: update membership and tell everyone the roster. The
		// roster broadcast is what drives mesh: each member opens a direct peer connection
		// to every other member (no SFU; media is native DTLS-SRTP, end-to-end encrypted).
		if f.RoomID == "" {
			return
		}
		roster := c.hub.rooms.Join(f.RoomID, c.userID)
		c.hub.broadcastRoster(f.RoomID, roster)
		c.hub.stopGroupMemberRing(f.RoomID, c.userID) // they're in now → stop reminding them
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
		roster, empty := c.hub.rooms.Leave(f.RoomID, c.userID)
		c.hub.broadcastRoster(f.RoomID, roster)
		if empty {
			c.hub.stopRoomRings(f.RoomID) // call's over → stop reminding any non-joiners
		}

	case "call-ring":
		// Recall: the caller re-rings ONE group invitee who hasn't joined (the per-tile
		// recall button). Only a participant of the room may ring, and we re-ring just f.To.
		if f.RoomID == "" || f.To == "" || !c.hub.rooms.InRoom(f.RoomID, c.userID) {
			return
		}
		if !c.hub.allowRing(c.userID) {
			return
		}
		if blocked, err := c.store.IsBlocked(ctx, f.To, c.userID); err == nil && blocked {
			return
		}
		invite := frame{T: "call-group-invite", From: c.userID, RoomID: f.RoomID, Kind: f.Kind, Members: f.Members}
		if payload, err := json.Marshal(invite); err == nil {
			c.ringMember(f.RoomID, f.To, payload)
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
