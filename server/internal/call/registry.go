// Package call tracks ephemeral group-call room membership in memory. It holds
// no media and no keys - only which user ids are currently in which room - so
// the zero-knowledge property is preserved (the server learns who is in a call,
// never what is said). Lost on restart, which is correct: a restart drops live
// calls.
package call

import "sync"

// Registry is the in-memory set of rooms → member user ids.
type Registry struct {
	mu    sync.RWMutex
	rooms map[string]map[string]struct{} // roomID → set of userIDs
}

func NewRegistry() *Registry {
	return &Registry{rooms: map[string]map[string]struct{}{}}
}

// Join adds userID to roomID and returns the resulting roster.
func (r *Registry) Join(roomID, userID string) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.rooms[roomID]
	if m == nil {
		m = map[string]struct{}{}
		r.rooms[roomID] = m
	}
	m[userID] = struct{}{}
	return keys(m)
}

// Leave removes userID from roomID; returns the new roster and whether the room
// is now empty (and was deleted).
func (r *Registry) Leave(roomID, userID string) (roster []string, empty bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.rooms[roomID]
	if m == nil {
		return nil, true
	}
	delete(m, userID)
	if len(m) == 0 {
		delete(r.rooms, roomID)
		return nil, true
	}
	return keys(m), false
}

// Roster returns the current members of roomID.
func (r *Registry) Roster(roomID string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return keys(r.rooms[roomID])
}

// SharesRoom reports whether a and b are currently in at least one common room. It lets
// co-participants of a live call fetch each other's prekey bundles for the duration of the
// call (mesh signalling is sealed per-pair over a 1:1 session), without creating any
// persistent connection: access ends the moment either leaves and the room empties.
func (r *Registry) SharesRoom(a, b string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, m := range r.rooms {
		if _, inA := m[a]; !inA {
			continue
		}
		if _, inB := m[b]; inB {
			return true
		}
	}
	return false
}

// InRoom reports whether userID is currently a member of roomID.
func (r *Registry) InRoom(roomID, userID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	m := r.rooms[roomID]
	if m == nil {
		return false
	}
	_, ok := m[userID]
	return ok
}

// RoomsForUser returns every room userID is currently in (for disconnect cleanup).
func (r *Registry) RoomsForUser(userID string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []string
	for roomID, m := range r.rooms {
		if _, ok := m[userID]; ok {
			out = append(out, roomID)
		}
	}
	return out
}

func keys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
