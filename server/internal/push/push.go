// Package push sends Web Push notifications via VAPID. To preserve the
// zero-knowledge model it only ever sends a content-free "tickle" - the client
// shows a generic notification (or, with auto-unlock, fetches + decrypts the
// real E2EE message over the relay for a rich preview). Message content never
// reaches the push service; only the frame *type* ("msg" | "call") does, so the
// service worker can render an incoming-call alert without a relay round-trip.
package push

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"ring/server/internal/store"
)

// Content-free tickles (no message data). The SW branches on `t`.
var (
	tickleMsg  = []byte(`{"t":"msg"}`)
	tickleCall = []byte(`{"t":"call"}`)
	// tickleConn wakes a device for a connection (friend-request) lifecycle event
	// — request received / accepted / rejected. It carries NO identity or state;
	// the SW resolves specifics from GET /v1/connections (zero-knowledge: the push
	// service only learns "a connection event occurred for this endpoint", the same
	// privacy class as msg/call).
	tickleConn = []byte(`{"t":"conn"}`)
	// ticklePost wakes a device for a new Wall post addressed to it (spec 0003). It
	// carries NO content; the SW shows a generic "new post" notification when the app
	// is closed and nudges a live page to pull + show the rich "X shared a photo"
	// in-app banner. Same zero-knowledge class as msg/conn.
	ticklePost = []byte(`{"t":"post"}`)
	// tickleVersion wakes every device after a new app version is deployed. It carries
	// NO payload: the SW fetches the PUBLIC, non-sensitive release info from
	// GET /v1/config (version + user-friendly notes) and shows a "what's new"
	// notification. Even though that info isn't secret, keeping the push payload
	// content-free preserves the single, auditable invariant that the server NEVER puts
	// content in a push — the same zero-knowledge class as every other tickle.
	tickleVersion = []byte(`{"t":"version"}`)
)

const (
	// msgTTL: a queued chat message is worth alerting on for a long time, so the
	// push service must HOLD the tickle until the device next comes online. With a
	// tiny TTL a phone merely asleep / out of signal for a few seconds would never
	// learn a message is waiting (the bytes stay safely queued on the relay, but no
	// notification fires until the app is reopened). 28 days is the practical max
	// most push services honor; a single content-free tickle is cheap to hold.
	msgTTL = 28 * 24 * 60 * 60 // 2419200s
	// callTTL: a ring is real-time. A tickle that can't wake the device within the
	// caller's answer window is a missed call, so it must NOT linger and resurrect a
	// stale ring minutes later. 60s gives the callee time to open the app from the
	// notification and answer (kept in step with callBufferTTL + the caller timeout).
	callTTL = 60
	// msgTopic collapses a burst of undelivered MESSAGE tickles to the same
	// subscription into a single wake-up - the SW drains the whole relay queue on
	// any wake, so collapsing loses nothing. Per RFC 8030 collapsing is scoped to
	// the push subscription (one device), so a constant topic is correct. Call
	// tickles deliberately use NO topic, so a flood of messages can never collapse
	// an incoming-call ring away. Must be <=32 url-safe-base64 chars.
	msgTopic = "ring-msg"

	// connTTL: a friend-request lifecycle wake is worth holding until the device
	// next comes online (like a message), but a weeks-stale connection wake is
	// noise — the SW reconciles current state from GET /v1/connections on wake, so
	// a moderate hold is plenty. 7 days covers a phone offline over a long weekend.
	connTTL = 7 * 24 * 60 * 60 // 604800s
	// connTopic collapses a burst of connection tickles to one subscription into a
	// single wake-up (the SW re-reads the full connection state on any wake, so
	// collapsing loses nothing). Distinct from msgTopic so a connection wake is
	// never collapsed away by a message burst (and vice versa).
	connTopic = "ring-conn"

	// postTTL / postTopic: a Wall post wake is worth holding until the device next
	// comes online (like a message), collapsed per subscription so a burst is one wake.
	postTTL   = 7 * 24 * 60 * 60 // 604800s
	postTopic = "ring-post"

	// postActivityTTL: an "engagement on your post" wake follows the post-tickle
	// holding rationale (worth learning about when the device next comes online),
	// but posts themselves live at most 72h, so holding the wake longer than the
	// post can exist would only ever wake a device for content that is already
	// gone (the SW would fetch, find nothing fresh, and show nothing).
	postActivityTTL = 72 * 60 * 60 // 259200s — the max post lifetime
	// The activity topic is PER POST (see postActivityTopic) so a burst of
	// reactions/comments on one post collapses to a single wake per device, while
	// activity on a different post still wakes separately.

	// versionTTL / versionTopic: a "new version" announcement is sent during the device's
	// local daytime window (09:00–17:00, spec 1016), so it must EXPIRE within a few hours
	// rather than be held for late delivery — otherwise a device that was offline when the
	// push was sent would get woken that night, the exact disturbance the schedule exists to
	// avoid. A short TTL means a push that can't be delivered promptly is dropped, not held.
	// Collapsed per subscription so multiple deploys while offline yield ONE wake.
	versionTTL   = 3 * 60 * 60 // 10800s (~3h: expires well before night even near the window edge)
	versionTopic = "ring-version"

	// versionSweepConcurrency bounds in-flight deliveries during a version-announcement
	// sweep, so a fan-out across the due subscriptions can't open thousands of sockets.
	versionSweepConcurrency = 16

	// sendBudget bounds one subscription's whole delivery attempt (incl. retries),
	// so one slow/hung endpoint can't starve a user's other devices.
	sendBudget = 10 * time.Second
	maxRetries = 2 // transient failures only (network / 429 / 5xx)
)

// pushParams are the per-call Web Push transport knobs. They never touch the
// (content-free) payload, so the zero-knowledge model is unaffected.
type pushParams struct {
	payload []byte
	ttl     int
	urgency webpush.Urgency
	topic   string
}

var (
	msgParams = func() pushParams {
		return pushParams{payload: tickleMsg, ttl: msgTTL, urgency: webpush.UrgencyHigh, topic: msgTopic}
	}
	callParams = func() pushParams {
		return pushParams{payload: tickleCall, ttl: callTTL, urgency: webpush.UrgencyHigh, topic: ""}
	}
	connParams = func() pushParams {
		return pushParams{payload: tickleConn, ttl: connTTL, urgency: webpush.UrgencyHigh, topic: connTopic}
	}
	postParams = func() pushParams {
		return pushParams{payload: ticklePost, ttl: postTTL, urgency: webpush.UrgencyHigh, topic: postTopic}
	}
	versionParams = func() pushParams {
		// Low urgency: an announcement should never preempt battery-saving like a
		// message/call wake does.
		return pushParams{payload: tickleVersion, ttl: versionTTL, urgency: webpush.UrgencyLow, topic: versionTopic}
	}
)

// SubStore is the subscription persistence the notifier needs.
type SubStore interface {
	SubscriptionsFor(ctx context.Context, userID string) ([]store.PushSubscription, error)
	DeleteSubscriptionByEndpoint(ctx context.Context, endpoint string) error
}

// Sender signs + delivers a single Web Push request.
type Sender struct {
	vapidPublic  string
	vapidPrivate string
	subject      string // VAPID "sub": an https URL or mailto identifying the app
}

func NewSender(vapidPublic, vapidPrivate, subject string) *Sender {
	return &Sender{vapidPublic: vapidPublic, vapidPrivate: vapidPrivate, subject: subject}
}

// attempt makes a single delivery and reports the HTTP status, any Retry-After
// hint, and a transport error (status 0).
func (s *Sender) attempt(ctx context.Context, sub store.PushSubscription, p pushParams) (status int, retryAfter time.Duration, err error) {
	// webpush-go prepends "mailto:" to any non-https subscriber, so pass the bare
	// address (a leading "mailto:" would yield "mailto:mailto:…", which Apple
	// rejects as BadJwtToken). An https URL is left untouched.
	subscriber := strings.TrimPrefix(s.subject, "mailto:")
	// The Web Push "Topic" (RFC 8030, used to collapse a burst of tickles) must be a
	// URL-safe-base64 string of at most 32 bytes. Apple enforces this strictly and 400s
	// with {"reason":"BadWebPushTopic"} on a plain label like "ring-conn" (which isn't a
	// decodable base64 string); FCM is lenient, which is why only iOS push was failing.
	// Encode our short labels so collapsing works on every push service.
	topic := p.topic
	if topic != "" {
		topic = base64.RawURLEncoding.EncodeToString([]byte(topic))
	}
	resp, err := webpush.SendNotificationWithContext(ctx, p.payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber:      subscriber,
		VAPIDPublicKey:  s.vapidPublic,
		VAPIDPrivateKey: s.vapidPrivate,
		TTL:             p.ttl,
		Urgency:         p.urgency,
		Topic:           topic,
	})
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()
	if ra := resp.Header.Get("Retry-After"); ra != "" {
		retryAfter = parseRetryAfter(ra)
	}
	return resp.StatusCode, retryAfter, nil
}

// msgDebounceWindow folds a fast burst of messages to one recipient into at most a
// leading + one trailing tickle (spec 2020). Long enough to absorb rapid-fire
// sends, short enough that a burst's last message is announced promptly.
const msgDebounceWindow = 2 * time.Second

// Notifier sends a tickle to all of a user's subscriptions, pruning dead ones.
type Notifier struct {
	sender *Sender
	store  SubStore
	msgDeb *msgDebouncer
}

func NewNotifier(sender *Sender, st SubStore) *Notifier {
	n := &Notifier{sender: sender, store: st}
	// Trailing sends fire from a timer, long after the triggering request's context
	// is gone — Background is correct; per-delivery budgets still apply in deliver.
	n.msgDeb = newMsgDebouncer(msgDebounceWindow, func(userID string) {
		n.notify(context.Background(), userID, msgParams())
	})
	return n
}

// Notify pushes a content-free MESSAGE tickle to every subscription of userID
// (long-lived + collapsible, so an offline device still learns about it on wake).
// Debounced per recipient with a trailing edge (spec 2020): a fast burst yields at
// most a leading + one trailing tickle — safe because the service worker drains the
// WHOLE relay queue on any wake, so the trailing tickle covers every message of the
// burst. Safe to call in a goroutine; failures are logged, 404/410 endpoints are
// pruned, transient failures are retried. Only message tickles are debounced —
// NotifyCall/NotifyConn/etc. below stay immediate.
func (n *Notifier) Notify(ctx context.Context, userID string) { n.msgDeb.hit(userID) }

// NotifyCall pushes a content-free CALL tickle: short-lived (a stale ring is
// useless), high-urgency, and never collapsed, so it always wakes the device
// promptly for the live ring that follows over the WebSocket.
func (n *Notifier) NotifyCall(ctx context.Context, userID string) {
	n.notify(ctx, userID, callParams())
}

// NotifyConn pushes a content-free CONNECTION tickle for a friend-request
// lifecycle event (received / accepted / rejected). Long-ish lived + collapsible
// like a message, so an offline device still learns of it on wake; the SW then
// reconciles the actual state from GET /v1/connections. Carries no identity.
func (n *Notifier) NotifyConn(ctx context.Context, userID string) {
	n.notify(ctx, userID, connParams())
}

// NotifyPost pushes a content-free WALL-POST tickle (spec 0003): long-ish lived +
// collapsible like a message, so an offline device still learns of it on wake; the SW
// then shows a generic "new post" notification (closed) or nudges a live page to pull
// + show the rich in-app banner. Carries no identity. Since spec 1031 this tickle
// means NEW POST (or revocation) only — engagement rides NotifyPostActivity instead.
func (n *Notifier) NotifyPost(ctx context.Context, userID string) {
	n.notify(ctx, userID, postParams())
}

// postActivityTopic derives the per-post Web Push collapse topic. RFC 8030 caps a
// topic at 32 URL-safe base64 characters and a raw uuid is 36, so use a base64url
// SHA-256 prefix: bursts on ONE post collapse to a single wake per device while
// activity on different posts still wakes separately. The hash also keeps the raw
// post id out of the (push-service-visible) topic header — the payload itself is
// encrypted, the topic is not.
func postActivityTopic(postID string) string {
	sum := sha256.Sum256([]byte(postID))
	return "act-" + base64.RawURLEncoding.EncodeToString(sum[:])[:24]
}

// NotifyPostActivity wakes the POST OWNER's devices for engagement (a reaction or a
// comment by someone else) on their post — spec 1031's owner-only notification
// routing. The payload carries the post id (routing metadata the server already
// holds, sealed inside the per-subscription encrypted push envelope) so the SW can
// pull exactly that post's engagement and decide locally what to show; the reaction
// add-vs-remove flag stays sealed under K_post, so that judgement NEVER happens here.
func (n *Notifier) NotifyPostActivity(ctx context.Context, userID, postID string) {
	payload, err := json.Marshal(map[string]string{"t": "post-activity", "post": postID})
	if err != nil {
		return
	}
	n.notify(ctx, userID, pushParams{
		payload: payload,
		ttl:     postActivityTTL,
		urgency: webpush.UrgencyHigh,
		topic:   postActivityTopic(postID),
	})
}

// SendVersion delivers the content-free version-announcement tickle to ONE subscription
// (a device that is behind, at its local 09:00 — spec 1016). The SW renders the
// user-friendly "what's new" from the public /v1/config; only the {"t":"version"} marker
// crosses the push service. A dead endpoint is pruned; a panic is recovered so a bad send
// can't crash the sweep. Satisfies the push.VersionSender used by SweepVersionAnnouncements.
func (n *Notifier) SendVersion(ctx context.Context, sub store.PushSubscription) {
	defer recoverLog("push: send version")
	sctx, cancel := context.WithTimeout(ctx, sendBudget)
	defer cancel()
	n.deliver(sctx, sub, versionParams())
}

func (n *Notifier) notify(ctx context.Context, userID string, p pushParams) {
	// Notify/NotifyCall are documented as "safe to call in a goroutine"; honor that
	// literally - a panic in push delivery must never escape and crash the process.
	defer recoverLog("push: notify")
	subs, err := n.store.SubscriptionsFor(ctx, userID)
	if err != nil {
		slog.Error("push: load subscriptions", "err", err)
		return
	}
	// Fan out per subscription: a user's devices are delivered concurrently, each
	// under its own budget, so one slow endpoint never delays the others.
	var wg sync.WaitGroup
	for _, sub := range subs {
		wg.Add(1)
		go func(sub store.PushSubscription) {
			defer wg.Done()
			// Each fan-out goroutine is separate, so the recover above can't catch a
			// panic here - guard every one so a single bad subscription can't crash
			// the server (and never aborts the other devices' sends).
			defer recoverLog("push: deliver")
			sctx, cancel := context.WithTimeout(ctx, sendBudget)
			defer cancel()
			n.deliver(sctx, sub, p)
		}(sub)
	}
	wg.Wait()
}

// recoverLog recovers a panicking goroutine and logs it with a stack trace, so a
// bug in push delivery degrades to a missed notification instead of an outage.
func recoverLog(where string) {
	if r := recover(); r != nil {
		slog.Error(where+": panic recovered", "recover", r, "stack", string(debug.Stack()))
	}
}

// deliver sends to one subscription with bounded retry on transient failures and
// prunes a subscription the push service reports as gone (404/410).
func (n *Notifier) deliver(ctx context.Context, sub store.PushSubscription, p pushParams) {
	backoff := 500 * time.Millisecond
	for attempt := 0; ; attempt++ {
		status, retryAfter, err := n.sender.attempt(ctx, sub, p)
		switch {
		case err == nil && status < 300:
			slog.Info("push: delivered", "endpoint", endpointHost(sub.Endpoint))
			return
		case status == http.StatusNotFound || status == http.StatusGone:
			// Subscription is dead - stop trying to use it. Log a failed prune so a
			// dead endpoint that keeps failing every send is at least visible.
			if err := n.store.DeleteSubscriptionByEndpoint(ctx, sub.Endpoint); err != nil {
				slog.Warn("push: prune dead subscription failed", "err", err, "endpoint", endpointHost(sub.Endpoint))
			}
			return
		case attempt < maxRetries && retryable(status, err):
			wait := backoff
			if retryAfter > 0 {
				wait = retryAfter
			}
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return
			}
			backoff *= 2
			continue
		default:
			if err != nil {
				slog.Warn("push: send failed", "err", err, "endpoint", endpointHost(sub.Endpoint))
			} else {
				// e.g. Apple 403 BadJwtToken if the VAPID subject isn't a mailto:.
				slog.Warn("push: non-success status", "status", status, "endpoint", endpointHost(sub.Endpoint))
			}
			return
		}
	}
}

// retryable reports whether a failed attempt is worth retrying: any transport
// error, or a transient server-side status. 404/410 (handled separately) and
// other 4xx are permanent and not retried.
func retryable(status int, err error) bool {
	if err != nil {
		return true
	}
	switch status {
	case http.StatusTooManyRequests, // 429
		http.StatusInternalServerError, // 500
		http.StatusBadGateway,          // 502
		http.StatusServiceUnavailable,  // 503
		http.StatusGatewayTimeout:      // 504
		return true
	}
	return false
}

// parseRetryAfter reads a delta-seconds Retry-After header, capped so a
// misbehaving service can't pin a goroutine for the whole budget. HTTP-date form
// is uncommon for push services and treated as "no hint" (fall back to backoff).
func parseRetryAfter(v string) time.Duration {
	secs, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || secs < 0 {
		return 0
	}
	if secs > 8 {
		secs = 8
	}
	return time.Duration(secs) * time.Second
}

// endpointHost returns just the host of a push endpoint (avoids logging the
// full secret token in the path).
func endpointHost(endpoint string) string {
	if u, err := url.Parse(endpoint); err == nil {
		return u.Host
	}
	return "?"
}
