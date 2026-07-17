package api

import (
	"crypto/rand"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
)

// defaultMaxBlobBytes caps a single encrypted media upload when the operator
// hasn't set MAX_BLOB_MB. Generous so a video whose in-browser compression
// underperforms (or falls back to the original) still uploads rather than
// failing - the client compresses to keep typical sends far below this.
const defaultMaxBlobBytes = 256 << 20 // 256 MiB

// maxBlob returns the effective per-upload cap (config override, else default).
func (h *Handlers) maxBlob() int64 {
	if h.MaxBlobBytes > 0 {
		return int64(h.MaxBlobBytes)
	}
	return defaultMaxBlobBytes
}

func newBlobID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// uploadBlob (POST /v1/blobs) stores an encrypted blob and returns its id. The
// body is raw ciphertext (application/octet-stream).
func (h *Handlers) uploadBlob(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, h.maxBlob()))
	if err != nil {
		httpx.Error(w, http.StatusRequestEntityTooLarge, "blob too large")
		return
	}
	if len(body) == 0 {
		httpx.Error(w, http.StatusBadRequest, "empty blob")
		return
	}
	id, err := newBlobID()
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not allocate blob id")
		return
	}
	if err := h.Blobs.PutBlob(r.Context(), id, uid, body); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not store blob")
		return
	}
	slog.Info("blob uploaded", "user", uid, "id", id, "bytes", len(body))
	httpx.JSON(w, http.StatusOK, map[string]string{"blobId": id})
}

// downloadBlob (GET /v1/blobs/{id}) returns the ciphertext bytes. The id is an
// unguessable capability, so any authenticated user who holds it may fetch
// (that's how a recipient retrieves a sender's attachment).
func (h *Handlers) downloadBlob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	bytes, found, err := h.Blobs.GetBlob(r.Context(), id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not read blob")
		return
	}
	if !found {
		httpx.Error(w, http.StatusNotFound, "blob not found")
		return
	}
	// Set Content-Length explicitly so the client can show an accurate download progress
	// bar. Without it Go streams the body chunked (no length), and the receiver can only
	// tell "started" vs "done" — the progress ring would jump instead of filling smoothly.
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(bytes)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(bytes)
}

// deleteBlob (DELETE /v1/blobs/{id}) removes a blob the caller uploaded. Only the owner
// may delete (a leaked capability id can't be used to wipe someone else's media). The
// sender calls this once every recipient has confirmed the media is downloaded, and on
// chat delete — reclaiming big media from the server the moment it's no longer needed,
// rather than waiting for the age-based backstop sweep. Idempotent: a missing or
// not-owned blob returns 204 too (nothing to do, and the owner can't tell them apart).
func (h *Handlers) deleteBlob(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	id := r.PathValue("id")
	if _, err := h.Blobs.DeleteBlobOwnedBy(r.Context(), id, uid); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not delete blob")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
