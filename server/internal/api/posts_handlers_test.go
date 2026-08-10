package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"ring/server/internal/store"
	"ring/server/internal/ws"
)

// recordingNotifier records who was woken via NotifyPost (new post) and
// NotifyPostActivity (engagement on your post, spec 1031), so a test can assert which
// event actually wakes a device (vs. only syncing live) — and, for engagement, that
// ONLY the post owner is woken.
type recordingNotifier struct {
	mu       sync.Mutex
	posts    []string
	activity []string // "<userID>:<postID>" per NotifyPostActivity call
	previews []string // "<userID>:<postID>:<opaque>"
}

func (n *recordingNotifier) Notify(context.Context, string)                                     {}
func (n *recordingNotifier) NotifyFrame(context.Context, string, string, string)                {}
func (n *recordingNotifier) NotifyFramePreview(context.Context, string, string, string, []byte) {}
func (n *recordingNotifier) NotifyCall(context.Context, string)                                 {}
func (n *recordingNotifier) NotifyConn(context.Context, string)                                 {}
func (n *recordingNotifier) NotifyPost(_ context.Context, userID, _ string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.posts = append(n.posts, userID)
}
func (n *recordingNotifier) NotifyPostActivity(_ context.Context, userID, postID string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.activity = append(n.activity, userID+":"+postID)
}
func (n *recordingNotifier) NotifyPostActivityPreview(_ context.Context, userID, postID string, preview []byte) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.activity = append(n.activity, userID+":"+postID)
	n.previews = append(n.previews, userID+":"+postID+":"+string(preview))
}

// wokenSet is the set of users woken by NotifyPostActivity.
func (n *recordingNotifier) wokenSet() map[string]bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := map[string]bool{}
	for _, a := range n.activity {
		out[a[:strings.IndexByte(a, ':')]] = true
	}
	return out
}

func (n *recordingNotifier) postPushCount() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return len(n.posts)
}
func (n *recordingNotifier) pushedTo(userID string) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, u := range n.posts {
		if u == userID {
			return true
		}
	}
	return false
}
func (n *recordingNotifier) activityPushCount() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return len(n.activity)
}
func (n *recordingNotifier) activityPushedTo(userID, postID string) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, e := range n.activity {
		if e == userID+":"+postID {
			return true
		}
	}
	return false
}
func (n *recordingNotifier) reset() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.posts = nil
	n.activity = nil
	n.previews = nil
}

// fakePostConn is a ConnectionStore whose Connected() answers from an explicit
// friendship set, so post-audience authorization can be exercised.
type fakePostConn struct{ friends map[[2]string]bool }

func newFakePostConn() *fakePostConn { return &fakePostConn{friends: map[[2]string]bool{}} }
func (c *fakePostConn) befriend(a, b string) {
	c.friends[[2]string{a, b}] = true
	c.friends[[2]string{b, a}] = true
}
func (c *fakePostConn) Connected(_ context.Context, a, b string) (bool, error) {
	return c.friends[[2]string{a, b}], nil
}
func (c *fakePostConn) ConnectionState(context.Context, string, string) (string, error) {
	return "", nil
}
func (c *fakePostConn) RequestConnection(context.Context, string, string) (string, error) {
	return "pending", nil
}
func (c *fakePostConn) AcceptConnection(context.Context, string, string) error       { return nil }
func (c *fakePostConn) RejectConnection(context.Context, string, string, bool) error { return nil }
func (c *fakePostConn) WithdrawConnection(context.Context, string, string) error     { return nil }
func (c *fakePostConn) IncomingRequests(context.Context, string) ([]store.ConnectionReq, error) {
	return nil, nil
}
func (c *fakePostConn) OutgoingRequests(context.Context, string) ([]store.ConnectionReq, error) {
	return nil, nil
}
func (c *fakePostConn) AcceptedPeers(context.Context, string) ([]string, error) {
	return nil, nil
}
func (c *fakePostConn) OutgoingWithRecentAccepts(context.Context, string) ([]store.ConnectionReq, error) {
	return nil, nil
}

// fakePostStore is an in-memory PostStore for handler tests.
type fakePostStore struct {
	posts   map[string]store.NewPost
	eng     map[string][]store.PostEngagementRow
	views   map[string][]string
	revoked map[string][]string
}

func newFakePostStore() *fakePostStore {
	return &fakePostStore{
		posts:   map[string]store.NewPost{},
		eng:     map[string][]store.PostEngagementRow{},
		views:   map[string][]string{},
		revoked: map[string][]string{},
	}
}
func (f *fakePostStore) PostAuthor(_ context.Context, postID string) (string, error) {
	return f.posts[postID].Author, nil
}
func (f *fakePostStore) GameParticipants(_ context.Context, postID string) ([]string, error) {
	seen := map[string]bool{}
	var out []string
	for _, e := range f.eng[postID] {
		if e.Kind == "game" && !seen[e.Actor] {
			seen[e.Actor] = true
			out = append(out, e.Actor)
		}
	}
	return out, nil
}
func (f *fakePostStore) GameFollowers(_ context.Context, postID string) ([]string, error) {
	dead := map[string]bool{}
	for _, e := range f.eng[postID] {
		if e.Kind == "tombstone" {
			dead[e.Payload] = true
		}
	}
	seen := map[string]bool{}
	var out []string
	for _, e := range f.eng[postID] {
		if e.Kind == "follow" && !dead[e.ID] && !seen[e.Actor] {
			seen[e.Actor] = true
			out = append(out, e.Actor)
		}
	}
	return out, nil
}
func (f *fakePostStore) EngagementActor(_ context.Context, postID, engID string) (string, error) {
	for _, e := range f.eng[postID] {
		if e.ID == engID {
			return e.Actor, nil
		}
	}
	return "", nil
}
func (f *fakePostStore) RecordView(_ context.Context, postID, viewer string) error {
	for _, v := range f.views[postID] {
		if v == viewer {
			return nil
		}
	}
	f.views[postID] = append(f.views[postID], viewer)
	return nil
}
func (f *fakePostStore) ListViews(_ context.Context, postID string) ([]store.PostView, error) {
	out := make([]store.PostView, 0, len(f.views[postID]))
	for _, v := range f.views[postID] {
		out = append(out, store.PostView{Viewer: v})
	}
	return out, nil
}
func (f *fakePostStore) CreatePost(_ context.Context, p store.NewPost) error {
	// Mirror the real store's spec-2036 idempotency: same-author retry converges,
	// a different author's id is rejected.
	if prev, ok := f.posts[p.ID]; ok && prev.Author != p.Author {
		return store.ErrPostIDTaken
	}
	f.posts[p.ID] = p
	return nil
}
func (f *fakePostStore) CanSeePost(_ context.Context, postID, user string) (bool, error) {
	p, ok := f.posts[postID]
	if !ok {
		return false, nil
	}
	if p.Author == user {
		return true, nil
	}
	for _, e := range p.Envelopes {
		if e.Recipient == user {
			return true, nil
		}
	}
	return false, nil
}
func (f *fakePostStore) PostAudience(_ context.Context, postID string) ([]string, error) {
	p, ok := f.posts[postID]
	if !ok {
		return nil, nil
	}
	out := []string{p.Author}
	for _, e := range p.Envelopes {
		out = append(out, e.Recipient)
	}
	return out, nil
}
func (f *fakePostStore) SubmitEngagement(_ context.Context, postID, id, actor, kind, payload string) error {
	f.eng[postID] = append(f.eng[postID], store.PostEngagementRow{ID: id, Actor: actor, Kind: kind, Payload: payload})
	return nil
}

// seedEngagement adds a row with an explicit timestamp so paging tests can build
// deliberate ties on created_at (the reason the cursor is a pair, not a scalar).
func (f *fakePostStore) seedEngagement(postID, id, actor, kind string, createdMs int64) {
	f.eng[postID] = append(f.eng[postID], store.PostEngagementRow{
		ID: id, Actor: actor, Kind: kind, Payload: "x", CreatedMs: createdMs,
	})
}
func (f *fakePostStore) ListEngagement(_ context.Context, postID string, page store.EngagementPage) ([]store.PostEngagementRow, error) {
	// Mirror the real query: newest first by (createdMs, id), keyset-filtered.
	rows := append([]store.PostEngagementRow(nil), f.eng[postID]...)
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].CreatedMs != rows[j].CreatedMs {
			return rows[i].CreatedMs > rows[j].CreatedMs
		}
		return rows[i].ID > rows[j].ID
	})
	if page.BeforeID != "" {
		var kept []store.PostEngagementRow
		for _, r := range rows {
			if r.CreatedMs < page.BeforeMs || (r.CreatedMs == page.BeforeMs && r.ID < page.BeforeID) {
				kept = append(kept, r)
			}
		}
		rows = kept
	}
	limit := page.Limit
	if limit <= 0 {
		limit = store.DefaultEngagementLimit
	}
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}
func (f *fakePostStore) ListPosts(_ context.Context, recipient string, _ int64) ([]store.PostForRecipient, error) {
	var out []store.PostForRecipient
	for _, p := range f.posts {
		if p.Author == recipient {
			out = append(out, store.PostForRecipient{ID: p.ID, Author: p.Author, BlobID: p.BlobID, Size: p.Size})
			continue
		}
		for _, e := range p.Envelopes {
			if e.Recipient == recipient {
				out = append(out, store.PostForRecipient{ID: p.ID, Author: p.Author, BlobID: p.BlobID, WrappedKey: e.WrappedKey})
			}
		}
	}
	return out, nil
}
func (f *fakePostStore) DeletePost(_ context.Context, author, id string) ([]string, error) {
	p, ok := f.posts[id]
	if !ok || p.Author != author {
		return nil, nil
	}
	var recipients []string
	for _, e := range p.Envelopes {
		recipients = append(recipients, e.Recipient)
		f.revoked[e.Recipient] = append(f.revoked[e.Recipient], id) // durable deletion tombstone
	}
	delete(f.posts, id)
	return recipients, nil
}
func (f *fakePostStore) KeepAlive(_ context.Context, author, id string) (bool, error) {
	p, ok := f.posts[id]
	if !ok || p.Author != author {
		return false, nil
	}
	exp := time.Now().Add(time.Duration(p.TtlMs) * time.Millisecond)
	p.ExpiresAt = &exp
	f.posts[id] = p
	return true, nil
}
func (f *fakePostStore) AddEnvelopes(_ context.Context, author, postID string, envs []store.NewPostEnvelope) ([]string, error) {
	p, ok := f.posts[postID]
	if !ok || p.Author != author {
		return nil, nil
	}
	have := map[string]bool{}
	for _, e := range p.Envelopes {
		have[e.Recipient] = true
	}
	var added []string
	for _, e := range envs {
		if !have[e.Recipient] {
			p.Envelopes = append(p.Envelopes, e)
			have[e.Recipient] = true
			added = append(added, e.Recipient)
		}
		// Undo any tombstone for this recipient (broaden-back).
		if ids := f.revoked[e.Recipient]; len(ids) > 0 {
			kept := ids[:0:0]
			for _, rid := range ids {
				if rid != postID {
					kept = append(kept, rid)
				}
			}
			f.revoked[e.Recipient] = kept
		}
	}
	f.posts[postID] = p
	return added, nil
}
func (f *fakePostStore) RemovePostRecipient(_ context.Context, postID, author, recipient string) (bool, error) {
	p, ok := f.posts[postID]
	if !ok || p.Author != author {
		return false, nil
	}
	envs := p.Envelopes[:0:0]
	for _, e := range p.Envelopes {
		if e.Recipient != recipient {
			envs = append(envs, e)
		}
	}
	p.Envelopes = envs
	f.posts[postID] = p
	f.revoked[recipient] = append(f.revoked[recipient], postID)
	return true, nil
}
func (f *fakePostStore) ListRevocations(_ context.Context, recipient string) ([]string, error) {
	return f.revoked[recipient], nil
}

// Rate-limit counts (FR-008). The fake ignores the time window and counts everything
// the author/actor has done in the test — each test uses a fresh store, so this is
// enough to exercise the handler's cap logic.
func (f *fakePostStore) RecentPostCount(_ context.Context, author string, _ int) (int, error) {
	n := 0
	for _, p := range f.posts {
		if p.Author == author {
			n++
		}
	}
	return n, nil
}
func (f *fakePostStore) RecentEngagementCount(_ context.Context, actor string, _ int) (int, error) {
	n := 0
	for _, rows := range f.eng {
		for _, e := range rows {
			if e.Actor == actor {
				n++
			}
		}
	}
	return n, nil
}
func (f *fakePostStore) RecentCommentCount(_ context.Context, postID, actor string, _ int) (int, error) {
	n := 0
	for _, e := range f.eng[postID] {
		if e.Actor == actor && e.Kind == "comment" {
			n++
		}
	}
	return n, nil
}

func newPostTestServer(conn ConnectionStore, posts PostStore) http.Handler {
	return newPostTestServerN(conn, posts, nil)
}

// newPostTestServerN is newPostTestServer with an injectable Notifier, so a test can
// assert which engagement wakes an offline device (NotifyPost).
func newPostTestServerN(conn ConnectionStore, posts PostStore, notifier ws.Notifier) http.Handler {
	as := newFakeStore()
	return NewRouter(&Handlers{
		Store: as, Directory: as, Contacts: as, Blocks: as, Relay: as,
		Connections: conn, Posts: posts, Hub: ws.NewHub(), Notifier: notifier,
		Keys: newFakeKeysStore(), Blobs: newFakeBlobStore(), Sync: newFakeSyncStore(),
		Push: newFakePushStore(), Invites: as,
		PublicURL: "https://ring.example", VapidPublicKey: "VAPID_PUB",
	}, []string{"http://localhost:5173"})
}

const postID = "11111111-1111-1111-1111-111111111111"

func listPostIDs(t *testing.T, srv http.Handler, tok string) []string {
	t.Helper()
	rr := do(t, srv, http.MethodGet, "/v1/posts", tok, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Posts []struct {
			ID         string `json:"id"`
			WrappedKey string `json:"wrappedKey"`
		} `json:"posts"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	ids := make([]string, 0, len(resp.Posts))
	for _, p := range resp.Posts {
		ids = append(ids, p.ID)
	}
	return ids
}

// TestCreatePostRejectsNonFriendRecipient: a post addressed to someone who is not an
// accepted friend is rejected (FR-013).
func TestCreatePostRejectsNonFriendRecipient(t *testing.T) {
	srv := newPostTestServer(newFakePostConn(), newFakePostStore()) // no friendships
	tokA, _, _ := registerNamed(t, srv, "alice")
	_, bobID, _ := registerNamed(t, srv, "bob")

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("create-to-non-friend status = %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

// TestCreatePostDeliversToAudienceOnly: a friends post is delivered to its audience
// (with the wrapped key) and to no one else (FR-013, SC-002).
func TestCreatePostDeliversToAudienceOnly(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	tokC, _, _ := registerNamed(t, srv, "carol")
	conn.befriend(aliceID, bobID) // carol is NOT a friend

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201; body=%s", rr.Code, rr.Body.String())
	}

	if ids := listPostIDs(t, srv, tokB); len(ids) != 1 || ids[0] != postID {
		t.Errorf("bob (audience) sees %v, want [%s]", ids, postID)
	}
	if ids := listPostIDs(t, srv, tokC); len(ids) != 0 {
		t.Errorf("carol (non-audience) sees %v, want []", ids)
	}
	if ids := listPostIDs(t, srv, tokA); len(ids) != 1 || ids[0] != postID {
		t.Errorf("alice (author) sees %v, want [%s]", ids, postID)
	}
}

// TestEngagementAudienceOnly: only the post's audience (or author) may submit/read
// engagement; outsiders are rejected (FR-035/FR-036).
func TestEngagementAudienceOnly(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	tokC, _, _ := registerNamed(t, srv, "carol")
	conn.befriend(aliceID, bobID)

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d", rr.Code)
	}

	const engID = "22222222-2222-2222-2222-222222222222"
	eng := `{"id":"` + engID + `","kind":"reaction","payload":"SEALED"}`

	// Bob (audience) may react.
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, eng); rr.Code != http.StatusCreated {
		t.Fatalf("bob react status = %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
	// Carol (not audience) may NOT react or read.
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokC, eng); rr.Code != http.StatusForbidden {
		t.Errorf("carol react status = %d, want 403", rr.Code)
	}
	if rr := do(t, srv, http.MethodGet, "/v1/posts/"+postID+"/engagement", tokC, ""); rr.Code != http.StatusForbidden {
		t.Errorf("carol list status = %d, want 403", rr.Code)
	}
	// Alice (author) reads the engagement.
	rr := do(t, srv, http.MethodGet, "/v1/posts/"+postID+"/engagement", tokA, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("alice list status = %d, want 200", rr.Code)
	}
	var resp struct {
		Items []struct {
			Actor   string `json:"actor"`
			Payload string `json:"payload"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Items) != 1 || resp.Items[0].Actor != bobID || resp.Items[0].Payload != "SEALED" {
		t.Errorf("engagement = %+v, want one from bob with opaque payload", resp.Items)
	}
}

// TestCommentTombstoneAuthz: a commenter may remove their own comment and the post
// author may remove any, but a third audience member may not (FR-034).
func TestCommentTombstoneAuthz(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice") // post author
	tokB, bobID, _ := registerNamed(t, srv, "bob")     // commenter
	tokC, carolID, _ := registerNamed(t, srv, "carol") // other audience member
	conn.befriend(aliceID, bobID)
	conn.befriend(aliceID, carolID)

	post := `{"id":"` + postID + `","blobId":"cap1","envelopes":[` +
		`{"recipient":"` + bobID + `","wrappedKey":"WK"},{"recipient":"` + carolID + `","wrappedKey":"WK2"}]}`
	do(t, srv, http.MethodPost, "/v1/posts", tokA, post)

	const commentID = "33333333-3333-3333-3333-333333333333"
	do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB,
		`{"id":"`+commentID+`","kind":"comment","payload":"SEALED"}`)

	tomb := func(tok, id string) int {
		return do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tok,
			`{"id":"`+id+`","kind":"tombstone","target":"`+commentID+`"}`).Code
	}
	// Carol (neither the commenter nor the post author) may NOT remove Bob's comment.
	if code := tomb(tokC, "44444444-4444-4444-4444-444444444444"); code != http.StatusForbidden {
		t.Errorf("carol tombstone = %d, want 403", code)
	}
	// Bob (the commenter) may remove his own comment.
	if code := tomb(tokB, "55555555-5555-5555-5555-555555555555"); code != http.StatusCreated {
		t.Errorf("bob tombstone own = %d, want 201", code)
	}
	// Alice (the post author) may remove any comment.
	if code := tomb(tokA, "66666666-6666-6666-6666-666666666666"); code != http.StatusCreated {
		t.Errorf("alice tombstone any = %d, want 201", code)
	}
}

// TestPostViewsAuthorOnly: a viewer's view is recorded and only the author can read
// the view list (FR-037).
func TestPostViewsAuthorOnly(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	do(t, srv, http.MethodPost, "/v1/posts", tokA,
		`{"id":"`+postID+`","blobId":"cap1","envelopes":[{"recipient":"`+bobID+`","wrappedKey":"WK"}]}`)

	// Bob views the post.
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/view", tokB, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("view status = %d, want 204", rr.Code)
	}
	// Bob (not the author) cannot read the view list.
	if rr := do(t, srv, http.MethodGet, "/v1/posts/"+postID+"/views", tokB, ""); rr.Code != http.StatusForbidden {
		t.Errorf("bob list views = %d, want 403", rr.Code)
	}
	// Alice (the author) sees Bob in the list.
	rr := do(t, srv, http.MethodGet, "/v1/posts/"+postID+"/views", tokA, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("alice list views = %d, want 200", rr.Code)
	}
	var resp struct {
		Views []struct {
			Viewer string `json:"viewer"`
		} `json:"views"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp.Views) != 1 || resp.Views[0].Viewer != bobID {
		t.Errorf("views = %+v, want [bob]", resp.Views)
	}
}

// TestDeletePostAuthorOnly: only the author can delete; a non-author delete is a
// no-op (FR-015).
func TestDeletePostAuthorOnly(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body=%s", rr.Code, rr.Body.String())
	}

	// Bob (not the author) attempts delete → 204 but the post survives.
	if rr := do(t, srv, http.MethodDelete, "/v1/posts/"+postID, tokB, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("non-author delete status = %d, want 204", rr.Code)
	}
	if ids := listPostIDs(t, srv, tokB); len(ids) != 1 {
		t.Errorf("after non-author delete, bob sees %v, want the post to survive", ids)
	}

	// Alice (the author) deletes → gone.
	if rr := do(t, srv, http.MethodDelete, "/v1/posts/"+postID, tokA, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("author delete status = %d, want 204", rr.Code)
	}
	if ids := listPostIDs(t, srv, tokB); len(ids) != 0 {
		t.Errorf("after author delete, bob sees %v, want []", ids)
	}
}

// TestRemovePostRecipientAuthorOnly: dropping a recipient is author-only, removes the
// post from that recipient's feed, and surfaces in their `revoked` list so an offline
// device can prune it (the un-close-friend revocation path).
func TestKeepAlivePostAuthorOnly(t *testing.T) {
	conn := newFakePostConn()
	st := newFakePostStore()
	srv := newPostTestServer(conn, st)
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body=%s", rr.Code, rr.Body.String())
	}

	// Bob (not the author) → 404; nothing is extended.
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/keepalive", tokB, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("non-author keepalive status = %d, want 404", rr.Code)
	}
	// Alice (the author) → 204 and the expiry is (re)set.
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/keepalive", tokA, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("author keepalive status = %d, want 204", rr.Code)
	}
	if p := st.posts[postID]; p.ExpiresAt == nil {
		t.Errorf("keepalive did not set the post's expiry")
	}
}

func TestDeletePostTombstonesRecipients(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body=%s", rr.Code, rr.Body.String())
	}

	// Alice deletes her post → 204.
	if rr := do(t, srv, http.MethodDelete, "/v1/posts/"+postID, tokA, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", rr.Code)
	}

	// Bob no longer sees it, AND it surfaces in his `revoked` set so an OFFLINE device prunes
	// its local copy on next sync (the durable tombstone, beyond the live websocket push).
	rr := do(t, srv, http.MethodGet, "/v1/posts", tokB, "")
	var resp struct {
		Posts   []json.RawMessage `json:"posts"`
		Revoked []string          `json:"revoked"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(resp.Posts) != 0 {
		t.Errorf("after delete, bob still sees %d posts, want 0", len(resp.Posts))
	}
	if len(resp.Revoked) != 1 || resp.Revoked[0] != postID {
		t.Errorf("revoked = %v, want [%s]", resp.Revoked, postID)
	}
}

func TestAddPostEnvelopesBroadensAudience(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	_, bobID, _ := registerNamed(t, srv, "bob")
	tokC, carolID, _ := registerNamed(t, srv, "carol")
	conn.befriend(aliceID, bobID)
	conn.befriend(aliceID, carolID)

	// Alice posts to ONLY bob (a "close friends" audience).
	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WKb"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body=%s", rr.Code, rr.Body.String())
	}
	if ids := listPostIDs(t, srv, tokC); len(ids) != 0 {
		t.Fatalf("carol sees %v before broaden, want []", ids)
	}

	// Alice broadens the audience to include carol (re-wrapped envelope).
	add := `{"envelopes":[{"recipient":"` + carolID + `","wrappedKey":"WKc"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/envelopes", tokA, add); rr.Code != http.StatusNoContent {
		t.Fatalf("add envelopes status = %d; body=%s", rr.Code, rr.Body.String())
	}
	if ids := listPostIDs(t, srv, tokC); len(ids) != 1 || ids[0] != postID {
		t.Errorf("carol sees %v after broaden, want [%s]", ids, postID)
	}

	// A non-friend recipient is rejected (same audience rule as createPost).
	_, eveID, _ := registerNamed(t, srv, "eve")
	bad := `{"envelopes":[{"recipient":"` + eveID + `","wrappedKey":"WKe"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/envelopes", tokA, bad); rr.Code != http.StatusForbidden {
		t.Errorf("add non-friend status = %d, want 403", rr.Code)
	}
}

func TestRemovePostRecipientAuthorOnly(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body=%s", rr.Code, rr.Body.String())
	}

	// Bob (not the author) cannot revoke his own membership for someone else's post.
	if rr := do(t, srv, http.MethodDelete, "/v1/posts/"+postID+"/recipient/"+aliceID, tokB, ""); rr.Code != http.StatusForbidden {
		t.Fatalf("non-author revoke status = %d, want 403", rr.Code)
	}

	// Alice (the author) removes Bob from the audience → 204, and Bob no longer sees it.
	if rr := do(t, srv, http.MethodDelete, "/v1/posts/"+postID+"/recipient/"+bobID, tokA, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("author revoke status = %d, want 204", rr.Code)
	}
	if ids := listPostIDs(t, srv, tokB); len(ids) != 0 {
		t.Errorf("after revoke, bob sees %v, want []", ids)
	}

	// The revocation surfaces in Bob's list response so an offline device prunes it.
	rr := do(t, srv, http.MethodGet, "/v1/posts", tokB, "")
	var resp struct {
		Revoked []string `json:"revoked"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(resp.Revoked) != 1 || resp.Revoked[0] != postID {
		t.Errorf("revoked = %v, want [%s]", resp.Revoked, postID)
	}
}

// pid builds a distinct valid UUID for the i-th post/engagement in a loop.
func pid(prefix int, i int) string {
	return fmt.Sprintf("%08x-%04x-1111-1111-111111111111", prefix, i)
}

// TestCreatePostRateLimited: FR-008 per-author post-rate limit — once an author exceeds
// maxPostsPerWindow recent posts, further creates are rejected with 429.
func TestCreatePostRateLimited(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	_, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	for i := 0; i < maxPostsPerWindow; i++ {
		body := `{"id":"` + pid(1, i) + `","blobId":"cap","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
		if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
			t.Fatalf("post %d status = %d, want 201; body=%s", i, rr.Code, rr.Body.String())
		}
	}
	// One past the cap → throttled.
	body := `{"id":"` + pid(1, maxPostsPerWindow) + `","blobId":"cap","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusTooManyRequests {
		t.Fatalf("over-cap post status = %d, want 429; body=%s", rr.Code, rr.Body.String())
	}
}

// TestEngagementRateLimited: FR-008 per-user engagement-rate limit — once an actor
// exceeds maxEngagementsPerWindow recent items, further engagement is rejected with 429.
func TestEngagementRateLimited(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	body := `{"id":"` + postID + `","blobId":"cap","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d", rr.Code)
	}
	for i := 0; i < maxEngagementsPerWindow; i++ {
		eng := `{"id":"` + pid(2, i) + `","kind":"reaction","payload":"SEALED"}`
		if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, eng); rr.Code != http.StatusCreated {
			t.Fatalf("engagement %d status = %d, want 201; body=%s", i, rr.Code, rr.Body.String())
		}
	}
	eng := `{"id":"` + pid(2, maxEngagementsPerWindow) + `","kind":"reaction","payload":"SEALED"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, eng); rr.Code != http.StatusTooManyRequests {
		t.Fatalf("over-cap engagement status = %d, want 429; body=%s", rr.Code, rr.Body.String())
	}
}

// TestCommentRateLimitedPerPost: FR-008 per-post comment-rate limit — one actor can add
// at most maxCommentsPerPostWindow comments to a single post per window.
func TestCommentRateLimitedPerPost(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	body := `{"id":"` + postID + `","blobId":"cap","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d", rr.Code)
	}
	for i := 0; i < maxCommentsPerPostWindow; i++ {
		eng := `{"id":"` + pid(3, i) + `","kind":"comment","payload":"SEALED"}`
		if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, eng); rr.Code != http.StatusCreated {
			t.Fatalf("comment %d status = %d, want 201; body=%s", i, rr.Code, rr.Body.String())
		}
	}
	eng := `{"id":"` + pid(3, maxCommentsPerPostWindow) + `","kind":"comment","payload":"SEALED"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, eng); rr.Code != http.StatusTooManyRequests {
		t.Fatalf("over-cap comment status = %d, want 429; body=%s", rr.Code, rr.Body.String())
	}
}

// TestEngagementPushesOwnerOnly (spec 1031): engagement wakes ONLY the post owner —
// a reaction or comment by someone else fires exactly one NotifyPostActivity to the
// author; the rest of the audience, the actor, and tombstones never wake anyone. The
// legacy audience-wide NotifyPost for comments is gone; NotifyPost stays new-post-only.
func TestEngagementPushesOwnerOnly(t *testing.T) {
	conn := newFakePostConn()
	notif := &recordingNotifier{}
	srv := newPostTestServerN(conn, newFakePostStore(), notif)
	tokA, aliceID, _ := registerNamed(t, srv, "alice") // post author
	tokB, bobID, _ := registerNamed(t, srv, "bob")     // engaging friend
	_, carolID, _ := registerNamed(t, srv, "carol")    // bystander in the audience
	conn.befriend(aliceID, bobID)
	conn.befriend(aliceID, carolID)

	body := `{"id":"` + postID + `","blobId":"cap","envelopes":[` +
		`{"recipient":"` + bobID + `","wrappedKey":"WKb"},{"recipient":"` + carolID + `","wrappedKey":"WKc"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body=%s", rr.Code, rr.Body.String())
	}
	// A brand-new post still pushes its audience via the post tickle (unchanged).
	if !notif.pushedTo(bobID) || !notif.pushedTo(carolID) {
		t.Fatalf("expected the new post to push the audience (bob + carol)")
	}
	notif.reset()

	// Bob reacts → exactly one activity push, to the author. Nobody else; no post tickle.
	react := `{"id":"22222222-2222-2222-2222-222222222222","kind":"reaction","payload":"SEALED"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, react); rr.Code != http.StatusCreated {
		t.Fatalf("react status = %d; body=%s", rr.Code, rr.Body.String())
	}
	if !notif.activityPushedTo(aliceID, postID) {
		t.Errorf("expected the reaction to push the post author (alice)")
	}
	if n := notif.activityPushCount(); n != 1 {
		t.Errorf("reaction fired %d activity pushes; want exactly 1 (the author)", n)
	}
	if n := notif.postPushCount(); n != 0 {
		t.Errorf("reaction fired %d post tickles; want 0 (engagement never rides the post tickle)", n)
	}
	notif.reset()

	// Bob comments → same: only the author is woken; carol (audience) and bob never are.
	comment := `{"id":"33333333-3333-3333-3333-333333333333","kind":"comment","payload":"SEALED"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, comment); rr.Code != http.StatusCreated {
		t.Fatalf("comment status = %d; body=%s", rr.Code, rr.Body.String())
	}
	if !notif.activityPushedTo(aliceID, postID) {
		t.Errorf("expected the comment to push the post author (alice)")
	}
	if notif.activityPushedTo(bobID, postID) || notif.activityPushedTo(carolID, postID) {
		t.Errorf("a comment must never push the actor (bob) or a bystander (carol)")
	}
	if n := notif.activityPushCount(); n != 1 {
		t.Errorf("comment fired %d activity pushes; want exactly 1 (the author)", n)
	}
	if n := notif.postPushCount(); n != 0 {
		t.Errorf("comment fired %d post tickles; want 0 (the audience-wide comment push is removed)", n)
	}
	notif.reset()

	// Bob tombstones his comment → removals never wake anyone.
	tomb := `{"id":"44444444-4444-4444-4444-444444444444","kind":"tombstone","target":"33333333-3333-3333-3333-333333333333"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, tomb); rr.Code != http.StatusCreated {
		t.Fatalf("tombstone status = %d; body=%s", rr.Code, rr.Body.String())
	}
	if n := notif.activityPushCount() + notif.postPushCount(); n != 0 {
		t.Errorf("tombstone fired %d pushes; want 0", n)
	}

	// Alice engages her own post → self-actions never wake anyone (not even alice).
	selfReact := `{"id":"55555555-5555-5555-5555-555555555555","kind":"reaction","payload":"SEALED"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokA, selfReact); rr.Code != http.StatusCreated {
		t.Fatalf("self react status = %d; body=%s", rr.Code, rr.Body.String())
	}
	selfComment := `{"id":"66666666-6666-6666-6666-666666666666","kind":"comment","payload":"SEALED"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokA, selfComment); rr.Code != http.StatusCreated {
		t.Fatalf("self comment status = %d; body=%s", rr.Code, rr.Body.String())
	}
	if n := notif.activityPushCount() + notif.postPushCount(); n != 0 {
		t.Errorf("self-engagement fired %d pushes; want 0", n)
	}
}

// Spec 1035 (amending 0009): game engagement pushes reach the PARTICIPANTS
// only — the post author plus everyone who has previously written a game
// engagement on the post — never the passive audience. A spectator's one
// game-related push stays the challenge post itself; a Battleship game no
// longer wakes every audience device per move. Routing uses only metadata the
// server already holds (kind + actor); payloads stay sealed.
func TestGameEngagementPushesAudience(t *testing.T) {
	conn := newFakePostConn()
	notif := &recordingNotifier{}
	srv := newPostTestServerN(conn, newFakePostStore(), notif)
	tokA, aliceID, _ := registerNamed(t, srv, "alice") // challenge post author (player 0)
	tokB, bobID, _ := registerNamed(t, srv, "bob")     // first accepter (player 1)
	tokC, carolID, _ := registerNamed(t, srv, "carol") // audience observer
	conn.befriend(aliceID, bobID)
	conn.befriend(aliceID, carolID)

	body := `{"id":"` + postID + `","blobId":"cap","envelopes":[` +
		`{"recipient":"` + bobID + `","wrappedKey":"WKb"},{"recipient":"` + carolID + `","wrappedKey":"WKc"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body=%s", rr.Code, rr.Body.String())
	}
	notif.reset()

	// Bob accepts the challenge (kind "game") → the kind is valid, stored
	// opaquely, and the push goes to alice (the author) ONLY — carol is a
	// spectator and must not be woken (spec 1035).
	acceptEng := `{"id":"77777777-7777-7777-7777-777777777777","kind":"game","payload":"SEALED"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, acceptEng); rr.Code != http.StatusCreated {
		t.Fatalf("game engagement status = %d; body=%s (kind must be accepted)", rr.Code, rr.Body.String())
	}
	if !notif.activityPushedTo(aliceID, postID) {
		t.Errorf("game engagement must push the author (alice)")
	}
	if notif.activityPushedTo(carolID, postID) {
		t.Errorf("game engagement must NOT push a passive spectator (carol), spec 1035")
	}
	if notif.activityPushedTo(bobID, postID) {
		t.Errorf("game engagement must never push the actor (bob)")
	}
	if n := notif.activityPushCount(); n != 1 {
		t.Errorf("game engagement fired %d activity pushes; want exactly 1 (the author)", n)
	}
	notif.reset()

	// The AUTHOR moves (alice is player 0): unlike self-reactions, her game
	// engagement still wakes her OPPONENT — it is bob's turn now. Bob is a
	// participant because he has a prior game engagement on the post; carol
	// still is not.
	moveEng := `{"id":"88888888-8888-8888-8888-888888888888","kind":"game","payload":"SEALED2"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokA, moveEng); rr.Code != http.StatusCreated {
		t.Fatalf("author game engagement status = %d; body=%s", rr.Code, rr.Body.String())
	}
	if !notif.activityPushedTo(bobID, postID) {
		t.Errorf("the author's game engagement must push her opponent (bob)")
	}
	if notif.activityPushedTo(carolID, postID) {
		t.Errorf("a move must NOT push the spectator (carol), spec 1035")
	}
	if notif.activityPushedTo(aliceID, postID) {
		t.Errorf("the author's own game engagement must not push the author")
	}
	if n := notif.activityPushCount(); n != 1 {
		t.Errorf("move fired %d activity pushes; want exactly 1 (the opponent)", n)
	}
	notif.reset()

	// Spec 1036: carol FOLLOWS the challenge (content-free opt-in). A follow
	// pushes NOBODY — not even the author.
	followEng := `{"id":"aaaaaaa1-1111-1111-1111-111111111111","kind":"follow","payload":"SEALED-F"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokC, followEng); rr.Code != http.StatusCreated {
		t.Fatalf("follow engagement status = %d; body=%s (kind must be accepted)", rr.Code, rr.Body.String())
	}
	if n := notif.activityPushCount(); n != 0 {
		t.Errorf("a follow fired %d pushes; want 0", n)
	}
	notif.reset()

	// A move STILL doesn't push the follower — only the result does (spec 1036).
	moveEng2 := `{"id":"aaaaaaa2-2222-2222-2222-222222222222","kind":"game","payload":"SEALED3"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, moveEng2); rr.Code != http.StatusCreated {
		t.Fatalf("move status = %d; body=%s", rr.Code, rr.Body.String())
	}
	if notif.activityPushedTo(carolID, postID) {
		t.Errorf("a mid-game move must NOT push a follower (carol)")
	}
	notif.reset()

	// GAME OVER (spec 1036): the final mover's device announces the end; the push
	// fans to the other participant AND the followers — never the actor.
	overEng := `{"id":"aaaaaaa3-3333-3333-3333-333333333333","kind":"gameover","payload":"SEALED-O"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokA, overEng); rr.Code != http.StatusCreated {
		t.Fatalf("gameover status = %d; body=%s (kind must be accepted)", rr.Code, rr.Body.String())
	}
	if !notif.activityPushedTo(bobID, postID) || !notif.activityPushedTo(carolID, postID) {
		t.Errorf("gameover must push the opponent (bob) AND the follower (carol)")
	}
	if notif.activityPushedTo(aliceID, postID) {
		t.Errorf("gameover must not push the actor (alice)")
	}
	notif.reset()

	// Carol UNFOLLOWS (tombstones her follow): a second gameover no longer
	// reaches her.
	unfollow := `{"id":"aaaaaaa4-4444-4444-4444-444444444444","kind":"tombstone","target":"aaaaaaa1-1111-1111-1111-111111111111"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokC, unfollow); rr.Code != http.StatusCreated {
		t.Fatalf("unfollow status = %d; body=%s", rr.Code, rr.Body.String())
	}
	notif.reset()
	overEng2 := `{"id":"aaaaaaa5-5555-5555-5555-555555555555","kind":"gameover","payload":"SEALED-O2"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokA, overEng2); rr.Code != http.StatusCreated {
		t.Fatalf("gameover2 status = %d; body=%s", rr.Code, rr.Body.String())
	}
	if notif.activityPushedTo(carolID, postID) {
		t.Errorf("an unfollowed (tombstoned) spectator must not be pushed on gameover")
	}
	if !notif.activityPushedTo(bobID, postID) {
		t.Errorf("gameover must still push the opponent after an unrelated unfollow")
	}
	notif.reset()

	// Reactions keep their spec-1031 author-only behavior — the game fan-out
	// must not widen anything else.
	react := `{"id":"99999999-9999-9999-9999-999999999999","kind":"reaction","payload":"SEALED"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, react); rr.Code != http.StatusCreated {
		t.Fatalf("react status = %d; body=%s", rr.Code, rr.Body.String())
	}
	if n := notif.activityPushCount(); n != 1 || !notif.activityPushedTo(aliceID, postID) {
		t.Errorf("reaction fired %d pushes; want exactly 1, to the author", n)
	}

	// The stored record round-trips opaquely with its kind.
	rr := do(t, srv, http.MethodGet, "/v1/posts/"+postID+"/engagement", tokA, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d", rr.Code)
	}
	var listedWrap struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &listedWrap); err != nil {
		t.Fatalf("list decode: %v", err)
	}
	var games, follows, overs int
	for _, e := range listedWrap.Items {
		switch e["kind"] {
		case "game":
			games++
			if e["payload"] != "SEALED" && e["payload"] != "SEALED2" && e["payload"] != "SEALED3" {
				t.Errorf("game payload not stored opaquely: %v", e["payload"])
			}
		case "follow":
			follows++
		case "gameover":
			overs++
		}
	}
	if games != 3 || follows != 1 || overs != 2 {
		t.Errorf("listed games/follows/overs = %d/%d/%d; want 3/1/2", games, follows, overs)
	}
}

// Spec 2036: the outbox worker retries with the SAME client-minted id after a lost
// response — the same-author retry must converge (201), never surface as a 500.
func TestCreatePostIdempotentRetry(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	_, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("first create status = %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Errorf("same-author retry status = %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
}

// A DIFFERENT author reusing an existing post id is squatting, not a retry → 403.
func TestCreatePostRejectsForeignIDReuse(t *testing.T) {
	conn := newFakePostConn()
	srv := newPostTestServer(conn, newFakePostStore())
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("first create status = %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
	bodyB := `{"id":"` + postID + `","blobId":"cap2","envelopes":[{"recipient":"` + aliceID + `","wrappedKey":"WK"}]}`
	conn.befriend(bobID, aliceID)
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokB, bodyB); rr.Code != http.StatusForbidden {
		t.Errorf("foreign id reuse status = %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

/* ---- spec 1065: bounded engagement paging ---- */

// engagementFixture: a post Alice authored and Bob can see, seeded with `n`
// engagement rows. Rows deliberately SHARE timestamps in pairs, because that is
// exactly what a cursor on created_at alone gets wrong — it either skips a row
// or serves it twice at the seam.
func engagementFixture(t *testing.T, n int) (http.Handler, *fakePostStore, string, string) {
	t.Helper()
	conn := newFakePostConn()
	fp := newFakePostStore()
	srv := newPostTestServer(conn, fp)
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	_, bobID, _ := registerNamed(t, srv, "bob")
	conn.befriend(aliceID, bobID)

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d", rr.Code)
	}
	for i := 0; i < n; i++ {
		fp.seedEngagement(postID, fmt.Sprintf("%08d-0000-0000-0000-000000000000", i), aliceID, "reaction", int64(1_000_000+(i/2)*10))
	}
	return srv, fp, tokA, bobID
}

type engPage struct {
	Items []struct {
		ID string `json:"id"`
	} `json:"items"`
	Cursor  string `json:"cursor"`
	HasMore bool   `json:"hasMore"`
}

func getEngagement(t *testing.T, srv http.Handler, tok, query string) (int, engPage) {
	t.Helper()
	url := "/v1/posts/" + postID + "/engagement"
	if query != "" {
		url += "?" + query
	}
	rr := do(t, srv, http.MethodGet, url, tok, "")
	var p engPage
	if rr.Code == http.StatusOK {
		if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return rr.Code, p
}

// A caller that sends neither parameter must still work — paging is additive.
func TestListEngagementDefaultsStayCompatible(t *testing.T) {
	srv, _, tokA, _ := engagementFixture(t, 5)
	code, p := getEngagement(t, srv, tokA, "")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if len(p.Items) != 5 {
		t.Fatalf("items = %d, want 5", len(p.Items))
	}
	if p.HasMore {
		t.Errorf("hasMore = true, want false for a short page")
	}
}

func TestListEngagementLimitCapsThePage(t *testing.T) {
	srv, _, tokA, _ := engagementFixture(t, 10)
	code, p := getEngagement(t, srv, tokA, "limit=4")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if len(p.Items) != 4 {
		t.Fatalf("items = %d, want 4", len(p.Items))
	}
	if !p.HasMore || p.Cursor == "" {
		t.Errorf("hasMore=%v cursor=%q — a full page must offer a way to continue", p.HasMore, p.Cursor)
	}
}

func TestListEngagementExactFinalPageDoesNotClaimMore(t *testing.T) {
	srv, _, tokA, _ := engagementFixture(t, 8)
	_, first := getEngagement(t, srv, tokA, "limit=4")
	if !first.HasMore || first.Cursor == "" {
		t.Fatal("first page must continue")
	}
	_, last := getEngagement(t, srv, tokA, "limit=4&before="+first.Cursor)
	if len(last.Items) != 4 || last.HasMore || last.Cursor != "" {
		t.Fatalf("exact final page = %d items, hasMore=%v cursor=%q", len(last.Items), last.HasMore, last.Cursor)
	}
}

// The regression this whole keyset design exists for: walking the cursor must
// visit every row exactly once, including across created_at ties.
func TestListEngagementCursorWalksBackWithoutGapsOrRepeats(t *testing.T) {
	const total, page = 10, 3
	srv, _, tokA, _ := engagementFixture(t, total)

	seen := map[string]bool{}
	query := "limit=" + strconv.Itoa(page)
	for i := 0; i < 10; i++ { // bounded so a broken cursor fails rather than hangs
		code, p := getEngagement(t, srv, tokA, query)
		if code != http.StatusOK {
			t.Fatalf("page %d: status = %d", i, code)
		}
		for _, it := range p.Items {
			if seen[it.ID] {
				t.Fatalf("row %s served twice — the cursor repeats across a created_at tie", it.ID)
			}
			seen[it.ID] = true
		}
		if !p.HasMore {
			break
		}
		query = "limit=" + strconv.Itoa(page) + "&before=" + p.Cursor
	}
	if len(seen) != total {
		t.Fatalf("walked %d rows, want %d — the cursor skipped rows at a timestamp tie", len(seen), total)
	}
}

func TestListEngagementRejectsBadPagingParams(t *testing.T) {
	srv, _, tokA, _ := engagementFixture(t, 3)
	for _, q := range []string{
		"limit=0", "limit=-1", "limit=201", "limit=abc",
		"before=nonsense", "before=123", "before=.abc", "before=abc.not-a-uuid",
	} {
		if code, _ := getEngagement(t, srv, tokA, q); code != http.StatusBadRequest {
			t.Errorf("query %q: status = %d, want 400", q, code)
		}
	}
}

// Paging must not widen who can read a post's engagement.
func TestListEngagementStillRefusesOutsiders(t *testing.T) {
	conn := newFakePostConn()
	fp := newFakePostStore()
	srv := newPostTestServer(conn, fp)
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	_, bobID, _ := registerNamed(t, srv, "bob")
	tokC, _, _ := registerNamed(t, srv, "carol")
	conn.befriend(aliceID, bobID)
	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[{"recipient":"` + bobID + `","wrappedKey":"WK"}]}`
	do(t, srv, http.MethodPost, "/v1/posts", tokA, body)

	if code, _ := getEngagement(t, srv, tokC, "limit=2"); code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", code)
	}
}

/* ---- spec 1065 FR-031b: the wake hint ---- */

// notifyFixture: Alice's post with Bob and Carol in the audience, Dave outside it.
func notifyFixture(t *testing.T) (http.Handler, *recordingNotifier, string, string, string, string, string, string) {
	t.Helper()
	conn := newFakePostConn()
	fp := newFakePostStore()
	notif := &recordingNotifier{}
	srv := newPostTestServerN(conn, fp, notif)
	tokA, aliceID, _ := registerNamed(t, srv, "alice")
	tokB, bobID, _ := registerNamed(t, srv, "bob")
	_, carolID, _ := registerNamed(t, srv, "carol")
	tokD, daveID, _ := registerNamed(t, srv, "dave")
	conn.befriend(aliceID, bobID)
	conn.befriend(aliceID, carolID)

	body := `{"id":"` + postID + `","blobId":"cap1","envelopes":[` +
		`{"recipient":"` + bobID + `","wrappedKey":"WK"},` +
		`{"recipient":"` + carolID + `","wrappedKey":"WK"}]}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts", tokA, body); rr.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body=%s", rr.Code, rr.Body.String())
	}
	notif.reset()
	return srv, notif, tokB, tokD, aliceID, bobID, carolID, daveID
}

func comment(id, notify string) string {
	n := ""
	if notify != "" {
		n = `,"notify":[` + notify + `]`
	}
	return `{"id":"` + id + `","kind":"comment","payload":"SEALED"` + n + `}`
}

// A reply wakes the post owner AND the person it answers, and nobody else.
func TestNotifyWakesOwnerAndTheAnswered(t *testing.T) {
	srv, notif, tokB, _, aliceID, _, carolID, _ := notifyFixture(t)
	const engID = "33333333-3333-3333-3333-333333333333"
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, comment(engID, `"`+carolID+`"`)); rr.Code != http.StatusCreated {
		t.Fatalf("status = %d; body=%s", rr.Code, rr.Body.String())
	}
	got := notif.wokenSet()
	want := map[string]bool{aliceID: true, carolID: true}
	if len(got) != len(want) {
		t.Fatalf("woke %v, want exactly %v", got, want)
	}
	for u := range want {
		if !got[u] {
			t.Errorf("%s was not woken", u)
		}
	}
}

// Naming someone outside the audience is refused, and wakes nobody.
func TestNotifyRefusesOutsiders(t *testing.T) {
	srv, notif, tokB, _, _, _, _, daveID := notifyFixture(t)
	const engID = "44444444-4444-4444-4444-444444444444"
	rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, comment(engID, `"`+daveID+`"`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
	if len(notif.wokenSet()) != 0 {
		t.Errorf("a rejected hint still woke %v", notif.wokenSet())
	}
}

// The hint cannot become a broadcast primitive.
func TestNotifyIsCapped(t *testing.T) {
	srv, _, tokB, _, aliceID, _, carolID, _ := notifyFixture(t)
	const engID = "55555555-5555-5555-5555-555555555555"
	three := `"` + aliceID + `","` + carolID + `","` + aliceID + `"`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, comment(engID, three)); rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for %d targets", rr.Code, 3)
	}
}

func TestNotifyRejectsMalformedIDs(t *testing.T) {
	srv, _, tokB, _, _, _, _, _ := notifyFixture(t)
	const engID = "66666666-6666-6666-6666-666666666666"
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, comment(engID, `"not-a-uuid"`)); rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rr.Code)
	}
}

// You never wake yourself, and doing so is not an error.
func TestNotifySelfIsDroppedNotRejected(t *testing.T) {
	srv, notif, tokB, _, aliceID, bobID, _, _ := notifyFixture(t)
	const engID = "77777777-7777-7777-7777-777777777777"
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, comment(engID, `"`+bobID+`"`)); rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rr.Code)
	}
	got := notif.wokenSet()
	if got[bobID] {
		t.Errorf("bob woke himself")
	}
	if !got[aliceID] || len(got) != 1 {
		t.Errorf("woke %v, want only the owner", got)
	}
}

// The hint is for routing only: it must never reach the stored row.
func TestNotifyIsNeverPersisted(t *testing.T) {
	srv, _, tokB, _, _, _, carolID, _ := notifyFixture(t)
	const engID = "88888888-8888-8888-8888-888888888888"
	do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, comment(engID, `"`+carolID+`"`))

	rr := do(t, srv, http.MethodGet, "/v1/posts/"+postID+"/engagement", tokB, "")
	if body := rr.Body.String(); strings.Contains(body, carolID) || strings.Contains(body, "notify") {
		t.Errorf("the stored engagement leaked the wake hint: %s", body)
	}
}

func TestNotifyCannotBeUsedAsAudienceOracleByOutsider(t *testing.T) {
	srv, notif, _, tokD, _, _, carolID, _ := notifyFixture(t)
	const engID = "99999999-9999-9999-9999-999999999999"
	rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokD, comment(engID, `"`+carolID+`"`))
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want caller authorization 403 before target validation", rr.Code)
	}
	if len(notif.wokenSet()) != 0 {
		t.Fatalf("unauthorized hint woke %v", notif.wokenSet())
	}
}

func TestSenderSealedPreviewRoutesOnlyToNamedTarget(t *testing.T) {
	srv, notif, tokB, _, aliceID, _, carolID, _ := notifyFixture(t)
	const engID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	body := `{"id":"` + engID + `","kind":"comment","payload":"SEALED","notify":["` + carolID + `"],"preview":"SEALED-PREVIEW"}`
	if rr := do(t, srv, http.MethodPost, "/v1/posts/"+postID+"/engagement", tokB, body); rr.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if len(notif.previews) != 1 || !strings.HasPrefix(notif.previews[0], carolID+":"+postID+":") {
		t.Fatalf("preview routes = %v, want only answered commenter", notif.previews)
	}
	if !notif.wokenSet()[aliceID] || !notif.wokenSet()[carolID] {
		t.Fatalf("woken = %v, want owner and commenter", notif.wokenSet())
	}
	rr := do(t, srv, http.MethodGet, "/v1/posts/"+postID+"/engagement", tokB, "")
	if strings.Contains(rr.Body.String(), "SEALED-PREVIEW") {
		t.Fatalf("preview persisted in engagement: %s", rr.Body.String())
	}
}
