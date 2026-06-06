package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
	"ring/server/internal/store"
)

// maxOneTimePreKeysPerRequest caps a single publish/replenish batch.
const maxOneTimePreKeysPerRequest = 200

var uuidRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// --- DTOs (camelCase, mirroring the client's PublicBundle in identity.ts) ---

type signedPreKeyDTO struct {
	ID  string `json:"id"`
	Pub string `json:"pub"`
	Sig string `json:"sig"`
}

type oneTimePreKeyDTO struct {
	ID  string `json:"id"`
	Pub string `json:"pub"`
}

type publishKeysRequest struct {
	EdPub          string             `json:"edPub"`
	XPub           string             `json:"xPub"`
	SignedPreKey   signedPreKeyDTO    `json:"signedPreKey"`
	OneTimePreKeys []oneTimePreKeyDTO `json:"oneTimePreKeys"`
}

type oneTimeKeysRequest struct {
	OneTimePreKeys []oneTimePreKeyDTO `json:"oneTimePreKeys"`
}

type peerBundleResponse struct {
	UserID        string            `json:"userId"`
	EdPub         string            `json:"edPub"`
	XPub          string            `json:"xPub"`
	SignedPreKey  signedPreKeyDTO   `json:"signedPreKey"`
	OneTimePreKey *oneTimePreKeyDTO `json:"oneTimePreKey,omitempty"`
}

func toStoreOTKs(in []oneTimePreKeyDTO) ([]store.OneTimePreKey, bool) {
	out := make([]store.OneTimePreKey, 0, len(in))
	for _, k := range in {
		if k.ID == "" || k.Pub == "" {
			return nil, false
		}
		out = append(out, store.OneTimePreKey{ID: k.ID, Pub: k.Pub})
	}
	return out, true
}

// publishKeys (PUT /v1/keys) stores the caller's identity + signed prekey and
// seeds their one-time prekey pool. Re-publishing rotates the signed prekey.
func (h *Handlers) publishKeys(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())

	var req publishKeysRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.EdPub == "" || req.XPub == "" ||
		req.SignedPreKey.ID == "" || req.SignedPreKey.Pub == "" || req.SignedPreKey.Sig == "" {
		httpx.Error(w, http.StatusBadRequest, "missing identity or signed prekey fields")
		return
	}
	if len(req.OneTimePreKeys) > maxOneTimePreKeysPerRequest {
		httpx.Error(w, http.StatusBadRequest, "too many one-time prekeys in one request")
		return
	}
	otks, ok := toStoreOTKs(req.OneTimePreKeys)
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "invalid one-time prekey")
		return
	}

	bundle := store.PublicBundle{
		EdPub:          req.EdPub,
		XPub:           req.XPub,
		SignedPreKey:   store.SignedPreKey{ID: req.SignedPreKey.ID, Pub: req.SignedPreKey.Pub, Sig: req.SignedPreKey.Sig},
		OneTimePreKeys: otks,
	}
	if err := h.Keys.PublishBundle(r.Context(), uid, bundle); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not publish keys")
		return
	}
	h.respondKeyCount(w, r, uid)
}

// addOneTimeKeys (POST /v1/keys/onetime) replenishes the caller's pool.
func (h *Handlers) addOneTimeKeys(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())

	var req oneTimeKeysRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.OneTimePreKeys) == 0 {
		httpx.Error(w, http.StatusBadRequest, "no one-time prekeys provided")
		return
	}
	if len(req.OneTimePreKeys) > maxOneTimePreKeysPerRequest {
		httpx.Error(w, http.StatusBadRequest, "too many one-time prekeys in one request")
		return
	}
	otks, ok := toStoreOTKs(req.OneTimePreKeys)
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "invalid one-time prekey")
		return
	}
	if err := h.Keys.AddOneTimePreKeys(r.Context(), uid, otks); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not add one-time prekeys")
		return
	}
	h.respondKeyCount(w, r, uid)
}

// keyCount (GET /v1/keys/count) reports the caller's remaining one-time prekeys.
func (h *Handlers) keyCount(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	h.respondKeyCount(w, r, uid)
}

func (h *Handlers) respondKeyCount(w http.ResponseWriter, r *http.Request, uid string) {
	n, err := h.Keys.OneTimePreKeyCount(r.Context(), uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not count one-time prekeys")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]int{"oneTimePreKeys": n})
}

// fetchKeys (GET /v1/keys/{userId}) returns a peer's bundle for X3DH, consuming
// one of their one-time prekeys.
func (h *Handlers) fetchKeys(w http.ResponseWriter, r *http.Request) {
	target := r.PathValue("userId")
	if !uuidRE.MatchString(target) {
		httpx.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	// If the target has blocked the requester, hide the bundle (same 404 as "no
	// keys") so the blocked user can't bootstrap a session or re-add them.
	if requester, ok := auth.UserID(r.Context()); ok && requester != "" {
		if blocked, err := h.Blocks.IsBlocked(r.Context(), target, requester); err == nil && blocked {
			httpx.Error(w, http.StatusNotFound, "no key bundle for user")
			return
		}
	}
	pb, err := h.Keys.FetchBundle(r.Context(), target)
	if errors.Is(err, store.ErrNoBundle) {
		httpx.Error(w, http.StatusNotFound, "no key bundle for user")
		return
	}
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not fetch keys")
		return
	}

	resp := peerBundleResponse{
		UserID:       pb.UserID,
		EdPub:        pb.EdPub,
		XPub:         pb.XPub,
		SignedPreKey: signedPreKeyDTO{ID: pb.SignedPreKey.ID, Pub: pb.SignedPreKey.Pub, Sig: pb.SignedPreKey.Sig},
	}
	if pb.OneTimePreKey != nil {
		resp.OneTimePreKey = &oneTimePreKeyDTO{ID: pb.OneTimePreKey.ID, Pub: pb.OneTimePreKey.Pub}
	}
	httpx.JSON(w, http.StatusOK, resp)
}
