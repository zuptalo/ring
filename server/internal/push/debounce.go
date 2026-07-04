package push

import (
	"sync"
	"time"
)

// msgDebouncer coalesces per-user MESSAGE tickles with a trailing edge (spec 2020).
//
// The server sends one content-free push per relayed message, and a fast burst used
// to mean one push-service wake per message: the first wake drains the WHOLE relay
// queue (showing the latest body + a count), so the remaining wakes find nothing new
// and could only re-assert the same notification — which iOS renders as a visibly
// repeated banner and a duplicate Notification Center entry. Debouncing at the
// SOURCE removes those wakes: within `window`, a burst yields at most the leading
// tickle (immediate — an isolated message gains no latency) and ONE trailing tickle
// (guaranteeing the burst's last message is always announced, since any wake drains
// everything queued). Message tickles only — calls must never be delayed, and the
// other kinds are rare enough that their existing collapse topics suffice.
//
// In-memory by design (constitution VI: no new state store): a server restart merely
// forgets in-flight windows, worst case one extra tickle. The map self-prunes.
type msgDebouncer struct {
	mu      sync.Mutex
	window  time.Duration
	last    map[string]time.Time   // last time a tickle was actually sent, per user
	pending map[string]*time.Timer // a scheduled trailing send, per user
	send    func(userID string)
}

func newMsgDebouncer(window time.Duration, send func(string)) *msgDebouncer {
	return &msgDebouncer{
		window:  window,
		last:    make(map[string]time.Time),
		pending: make(map[string]*time.Timer),
		send:    send,
	}
}

// hit records one message for userID and decides: send now (quiet period), coalesce
// into an already-scheduled trailing send, or schedule that trailing send.
func (d *msgDebouncer) hit(userID string) {
	d.mu.Lock()
	now := time.Now()
	// Lazy prune: entries older than a few windows are dead weight. Amortized —
	// only sweeps when the map has grown well past any realistic live-burst count.
	if len(d.last) > 4096 {
		for u, t := range d.last {
			if now.Sub(t) > 4*d.window && d.pending[u] == nil {
				delete(d.last, u)
			}
		}
	}
	if d.pending[userID] != nil {
		d.mu.Unlock() // a trailing send is already scheduled — it covers this message
		return
	}
	elapsed := now.Sub(d.last[userID])
	if elapsed >= d.window {
		d.last[userID] = now
		d.mu.Unlock()
		d.send(userID) // quiet period → leading send, no added latency
		return
	}
	d.pending[userID] = time.AfterFunc(d.window-elapsed, func() {
		d.mu.Lock()
		delete(d.pending, userID)
		d.last[userID] = time.Now()
		d.mu.Unlock()
		d.send(userID)
	})
	d.mu.Unlock()
}
