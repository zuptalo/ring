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
// (short-lived, never-collapsed tickle); NotifyConn is for a friend-request
// lifecycle event (received/accepted/rejected, collapsible tickle). Implemented
// by the push package; nil disables push.
type Notifier interface {
	Notify(ctx context.Context, userID string)
	NotifyCall(ctx context.Context, userID string)
	NotifyConn(ctx context.Context, userID string)
	NotifyPost(ctx context.Context, userID string)
	// NotifyPostActivity wakes the POST OWNER's devices for engagement (a reaction or
	// comment) on their post (spec 1031). Unlike the other tickles it carries the post
	// id — still zero-knowledge (routing metadata the server already holds, sealed
	// inside the encrypted Web Push envelope) — so the SW can pull that post's
	// engagement and decide locally what, if anything, to show.
	NotifyPostActivity(ctx context.Context, userID, postID string)
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
	// Per (room, user): a grace timer started when their last connection drops, so a brief
	// network blip (e.g. Wi-Fi↔cellular handoff) doesn't instantly evict them from a live
	// call. Cancelled if they reconnect and re-join within the window; on expiry they're
	// removed and the roster re-broadcast (call dropped, no auto-recall). Keyed "room\x00user".
	evictMu     sync.Mutex
	evictTimers map[string]*time.Timer
	// Active 1:1 rings + the "callee went unreachable" grace timers behind US2 (honest
	// ringing). activeRings tracks every in-flight 1:1 offer (caller↔callee↔callId) — unlike
	// callRings (which only exists when the callee is push-rung) it's recorded for ALL offers,
	// including an online/foregrounded callee, so a mid-ring reload of exactly that callee is
	// covered. When a callee's LAST socket drops we start a short grace timer per active ring;
	// if they reconnect and re-ack ringing within it (recovered offer re-flushes → re-ring →
	// AckCallReachable) we cancel it, otherwise we tell the caller the callee is unreachable so
	// it ends promptly instead of ringing into the void for the full no-answer window.
	ringMu2     sync.Mutex
	activeRings map[string]activeRing // callId → caller/callee
	dropTimers  map[string]*time.Timer
}

// ringDropGrace is how long the caller keeps "ringing" after the callee's last socket drops,
// before being told the callee is unreachable. Long enough for a fast reload to reconnect,
// re-flush the recovered offer, re-ring, and re-ack (US2 scenario 2); short enough that a
// genuinely-gone callee ends the caller's call in a few seconds, not the ~60s no-answer
// backstop. var (not const) so tests can shrink it; production value is unchanged.
var ringDropGrace = 8 * time.Second

// activeRing is one in-flight 1:1 ring tracked for the US2 unreachable-callee teardown.
type activeRing struct {
	caller string
	callee string
}

// callRecoveryGrace is how long a disconnected participant is held in a call room before
// being evicted, giving them ~a network-handoff's worth of time to reconnect and re-join.
// var (not const) so tests can shrink it; production value is unchanged.
var callRecoveryGrace = 18 * time.Second

type callRing struct {
	caller string
	callee string
	cancel context.CancelFunc
}

const (
	// A backgrounded callee is re-pushed this many times, this far apart, to feel like
	// ringing (distinct visible notifications, not one tickle). The window (count*interval)
	// spans ~60s so the callee has a full minute to react, and a push is SKIPPED for any
	// round where they're already foregrounded (they see the in-app ring) — see startCallRing.
	callRingCount    = 6
	callRingInterval = 10 * time.Second
)

// A group-call invitee who hasn't joined is reminded this many times, this far apart
// (~60s total), and stops the moment they join OR explicitly decline/leave. Pushes are
// skipped once the member is foregrounded (the in-app ring re-shows live regardless). var
// (not const) so tests can shrink the cadence — production values are unchanged.
var (
	groupRingCount    = 6
	groupRingInterval = 10 * time.Second
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
// that reconnects still receives it (background ringing). callID (when known) lets
// the buffer be cleared per-call once that call resolves, so a settled/declined
// invite can't re-ring on a later reconnect (spec 2012 US1); empty for group invites.
type bufferedCall struct {
	payload []byte
	callID  string
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
		ringHist:    make(map[string][]time.Time),
		callRings:   make(map[string]*callRing),
		groupRings:  make(map[string]map[string]context.CancelFunc),
		evictTimers: make(map[string]*time.Timer),
		activeRings: make(map[string]activeRing),
		dropTimers:  make(map[string]*time.Timer),
	}
}

// evictKey namespaces an eviction timer by room + user.
func evictKey(roomID, userID string) string { return roomID + "\x00" + userID }

// scheduleEviction holds a disconnected participant in roomID for callRecoveryGrace, then —
// if they haven't reconnected and re-joined (which cancels this) and still have no live
// connection — removes them and re-broadcasts the roster. No auto-recall: a dropped member
// is simply gone until someone explicitly rings them again.
func (h *Hub) scheduleEviction(roomID, userID string) {
	key := evictKey(roomID, userID)
	h.evictMu.Lock()
	if old := h.evictTimers[key]; old != nil {
		old.Stop()
	}
	h.evictTimers[key] = time.AfterFunc(callRecoveryGrace, func() {
		h.evictMu.Lock()
		delete(h.evictTimers, key)
		h.evictMu.Unlock()
		// Reconnected meanwhile? Then they're back online — leave them in the room; their
		// re-join already refreshed the roster.
		if h.isOnline(userID) || h.hasAnyConn(userID) {
			return
		}
		// They didn't come back in time → the call is dropped for them. Remove them and tell
		// the others, but do NOT auto-recall: stop any reminder and clear any held invite so
		// nothing rings them back automatically. Only an explicit recall returns them.
		h.stopGroupMemberRing(roomID, userID)
		h.clearBufferedCalls(userID)
		roster, empty := h.rooms.Leave(roomID, userID)
		h.broadcastRoster(roomID, roster)
		if empty {
			h.stopRoomRings(roomID)
		}
	})
	h.evictMu.Unlock()
}

// cancelEviction stops a pending eviction (the participant reconnected and re-joined).
func (h *Hub) cancelEviction(roomID, userID string) {
	key := evictKey(roomID, userID)
	h.evictMu.Lock()
	if t := h.evictTimers[key]; t != nil {
		t.Stop()
		delete(h.evictTimers, key)
	}
	h.evictMu.Unlock()
}

// hasAnyConn reports whether userID has any live connection (foregrounded or not).
func (h *Hub) hasAnyConn(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns[userID]) > 0
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
			// Skip the OS push once the callee is foregrounded + responsive: they can see the
			// in-app ring, so further pushes are just noise (the loop keeps running in case
			// they background again before answering).
			if !h.isActiveFresh(callee) {
				func() {
					nctx, ncancel := context.WithTimeout(context.Background(), 15*time.Second)
					defer ncancel()
					notifier.NotifyCall(nctx, callee)
				}()
			}
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
	// A fresh ring-ack from this callee means they're reachable again → cancel any pending
	// "callee unreachable" grace for their rings, so a quick reload that re-rings within the
	// grace doesn't falsely end the caller's call (spec 2012 US2 scenario 2).
	h.cancelRingDropTimersForCallee(callee)
}

// trackRing records an in-flight 1:1 ring so the US2 drop-detection (cleanup) can find rings
// where a vanished user is the callee. Recorded for EVERY 1:1 offer, including a live-delivered
// one. Replaces any prior entry for the callId (idempotent re-offer).
func (h *Hub) trackRing(caller, callee, callID string) {
	if callID == "" || callee == "" {
		return
	}
	h.ringMu2.Lock()
	h.activeRings[callID] = activeRing{caller: caller, callee: callee}
	h.ringMu2.Unlock()
}

// startRingDropTimer arms (or replaces) the grace timer for one ring after the callee's last
// socket drops. On expiry — if nothing cancelled it (no re-ack within the grace) — it tells the
// CALLER the callee is unreachable via a call-end{reason:"unreachable"} (a frame the caller
// already tears down on while ringing), then forgets the ring. The lock is NOT held across the
// timer callback; the callback re-locks only briefly to remove itself.
func (h *Hub) startRingDropTimer(callID, caller string) {
	if callID == "" {
		return
	}
	h.ringMu2.Lock()
	if old := h.dropTimers[callID]; old != nil {
		old.Stop()
	}
	h.dropTimers[callID] = time.AfterFunc(ringDropGrace, func() {
		h.ringMu2.Lock()
		// Already cancelled/superseded? Then this fire is stale — do nothing.
		if t := h.dropTimers[callID]; t == nil {
			h.ringMu2.Unlock()
			return
		}
		delete(h.dropTimers, callID)
		delete(h.activeRings, callID)
		h.ringMu2.Unlock()
		// Grace elapsed without the callee re-acking → end the caller's call promptly with a
		// clear outcome instead of the ~60s no-answer wait. Also stop the push ring loop so a
		// backgrounded callee that returns later isn't buzzed for a call the caller has ended.
		h.stopCallRing(callID)
		if payload, err := json.Marshal(frame{T: "call-end", CallID: callID, Reason: "unreachable"}); err == nil {
			h.Send(caller, payload)
		}
	})
	h.ringMu2.Unlock()
}

// stopRingDropTimer cancels and forgets the grace timer + tracked ring for a callId (the call
// resolved, or the callee re-acked). Safe if none exists.
func (h *Hub) stopRingDropTimer(callID string) {
	if callID == "" {
		return
	}
	h.ringMu2.Lock()
	if t := h.dropTimers[callID]; t != nil {
		t.Stop()
		delete(h.dropTimers, callID)
	}
	delete(h.activeRings, callID)
	h.ringMu2.Unlock()
}

// cancelRingDropTimersForCallee cancels any pending grace timers whose callee just became
// reachable again (re-acked ringing). Leaves the ring tracked (the call is still in-flight).
func (h *Hub) cancelRingDropTimersForCallee(callee string) {
	h.ringMu2.Lock()
	for callID, r := range h.activeRings {
		if r.callee != callee {
			continue
		}
		if t := h.dropTimers[callID]; t != nil {
			t.Stop()
			delete(h.dropTimers, callID)
		}
	}
	h.ringMu2.Unlock()
}

// ringDropOnCalleeGone is called from cleanup when a user's LAST socket drops: for every active
// ring where they're the callee, start the grace timer. A still-connected callee (another
// device) is unaffected. Snapshots under the lock, then arms timers (startRingDropTimer re-locks).
func (h *Hub) ringDropOnCalleeGone(callee string) {
	type pend struct{ callID, caller string }
	var pending []pend
	h.ringMu2.Lock()
	for callID, r := range h.activeRings {
		if r.callee == callee {
			pending = append(pending, pend{callID, r.caller})
		}
	}
	h.ringMu2.Unlock()
	for _, p := range pending {
		h.startRingDropTimer(p.callID, p.caller)
	}
}

// stopAllRingDropTimers cancels every grace timer (hub shutdown / test cleanup) so no timer
// goroutine leaks past the hub's life.
func (h *Hub) stopAllRingDropTimers() {
	h.ringMu2.Lock()
	for callID, t := range h.dropTimers {
		t.Stop()
		delete(h.dropTimers, callID)
	}
	h.ringMu2.Unlock()
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
		c.hub.bufferCall(member, "", invite) // a push-woken reconnect still finds the invite (group: cleared per-user)
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
			// Skip the OS push once they're foregrounded + responsive — they already see the
			// live in-app ring above; a backgrounded member still gets pushed (the point).
			if !h.isActiveFresh(member) {
				func() {
					nctx, ncancel := context.WithTimeout(context.Background(), 15*time.Second)
					defer ncancel()
					notifier.NotifyCall(nctx, member)
				}()
			}
		}
		// Rounds exhausted and still not in the room → authoritatively tell the WHOLE room
		// "no answer" so every participant flips this member's tile to recall/remove at the
		// same moment (not each on its own local timer). A cancelled loop (recall/remove/join)
		// returned above and never reaches here.
		if ctx.Err() == nil && !h.rooms.InRoom(roomID, member) {
			h.broadcastMemberState(roomID, member, "noanswer")
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

// bufferCall holds a call offer/ICE for `to` for a short TTL (expiring older ones).
// callID tags the frame so the hold can later be cleared per-call when that call
// resolves (empty for group invites, which are cleared per-user on join/leave/evict).
func (h *Hub) bufferCall(to, callID string, payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	kept := h.callBuf[to][:0]
	for _, b := range h.callBuf[to] {
		if b.exp.After(now) {
			kept = append(kept, b)
		}
	}
	buf := append(kept, bufferedCall{payload: payload, callID: callID, exp: now.Add(callBufferTTL)})
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

// clearBufferedCalls drops any held call offers for a user. Called the moment they join,
// leave, or are evicted from a call so a stale buffered invite can never re-ring them on a
// later reconnect — only a fresh, explicit recall (ringMember) re-rings someone who's out.
func (h *Hub) clearBufferedCalls(userID string) {
	h.mu.Lock()
	delete(h.callBuf, userID)
	h.mu.Unlock()
}

// clearBufferedCallID drops only the held frames (offer + trickled ICE) for ONE 1:1 callId,
// leaving any unrelated held offer intact. Called when a 1:1 call resolves
// (answered/declined/cancelled/ended) so its now-retained invite can't re-ring the callee on a
// later reconnect (spec 2012 US1 FR-003). callId-scoped because a 1:1 offer is now buffered
// even when delivered live; we must forget it precisely when the call settles, not the user's
// whole buffer.
func (h *Hub) clearBufferedCallID(userID, callID string) {
	if callID == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	bufs := h.callBuf[userID]
	if len(bufs) == 0 {
		return
	}
	kept := bufs[:0]
	for _, b := range bufs {
		if b.callID != callID {
			kept = append(kept, b)
		}
	}
	if len(kept) == 0 {
		delete(h.callBuf, userID)
	} else {
		h.callBuf[userID] = kept
	}
}

// SharesCallRoom reports whether a and b are currently in a common call room. Used by the
// key-bundle handler to let co-participants of a live call fetch each other's bundles
// (so an ad-hoc group call can mesh between members who aren't contacts) for the duration
// of the call only — no persistent connection is created.
func (h *Hub) SharesCallRoom(a, b string) bool { return h.rooms.SharesRoom(a, b) }

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

// broadcastMemberState tells EVERYONE in the room about an invitee's ring-state transition
// (status: "ringing" on recall, "noanswer" once the reminder rounds expire, "removed" when an
// invitee is dropped). The server is the single authority on these transitions, so every
// participant flips that member's tile at the same instant — instead of each client timing
// it locally from its own join (which made the "still ringing vs. retry" tile differ per
// person). Carries only ids the server already tracks (room roster) — no plaintext.
func (h *Hub) broadcastMemberState(roomID, member, status string) {
	payload, err := json.Marshal(frame{T: "call-member", RoomID: roomID, To: member, Status: status})
	if err != nil {
		return
	}
	for _, uid := range h.rooms.Roster(roomID) {
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
	// Group calls: don't evict on a socket drop. A short interruption (network blip, a
	// Wi-Fi↔cellular handoff) would otherwise instantly remove the participant and tell
	// everyone they left. Instead, if this was their LAST connection, hold their place for
	// callRecoveryGrace; they're evicted only if they don't reconnect and re-join in time
	// (a re-join cancels it). A user with another live device stays put — no timer.
	if c.hub.rooms != nil && !c.hub.hasAnyConn(c.userID) {
		for _, roomID := range c.hub.rooms.RoomsForUser(c.userID) {
			c.hub.scheduleEviction(roomID, c.userID)
		}
	}
	// Honest ringing (spec 2012 US2): if this was the user's LAST socket and they're the callee
	// of an in-flight 1:1 ring, start the grace timer. A fast reload that reconnects, re-flushes
	// the recovered offer, re-rings and re-acks within the grace cancels it; otherwise the caller
	// is told the callee is unreachable so it ends promptly. A user with another live device is
	// still reachable, so no timer is armed.
	if !c.hub.hasAnyConn(c.userID) {
		c.hub.ringDropOnCalleeGone(c.userID)
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
		// Track this ring (caller↔callee↔callId) for the US2 honest-ringing drop detection —
		// recorded for ALL offers, including a live-delivered one, so a mid-ring reload of an
		// online callee is covered (the common case the bug report hit). Cleared when the call
		// resolves or the unreachable grace fires.
		c.hub.trackRing(c.userID, f.To, f.CallID)
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
		// Retain the offer briefly so a CALLEE THAT RECONNECTS still rings — whether it was
		// offline (push-woken cold start) OR online but reloaded mid-ring (e.g. tapped an app
		// update from the incoming-call screen), which destroys its in-memory call state and the
		// offer client-side (spec 2012 US1). We buffer regardless of `delivered`: a live delivery
		// already rang it once, but flushBufferedCalls() on its next connect re-delivers this so a
		// reloaded callee re-rings and can still answer. The hold is callId-tagged and cleared when
		// the call resolves (clearBufferedCallID), so a settled/declined call never re-rings. The
		// caller keeps ringing; its own dial timeout (or US2 unreachable drop) ends the call.
		c.hub.bufferCall(f.To, f.CallID, payload)

	case "call-ringing", "call-answer", "call-ice", "call-accept",
		"call-reject", "call-cancel", "call-busy", "call-end",
		"call-upgrade-request", "call-upgrade-accept", "call-upgrade-reject":
		// Pure live relay of the remaining 1:1 signalling (incl. the consent-gated
		// audio<->video upgrade). The sender is authoritative; SDP/ICE stay E2EE'd.
		c.relayCall(f)
		// A 1:1 caller trickles its ICE candidates right after the offer. Retain 1:1 ICE
		// alongside the offer so a callee that reconnects — whether it was offline (iOS
		// suspended its socket) or reloaded mid-ring (spec 2012 US1) — receives the candidates
		// too (flushed after the offer, in arrival order), otherwise an answered call could never
		// connect. Buffered regardless of `delivered` and callId-tagged, mirroring the offer, so
		// the whole hold is cleared together when the call resolves. Mesh ICE (roomId) is group
		// signalling between already-present peers and stays live-only.
		if f.T == "call-ice" && f.RoomID == "" && f.To != "" {
			if rp := c.forwardedCallPayload(f); rp != nil {
				c.hub.bufferCall(f.To, f.CallID, rp)
			}
		}
		// Once the callee engages (ringing/answered) or the call resolves, stop the
		// re-push ring loop so it can't keep buzzing a settled call.
		switch f.T {
		case "call-ringing", "call-answer", "call-accept", "call-reject", "call-cancel", "call-busy", "call-end":
			c.hub.stopCallRing(f.CallID)
		}
		// A callee echoing call-ringing (in-app, the foregrounded-reload re-ack path) means it's
		// reachable again → cancel any pending US2 unreachable grace for its rings, so a quick
		// reload that re-rings within the grace doesn't falsely end the caller's call (US2
		// scenario 2). The HTTP /v1/call/ack push path already does this via AckCallReachable.
		if f.T == "call-ringing" && f.RoomID == "" {
			c.hub.cancelRingDropTimersForCallee(c.userID)
		}
		// When a 1:1 call SETTLES (answered/declined/cancelled/ended), forget the retained
		// invite for that callId so a later callee reconnect can't re-ring a call that's already
		// over (spec 2012 US1 FR-003). Scope it by callId on both parties — whoever holds the
		// buffer — since either side may send the resolving frame and a roomId means it's group
		// signalling (handled separately, not a 1:1 invite). call-ringing is engagement, not a
		// resolution, so it does NOT clear the invite (a reload after ringing must still recover).
		if f.RoomID == "" && f.CallID != "" {
			switch f.T {
			case "call-answer", "call-reject", "call-cancel", "call-busy", "call-end":
				c.hub.clearBufferedCallID(f.To, f.CallID)
				c.hub.clearBufferedCallID(c.userID, f.CallID)
				// A settled call also cancels any pending US2 "callee unreachable" grace timer for
				// this callId, so a normal hangup never fires the unreachable teardown.
				c.hub.stopRingDropTimer(f.CallID)
			}
		}
		// A group-call recall "remove" (call-cancel carrying a roomId + target) → stop
		// reminding that invitee; the relay above also tells their device to stop ringing.
		// Tell the whole room so everyone drops the removed tile together (any participant
		// may remove, not just the initiator).
		if f.T == "call-cancel" && f.RoomID != "" && f.To != "" {
			c.hub.stopGroupMemberRing(f.RoomID, f.To)
			c.hub.broadcastMemberState(f.RoomID, f.To, "removed")
		}
		// A busy invitee replying to a group invite (call-busy carrying a roomId) won't join →
		// stop re-ringing the SENDER; the relay above tells the caller to mark them unavailable
		// (spec 0004 US2).
		if f.T == "call-busy" && f.RoomID != "" {
			c.hub.stopGroupMemberRing(f.RoomID, c.userID)
		}

	case "call-join":
		// Join a group-call room: update membership and tell everyone the roster. The
		// roster broadcast is what drives mesh: each member opens a direct peer connection
		// to every other member (no SFU; media is native DTLS-SRTP, end-to-end encrypted).
		if f.RoomID == "" {
			return
		}
		// A re-join (reconnect after a network blip) cancels any pending grace eviction so the
		// participant keeps their place and others smoothly re-establish (spec 0004).
		c.hub.cancelEviction(f.RoomID, c.userID)
		// They're in now → drop any held invite so a later reconnect's flush can't re-ring them
		// back into a call they're already in (reconnecting must never look like a new call).
		c.hub.clearBufferedCalls(c.userID)
		// Authoritative participant cap (spec 0004 US3): a video call holds at most VideoMax,
		// an audio one at most AudioMax. The cap follows the join's kind. A user already in the
		// room is always re-admitted (idempotent recovery). On refusal, tell only the joiner
		// (call-full) and broadcast no roster change, so the existing call is undisturbed.
		max := call.AudioMax
		if f.Kind == "video" {
			max = call.VideoMax
		}
		roster, admitted := c.hub.rooms.JoinIfRoom(f.RoomID, c.userID, max)
		if !admitted {
			c.send1(frame{T: "call-full", RoomID: f.RoomID, Kind: f.Kind})
			return
		}
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
		c.hub.cancelEviction(f.RoomID, c.userID) // explicit leave supersedes any pending grace timer
		c.hub.clearBufferedCalls(c.userID)       // and drop any held invite so they aren't re-rung on reconnect
		// Stop reminding THIS member: a call-leave is sent both when leaving a joined call
		// and when declining/dismissing an invite they never accepted. Without this, a
		// declined group invitee keeps getting re-rung every groupRingInterval until the
		// reminder rounds run out — the "called back in automatically" bug (spec 0004 US1).
		c.hub.stopGroupMemberRing(f.RoomID, c.userID)
		// A leave from someone NOT in the room is a DECLINE of an invite they never accepted.
		// The roster doesn't change (they were never in it), so the caller's tile would keep
		// ringing until its local timeout — tell the room they're not coming so every tile
		// flips to recall/remove together now (any participant can then recall them).
		declined := !c.hub.rooms.InRoom(f.RoomID, c.userID)
		roster, empty := c.hub.rooms.Leave(f.RoomID, c.userID)
		c.hub.broadcastRoster(f.RoomID, roster)
		if declined && !empty {
			c.hub.broadcastMemberState(f.RoomID, c.userID, "noanswer")
		}
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
			// Tell the whole room this invitee is ringing again, so every participant's tile
			// flips back from "no answer" to "ringing" together (any participant may recall).
			c.hub.broadcastMemberState(f.RoomID, f.To, "ringing")
		}
	}
}
