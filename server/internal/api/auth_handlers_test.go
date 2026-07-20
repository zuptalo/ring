package api

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"ring/server/internal/store"
	"ring/server/internal/ws"
)

// fakeStore is an in-memory AuthStore + BlockStore + DirectoryStore for handler
// tests (no database).
type fakeStore struct {
	mu        sync.Mutex
	byHash    map[string]string // hex(tokenHash) -> userID
	next      int
	badCodes  map[string]bool                 // codes that should fail to claim
	states    map[string]string               // userID -> state (absent => "unknown")
	blocks    map[string]map[string]bool      // blocker -> blocked -> true
	usernames map[string]string               // username_fold -> userID
	profiles  map[string]*store.DirectoryUser // userID -> directory profile
	relay     map[string][]relayRow           // recipient -> queued frames
	relaySeq  int64
	contacts  map[string][]string         // owner -> contact ids
	deliv     map[string][]store.Delivery // sender -> recorded deliveries
	seen      map[string][]store.Seen     // sender -> recorded seen receipts
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		byHash:    map[string]string{},
		badCodes:  map[string]bool{"USEDCODE": true},
		states:    map[string]string{},
		blocks:    map[string]map[string]bool{},
		usernames: map[string]string{},
		profiles:  map[string]*store.DirectoryUser{},
	}
}

func (f *fakeStore) Register(_ context.Context, code, username, usernameFold string, tokenHash []byte) (string, string, error) {
	if f.badCodes[code] {
		return "", "", store.ErrInviteInvalid
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, taken := f.usernames[usernameFold]; taken {
		return "", "", store.ErrUsernameTaken
	}
	f.next++
	// UUID-shaped so it passes the fetch route's id validation.
	uid := fmt.Sprintf("00000000-0000-0000-0000-%012d", f.next)
	f.byHash[hex.EncodeToString(tokenHash)] = uid
	f.usernames[usernameFold] = uid
	f.profiles[uid] = &store.DirectoryUser{ID: uid, Username: username, DisplayName: username}
	return uid, "", nil
}

// --- DirectoryStore ---

func (f *fakeStore) ListUsers(_ context.Context, viewer, query, _ string, _ int) ([]store.DirectoryUser, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	q := strings.ToLower(query)
	var out []store.DirectoryUser
	for uid, p := range f.profiles {
		if uid == viewer || p.Username == "" || f.states[uid] == "terminated" {
			continue
		}
		if f.blocks[viewer][uid] || f.blocks[uid][viewer] {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(p.Username), q) && !strings.Contains(strings.ToLower(p.DisplayName), q) {
			continue
		}
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Username) < strings.ToLower(out[j].Username)
	})
	return out, "", nil
}

func (f *fakeStore) GetUser(_ context.Context, viewer, target string) (*store.DirectoryUser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.profiles[target]
	if !ok || p.Username == "" || f.states[target] == "terminated" || f.blocks[viewer][target] || f.blocks[target][viewer] {
		return nil, store.ErrNoUser
	}
	cp := *p
	return &cp, nil
}

func (f *fakeStore) UserProfile(_ context.Context, uid string) (*store.DirectoryUser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.profiles[uid]
	if !ok {
		return nil, store.ErrNoUser
	}
	cp := *p
	return &cp, nil
}

func (f *fakeStore) UpdateProfile(_ context.Context, uid, displayName, avatar, about string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if p := f.profiles[uid]; p != nil {
		p.DisplayName, p.Avatar, p.About = displayName, avatar, about
	}
	return nil
}

func (f *fakeStore) ClaimUsername(_ context.Context, uid, username, usernameFold string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, taken := f.usernames[usernameFold]; taken {
		return store.ErrUsernameTaken
	}
	p := f.profiles[uid]
	if p == nil || p.Username != "" {
		return store.ErrUsernameAlreadySet
	}
	p.Username, p.DisplayName = username, username
	f.usernames[usernameFold] = uid
	return nil
}

func (f *fakeStore) UserIDForToken(_ context.Context, tokenHash []byte) (string, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	uid, ok := f.byHash[hex.EncodeToString(tokenHash)]
	return uid, ok, nil
}

func (f *fakeStore) AddToken(_ context.Context, userID string, tokenHash []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byHash[hex.EncodeToString(tokenHash)] = userID
	return nil
}
func (f *fakeStore) TouchToken(context.Context, []byte) error { return nil }
func (f *fakeStore) DeleteUser(_ context.Context, userID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.states[userID] = "terminated"
	return nil
}
func (f *fakeStore) UserStates(_ context.Context, ids []string) (map[string]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]string{}
	for _, id := range ids {
		if st, ok := f.states[id]; ok {
			out[id] = st
		} else if _, isUser := userIDsOf(f.byHash)[id]; isUser {
			out[id] = "active"
		}
	}
	return out, nil
}
func (f *fakeStore) Block(_ context.Context, blocker, blocked string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.blocks[blocker] == nil {
		f.blocks[blocker] = map[string]bool{}
	}
	f.blocks[blocker][blocked] = true
	return nil
}
func (f *fakeStore) Unblock(_ context.Context, blocker, blocked string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.blocks[blocker], blocked)
	return nil
}
func (f *fakeStore) ListBlocks(_ context.Context, blocker string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []string{}
	for id := range f.blocks[blocker] {
		out = append(out, id)
	}
	return out, nil
}
func (f *fakeStore) IsBlocked(_ context.Context, blocker, blocked string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.blocks[blocker][blocked], nil
}
func (f *fakeStore) Ping(context.Context) error { return nil }

// --- RelayStore (in-memory queue for relay-drain handler tests) ---

type relayRow struct {
	seq       int64
	sender    string
	msgID     string
	payload   []byte
	createdMs int64 // 0 unless a test sets it (spec 2043 relay status)
}

func (f *fakeStore) EnqueueRelay(_ context.Context, recipient, sender, msgID string, payload []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.relay == nil {
		f.relay = map[string][]relayRow{}
	}
	f.relaySeq++
	f.relay[recipient] = append(f.relay[recipient], relayRow{seq: f.relaySeq, sender: sender, msgID: msgID, payload: payload})
	return nil
}

func (f *fakeStore) OldestPendingForRecipient(_ context.Context, recipient string) (int64, int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rows := f.relay[recipient]
	var oldest int64
	for _, row := range rows {
		if row.createdMs > 0 && (oldest == 0 || row.createdMs < oldest) {
			oldest = row.createdMs
		}
	}
	return oldest, len(rows), nil
}

func (f *fakeStore) PendingForRecipient(_ context.Context, recipient string) ([]store.RelayItem, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []store.RelayItem{}
	for _, row := range f.relay[recipient] {
		out = append(out, store.RelayItem{Seq: row.seq, Sender: row.sender, MsgID: row.msgID, Payload: row.payload})
	}
	return out, nil
}

func (f *fakeStore) DeleteRelay(_ context.Context, recipient, msgID string) (string, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rows := f.relay[recipient]
	for i, row := range rows {
		if row.msgID == msgID {
			f.relay[recipient] = append(rows[:i:i], rows[i+1:]...)
			return row.sender, true, nil
		}
	}
	return "", false, nil
}

func (f *fakeStore) StampNotified(_ context.Context, recipient, msgID string) (string, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, row := range f.relay[recipient] {
		if row.msgID == msgID {
			return row.sender, true, nil // stamp is a no-op in the fake; frame stays queued
		}
	}
	return "", false, nil
}

func (f *fakeStore) RecordDelivery(_ context.Context, sender, recipient, msgID string) error {
	if sender == "" || recipient == "" || msgID == "" {
		return nil
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.deliv == nil {
		f.deliv = map[string][]store.Delivery{}
	}
	for _, d := range f.deliv[sender] {
		if d.MsgID == msgID && d.Recipient == recipient {
			return nil // idempotent
		}
	}
	f.deliv[sender] = append(f.deliv[sender], store.Delivery{MsgID: msgID, Recipient: recipient, DeliveredMs: 1})
	return nil
}
func (f *fakeStore) DeliveriesFor(_ context.Context, sender string, msgIDs []string) ([]store.Delivery, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	want := map[string]bool{}
	for _, id := range msgIDs {
		want[id] = true
	}
	var out []store.Delivery
	for _, d := range f.deliv[sender] {
		if want[d.MsgID] {
			out = append(out, d)
		}
	}
	return out, nil
}
func (f *fakeStore) RecordSeen(_ context.Context, sender, recipient, msgID string) error {
	if sender == "" || recipient == "" || msgID == "" {
		return nil
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.seen == nil {
		f.seen = map[string][]store.Seen{}
	}
	for _, s := range f.seen[sender] {
		if s.MsgID == msgID && s.Recipient == recipient {
			return nil // idempotent
		}
	}
	f.seen[sender] = append(f.seen[sender], store.Seen{MsgID: msgID, Recipient: recipient, SeenMs: 1})
	return nil
}
func (f *fakeStore) SeenFor(_ context.Context, sender string, msgIDs []string) ([]store.Seen, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	want := map[string]bool{}
	for _, id := range msgIDs {
		want[id] = true
	}
	var out []store.Seen
	for _, s := range f.seen[sender] {
		if want[s.MsgID] {
			out = append(out, s)
		}
	}
	return out, nil
}
func (f *fakeStore) SetPresencePrefs(context.Context, string, string, string) error { return nil }
func (f *fakeStore) TouchLastSeen(context.Context, string) error                    { return nil }
func (f *fakeStore) GetPresence(context.Context, []string) (map[string]store.PresenceInfo, error) {
	return map[string]store.PresenceInfo{}, nil
}
func (f *fakeStore) PresenceAudience(context.Context, string) (map[string]bool, error) {
	return map[string]bool{}, nil
}
func (f *fakeStore) ContactEdgesWith(context.Context, string, []string) (map[string]bool, error) {
	return map[string]bool{}, nil
}
func (f *fakeStore) SetPresenceOverrides(context.Context, string, map[string]string) error { return nil }
func (f *fakeStore) PresenceOverrides(context.Context, string) (map[string]string, error) {
	return map[string]string{}, nil
}
func (f *fakeStore) PresenceOverridesFor(context.Context, string, []string) (map[string]string, error) {
	return map[string]string{}, nil
}

// --- ContactStore ---

func (f *fakeStore) SetContacts(_ context.Context, owner string, ids []string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.contacts == nil {
		f.contacts = map[string][]string{}
	}
	f.contacts[owner] = append([]string(nil), ids...)
	return nil
}

// userIDsOf returns the set of registered user ids (values of the token map).
func userIDsOf(byHash map[string]string) map[string]struct{} {
	set := map[string]struct{}{}
	for _, uid := range byHash {
		set[uid] = struct{}{}
	}
	return set
}
func (f *fakeStore) CreateInvitation(context.Context, string) (string, error) {
	return "NEWCODE1", nil
}
func (f *fakeStore) ListInvitations(context.Context, string) ([]store.Invitation, error) {
	return nil, nil
}
func (f *fakeStore) ExtendInvitation(_ context.Context, _, code string) (time.Time, error) {
	if code == "MISSING1" {
		return time.Time{}, store.ErrInviteInvalid
	}
	return time.Now().Add(24 * time.Hour), nil
}
func (f *fakeStore) CancelInvitation(_ context.Context, _, code string) error {
	if code == "MISSING1" {
		return store.ErrInviteInvalid
	}
	return nil
}
func (f *fakeStore) MintInvite(context.Context) (string, error) {
	return "MINTED01", nil
}

func newTestServer() http.Handler {
	as := newFakeStore()
	return NewRouter(&Handlers{
		Store:          as,
		Directory:      as,
		Contacts:       as,
		Blocks:         as,
		Relay:          as,
		Hub:            ws.NewHub(),
		Keys:           newFakeKeysStore(),
		Blobs:          newFakeBlobStore(),
		Sync:           newFakeSyncStore(),
		Push:           newFakePushStore(),
		Invites:        as,
		PublicURL:      "https://ring.example",
		VapidPublicKey: "VAPID_PUB",
	}, []string{"http://localhost:5173"})
}

func TestRegisterThenMe(t *testing.T) {
	srv := newTestServer()

	// Register with a well-formed code.
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/register", strings.NewReader(`{"invitationCode":"RING01","username":"alice"}`))
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("register status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var reg registerResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &reg); err != nil {
		t.Fatalf("decode register response: %v", err)
	}
	if reg.Token == "" || reg.UserID == "" {
		t.Fatalf("missing token/userId: %+v", reg)
	}

	// The issued token should authenticate /v1/me to the same user.
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+reg.Token)
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("me status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var me map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &me)
	if me["userId"] != reg.UserID {
		t.Fatalf("me userId = %q, want %q", me["userId"], reg.UserID)
	}
}

func TestRegisterBadFormat(t *testing.T) {
	srv := newTestServer()
	for _, code := range []string{"", "abc", "way-too-long-code"} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/v1/register", strings.NewReader(`{"invitationCode":"`+code+`"}`))
		srv.ServeHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("code %q: status = %d, want 400", code, rr.Code)
		}
	}
}

func TestRegisterUnclaimableCode(t *testing.T) {
	srv := newTestServer()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/register", strings.NewReader(`{"invitationCode":"USEDCODE","username":"bob"}`))
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for used code", rr.Code)
	}
}

func TestProtectedRoutesRequireAuth(t *testing.T) {
	srv := newTestServer()

	// No token.
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/me", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("no-token status = %d, want 401", rr.Code)
	}

	// Garbage token.
	rr = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req.Header.Set("Authorization", "Bearer deadbeef")
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("bad-token status = %d, want 401", rr.Code)
	}
}

// TestDeleteMe: DELETE /v1/me deletes the account (and requires auth). Afterwards a
// peer sees the user as "terminated" via /v1/status — the Ghost signal clients use.
func TestDeleteMe(t *testing.T) {
	srv := newTestServer()
	aliceTok, aliceID := registerUser(t, srv)
	bobTok, _ := registerUser(t, srv)

	// Unauthenticated delete is rejected.
	rr := httptest.NewRecorder()
	srv.ServeHTTP(rr, httptest.NewRequest(http.MethodDelete, "/v1/me", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("no-token delete = %d, want 401", rr.Code)
	}

	// Alice deletes her own account → 204.
	rr = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+aliceTok)
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("delete = %d, want 204, body = %s", rr.Code, rr.Body.String())
	}

	// Bob now sees Alice as terminated.
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/v1/status", strings.NewReader(`{"ids":["`+aliceID+`"]}`))
	req.Header.Set("Authorization", "Bearer "+bobTok)
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Statuses map[string]string `json:"statuses"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if resp.Statuses[aliceID] != "terminated" {
		t.Fatalf("alice status = %q, want terminated", resp.Statuses[aliceID])
	}
}
