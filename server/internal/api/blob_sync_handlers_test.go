package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"

	"ring/server/internal/store"
)

/* ---- fakes ---- */

type fakeBlobStore struct {
	mu    sync.Mutex
	blobs map[string][]byte
	owner map[string]string
}

func newFakeBlobStore() *fakeBlobStore {
	return &fakeBlobStore{blobs: map[string][]byte{}, owner: map[string]string{}}
}

func (f *fakeBlobStore) PutBlob(_ context.Context, id, owner string, bytes []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.blobs[id] = append([]byte(nil), bytes...)
	f.owner[id] = owner
	return nil
}
func (f *fakeBlobStore) GetBlob(_ context.Context, id string) ([]byte, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.blobs[id]
	return b, ok, nil
}
func (f *fakeBlobStore) DeleteBlobOwnedBy(_ context.Context, id, owner string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.owner[id] != owner {
		return false, nil
	}
	delete(f.blobs, id)
	delete(f.owner, id)
	return true, nil
}

type fakeSyncStore struct {
	mu    sync.Mutex
	seq   int64
	recs  map[string]store.SyncRecordOut // key: store\x00recordId
	rsalt string
	renv  string
	rset  bool
	rlook string // recovery lookup hash
	ruser string // user id owning the recovery wrap (for FindByRecoveryLookup)
}

func newFakeSyncStore() *fakeSyncStore { return &fakeSyncStore{recs: map[string]store.SyncRecordOut{}} }

func (f *fakeSyncStore) PushRecords(_ context.Context, _ string, recs []store.SyncRecordIn) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var maxSeq int64
	for _, r := range recs {
		key := r.Store + "\x00" + r.RecordID
		if ex, ok := f.recs[key]; ok && r.UpdatedAt < ex.UpdatedAt {
			continue // LWW
		}
		f.seq++
		f.recs[key] = store.SyncRecordOut{
			Store: r.Store, RecordID: r.RecordID, UpdatedAt: r.UpdatedAt,
			Ciphertext: r.Ciphertext, Deleted: r.Deleted, Seq: f.seq,
		}
		if f.seq > maxSeq {
			maxSeq = f.seq
		}
	}
	return maxSeq, nil
}
func (f *fakeSyncStore) PullRecords(_ context.Context, _ string, cursor int64, limit int) ([]store.SyncRecordOut, int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []store.SyncRecordOut
	for _, r := range f.recs {
		if r.Seq > cursor {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Seq < out[j].Seq })
	if len(out) > limit {
		out = out[:limit]
	}
	newCursor := cursor
	for _, r := range out {
		if r.Seq > newCursor {
			newCursor = r.Seq
		}
	}
	return out, newCursor, nil
}
func (f *fakeSyncStore) PutRecoveryWrap(_ context.Context, userID, salt, envelope, lookup string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rsalt, f.renv, f.rset, f.rlook, f.ruser = salt, envelope, true, lookup, userID
	return nil
}
func (f *fakeSyncStore) FindByRecoveryLookup(_ context.Context, lookup string) (string, string, string, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.rset || f.rlook == "" || f.rlook != lookup {
		return "", "", "", false, nil
	}
	return f.ruser, f.rsalt, f.renv, true, nil
}
func (f *fakeSyncStore) GetRecoveryWrap(_ context.Context, _ string) (string, string, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.rsalt, f.renv, f.rset, nil
}

/* ---- tests ---- */

func TestBlobUploadDownload(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)

	// Upload ciphertext.
	rr := do(t, srv, http.MethodPost, "/v1/blobs", token, "ENCRYPTED-BYTES")
	if rr.Code != http.StatusOK {
		t.Fatalf("upload status = %d, body = %s", rr.Code, rr.Body.String())
	}
	var up struct {
		BlobID string `json:"blobId"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &up)
	if up.BlobID == "" {
		t.Fatal("no blobId returned")
	}

	// Download it back.
	rr = do(t, srv, http.MethodGet, "/v1/blobs/"+up.BlobID, token, "")
	if rr.Code != http.StatusOK || rr.Body.String() != "ENCRYPTED-BYTES" {
		t.Fatalf("download mismatch: status=%d body=%q", rr.Code, rr.Body.String())
	}

	// Unknown id → 404; no auth → 401.
	if rr := do(t, srv, http.MethodGet, "/v1/blobs/nope", token, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("unknown blob status = %d, want 404", rr.Code)
	}
	if rr := do(t, srv, http.MethodPost, "/v1/blobs", "", "x"); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated upload status = %d, want 401", rr.Code)
	}
}

// A blob can be deleted only by the user who uploaded it: a holder of the (capability)
// id who isn't the owner gets a no-op, and the bytes stay; the owner's delete removes them.
func TestBlobDeleteOwnerOnly(t *testing.T) {
	srv := newTestServer()
	owner, _ := registerUser(t, srv)
	other, _ := registerUser(t, srv)

	rr := do(t, srv, http.MethodPost, "/v1/blobs", owner, "ENCRYPTED-BYTES")
	if rr.Code != http.StatusOK {
		t.Fatalf("upload status = %d", rr.Code)
	}
	var up struct {
		BlobID string `json:"blobId"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &up)

	// A non-owner "delete" is a no-op (204, idempotent) and must NOT remove the blob.
	if rr := do(t, srv, http.MethodDelete, "/v1/blobs/"+up.BlobID, other, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("non-owner delete status = %d, want 204", rr.Code)
	}
	if rr := do(t, srv, http.MethodGet, "/v1/blobs/"+up.BlobID, owner, ""); rr.Code != http.StatusOK {
		t.Fatal("blob must survive a non-owner delete")
	}

	// The owner's delete removes it; the blob is then gone for everyone.
	if rr := do(t, srv, http.MethodDelete, "/v1/blobs/"+up.BlobID, owner, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("owner delete status = %d, want 204", rr.Code)
	}
	if rr := do(t, srv, http.MethodGet, "/v1/blobs/"+up.BlobID, owner, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("blob should be gone after owner delete, status = %d", rr.Code)
	}
}

func TestSyncPushPullLWW(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)

	push := func(body string) *httptest.ResponseRecorder {
		return do(t, srv, http.MethodPost, "/v1/sync/push", token, body)
	}

	// Push two records.
	rr := push(`{"records":[
		{"store":"contacts","recordId":"c1","updatedAt":100,"ciphertext":"AAA"},
		{"store":"chats","recordId":"h1","updatedAt":100,"ciphertext":"BBB"}]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("push status = %d, body = %s", rr.Code, rr.Body.String())
	}

	// Pull from 0 → both records.
	rr = do(t, srv, http.MethodGet, "/v1/sync/pull?cursor=0", token, "")
	var pull struct {
		Records []syncRecordDTO `json:"records"`
		Cursor  int64           `json:"cursor"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &pull)
	if len(pull.Records) != 2 {
		t.Fatalf("pull returned %d records, want 2", len(pull.Records))
	}
	cursor := pull.Cursor

	// A stale update (older updatedAt) is ignored; a newer one is applied.
	push(`{"records":[{"store":"contacts","recordId":"c1","updatedAt":50,"ciphertext":"OLD"}]}`)
	push(`{"records":[{"store":"contacts","recordId":"c1","updatedAt":200,"ciphertext":"NEW"}]}`)

	rr = do(t, srv, http.MethodGet, "/v1/sync/pull?cursor="+strconv.FormatInt(cursor, 10), token, "")
	pull.Records = nil
	_ = json.Unmarshal(rr.Body.Bytes(), &pull)
	if len(pull.Records) != 1 || pull.Records[0].RecordID != "c1" || pull.Records[0].Ciphertext != "NEW" {
		t.Fatalf("expected only the NEW c1 after cursor, got %+v", pull.Records)
	}
}

func TestRecoveryWrapRoundTrip(t *testing.T) {
	srv := newTestServer()
	token, _ := registerUser(t, srv)

	// Absent → 404.
	if rr := do(t, srv, http.MethodGet, "/v1/recovery", token, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("recovery before put = %d, want 404", rr.Code)
	}
	// Store then fetch.
	rr := do(t, srv, http.MethodPut, "/v1/recovery", token,
		`{"salt":"SALT","envelope":{"v":1,"alg":"x","nonce":"n","ct":"c"}}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("put recovery = %d, body = %s", rr.Code, rr.Body.String())
	}
	rr = do(t, srv, http.MethodGet, "/v1/recovery", token, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("get recovery = %d", rr.Code)
	}
	var got recoveryDTO
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got.Salt != "SALT" || !strings.Contains(string(got.Envelope), `"v":1`) {
		t.Fatalf("recovery round-trip mismatch: %+v", got)
	}
}
