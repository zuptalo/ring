package push

import (
	"sync"
	"testing"
	"time"
)

// Spec 2020 — the per-user trailing-edge debounce for MESSAGE tickles. A fast burst
// must yield at most a leading and a trailing tickle (the SW drains the whole relay
// queue on any wake, so the trailing one covers every message of the burst), while an
// isolated message still tickles immediately and the LAST message of a burst is always
// covered (FR-001/003/004).

type sendLog struct {
	mu    sync.Mutex
	users []string
}

func (l *sendLog) add(u string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.users = append(l.users, u)
}

func (l *sendLog) count(u string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for _, x := range l.users {
		if x == u {
			n++
		}
	}
	return n
}

func TestDebounceIsolatedSendIsImmediate(t *testing.T) {
	log := &sendLog{}
	d := newMsgDebouncer(40*time.Millisecond, log.add)
	d.hit("alice")
	if got := log.count("alice"); got != 1 {
		t.Fatalf("isolated hit: want 1 immediate send, got %d", got)
	}
}

func TestDebounceBurstYieldsLeadingPlusOneTrailing(t *testing.T) {
	log := &sendLog{}
	d := newMsgDebouncer(40*time.Millisecond, log.add)
	for i := 0; i < 5; i++ {
		d.hit("alice")
		time.Sleep(2 * time.Millisecond)
	}
	if got := log.count("alice"); got != 1 {
		t.Fatalf("mid-burst: want only the leading send so far, got %d", got)
	}
	time.Sleep(80 * time.Millisecond) // past the window → the trailing send fired
	if got := log.count("alice"); got != 2 {
		t.Fatalf("after window: want leading+trailing = 2 sends, got %d", got)
	}
	time.Sleep(80 * time.Millisecond) // and nothing further
	if got := log.count("alice"); got != 2 {
		t.Fatalf("quiet period: want no further sends, got %d", got)
	}
}

func TestDebounceSpacedSendsAreAllImmediate(t *testing.T) {
	log := &sendLog{}
	d := newMsgDebouncer(30*time.Millisecond, log.add)
	d.hit("alice")
	time.Sleep(50 * time.Millisecond)
	d.hit("alice")
	if got := log.count("alice"); got != 2 {
		t.Fatalf("spaced hits: want 2 immediate sends, got %d", got)
	}
}

func TestDebounceUsersAreIndependent(t *testing.T) {
	log := &sendLog{}
	d := newMsgDebouncer(40*time.Millisecond, log.add)
	d.hit("alice")
	d.hit("alice") // schedules alice's trailing
	d.hit("bob")   // must be immediate — bob is not in alice's burst
	if got := log.count("bob"); got != 1 {
		t.Fatalf("bob's first hit: want immediate send, got %d", got)
	}
	time.Sleep(80 * time.Millisecond)
	if got := log.count("alice"); got != 2 {
		t.Fatalf("alice: want leading+trailing, got %d", got)
	}
	if got := log.count("bob"); got != 1 {
		t.Fatalf("bob: a single message must not gain a trailing send, got %d", got)
	}
}

func TestDebounceNewBurstAfterTrailingWorksAgain(t *testing.T) {
	log := &sendLog{}
	d := newMsgDebouncer(30*time.Millisecond, log.add)
	d.hit("alice")
	d.hit("alice")
	time.Sleep(60 * time.Millisecond) // trailing fired (2 total)
	time.Sleep(40 * time.Millisecond) // fully quiet past the window
	d.hit("alice")                    // next burst's leading send is immediate again
	if got := log.count("alice"); got != 3 {
		t.Fatalf("post-burst hit: want an immediate leading send (3 total), got %d", got)
	}
}
