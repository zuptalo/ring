package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"ring/server/internal/auth"
	"ring/server/internal/httpx"
	"ring/server/internal/store"
)

const (
	maxSyncBody  = 8 << 20 // 8 MiB per push batch
	pullPageSize = 500
)

type syncRecordDTO struct {
	Store      string `json:"store"`
	RecordID   string `json:"recordId"`
	UpdatedAt  int64  `json:"updatedAt"`
	Ciphertext string `json:"ciphertext,omitempty"`
	Deleted    bool   `json:"deleted,omitempty"`
	Seq        int64  `json:"seq,omitempty"`
}

// pushSync (POST /v1/sync/push) upserts a batch of encrypted records.
func (h *Handlers) pushSync(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var req struct {
		Records []syncRecordDTO `json:"records"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSyncBody)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	recs := make([]store.SyncRecordIn, 0, len(req.Records))
	for _, d := range req.Records {
		if d.Store == "" || d.RecordID == "" {
			httpx.Error(w, http.StatusBadRequest, "record missing store/recordId")
			return
		}
		recs = append(recs, store.SyncRecordIn{
			Store: d.Store, RecordID: d.RecordID, UpdatedAt: d.UpdatedAt,
			Ciphertext: d.Ciphertext, Deleted: d.Deleted,
		})
	}
	cursor, err := h.Sync.PushRecords(r.Context(), uid, recs)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "push failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]int64{"cursor": cursor})
}

// pullSync (GET /v1/sync/pull?cursor=N) streams records changed after a cursor.
func (h *Handlers) pullSync(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	cursor, _ := strconv.ParseInt(r.URL.Query().Get("cursor"), 10, 64)
	recs, newCursor, err := h.Sync.PullRecords(r.Context(), uid, cursor, pullPageSize)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "pull failed")
		return
	}
	out := make([]syncRecordDTO, 0, len(recs))
	for _, rec := range recs {
		out = append(out, syncRecordDTO{
			Store: rec.Store, RecordID: rec.RecordID, UpdatedAt: rec.UpdatedAt,
			Ciphertext: rec.Ciphertext, Deleted: rec.Deleted, Seq: rec.Seq,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"records": out, "cursor": newCursor})
}

type recoveryDTO struct {
	Salt     string          `json:"salt"`
	Envelope json.RawMessage `json:"envelope"`
	Lookup   string          `json:"lookup,omitempty"` // one-way hash of the recovery code (for new-device restore)
}

// putRecovery (PUT /v1/recovery) stores the recovery envelope + salt.
func (h *Handlers) putRecovery(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	var req recoveryDTO
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Salt == "" || len(req.Envelope) == 0 {
		httpx.Error(w, http.StatusBadRequest, "missing salt or envelope")
		return
	}
	if err := h.Sync.PutRecoveryWrap(r.Context(), uid, req.Salt, string(req.Envelope), req.Lookup); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not store recovery wrap")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// getRecovery (GET /v1/recovery) returns the stored recovery envelope + salt.
func (h *Handlers) getRecovery(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	salt, envelope, found, err := h.Sync.GetRecoveryWrap(r.Context(), uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not read recovery wrap")
		return
	}
	if !found {
		httpx.Error(w, http.StatusNotFound, "no recovery wrap")
		return
	}
	httpx.JSON(w, http.StatusOK, recoveryDTO{Salt: salt, Envelope: json.RawMessage(envelope)})
}
