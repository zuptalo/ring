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
type fakePostStore struct{ posts map[string]store.NewPost }

func newFakePostStore() *fakePostStore { return &fakePostStore{posts: map[string]store.NewPost{}} }
func (f *fakePostStore) CreatePost(_ context.Context, p store.NewPost) error {
	f.posts[p.ID] = p
	return nil
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
