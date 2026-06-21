package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"ring/server/internal/store"
	"ring/server/internal/ws"
)

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
func (c *fakePostConn) AcceptConnection(context.Context, string, string) error        { return nil }
func (c *fakePostConn) RejectConnection(context.Context, string, string, bool) error  { return nil }
func (c *fakePostConn) WithdrawConnection(context.Context, string, string) error      { return nil }
func (c *fakePostConn) IncomingRequests(context.Context, string) ([]store.ConnectionReq, error) {
	return nil, nil
}
func (c *fakePostConn) OutgoingRequests(context.Context, string) ([]store.ConnectionReq, error) {
	return nil, nil
}

// fakePostStore is an in-memory PostStore for handler tests.
type fakePostStore struct {
	posts map[string]store.NewPost
	eng   map[string][]store.PostEngagementRow
	views map[string][]string
}

func newFakePostStore() *fakePostStore {
	return &fakePostStore{
		posts: map[string]store.NewPost{},
		eng:   map[string][]store.PostEngagementRow{},
		views: map[string][]string{},
	}
}
func (f *fakePostStore) PostAuthor(_ context.Context, postID string) (string, error) {
	return f.posts[postID].Author, nil
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
func (f *fakePostStore) ListEngagement(_ context.Context, postID string) ([]store.PostEngagementRow, error) {
	return f.eng[postID], nil
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
func (f *fakePostStore) DeletePost(_ context.Context, author, id string) error {
	if p, ok := f.posts[id]; ok && p.Author == author {
		delete(f.posts, id)
	}
	return nil
}

func newPostTestServer(conn ConnectionStore, posts PostStore) http.Handler {
	as := newFakeStore()
	return NewRouter(&Handlers{
		Store: as, Directory: as, Contacts: as, Blocks: as, Relay: as,
		Connections: conn, Posts: posts, Hub: ws.NewHub(),
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
	tokB, bobID, _ := registerNamed(t, srv, "bob")      // commenter
	tokC, carolID, _ := registerNamed(t, srv, "carol")  // other audience member
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
