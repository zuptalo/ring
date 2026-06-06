// Package sfu is an embedded Selective Forwarding Unit for group calls. Each
// participant keeps ONE PeerConnection to the SFU; the SFU forwards every
// participant's RTP to all the others. It forwards packets verbatim - the media
// payload is end-to-end encrypted by the clients (insertable streams), so the
// SFU can read RTP headers for routing but never the media itself.
//
// Negotiation is server-offers-only (adapted from pion's sfu-ws example): the
// SFU always creates the offers and clients only answer + trickle ICE, which
// removes offer/answer glare entirely.
package sfu

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// Signal is an outbound SFU→client message; the host (WS hub) delivers it to the
// user over the signalling channel.
type Signal struct {
	T      string // "sfu-offer" | "sfu-ice"
	UserID string
	RoomID string
	Data   json.RawMessage // marshaled SessionDescription (offer) or ICECandidateInit
}

// SFU owns all rooms.
type SFU struct {
	send func(Signal)
	// ice returns the ICE servers for a new PeerConnection. Called per-PC so the
	// SFU always uses fresh (unexpired) TURN credentials. When it returns a
	// non-empty list the SFU forces relay-only candidates (so it presents a
	// relay candidate at the public RelayIP that relay-only clients can reach);
	// empty → host candidates (directly-reachable host, e.g. tests without TURN).
	ice   func() []webrtc.ICEServer
	mu    sync.Mutex
	rooms map[string]*room
}

type room struct {
	id          string
	mu          sync.Mutex
	peers       map[string]*peerState
	trackLocals map[string]*webrtc.TrackLocalStaticRTP
}

type peerState struct {
	pc     *webrtc.PeerConnection
	userID string
}

// New creates an SFU. send delivers sfu-offer/sfu-ice frames to a user. ice
// returns ICE servers for each new PeerConnection (called per-PC so credentials
// never go stale); pass nil for host-candidate-only (direct reachability).
func New(send func(Signal), ice func() []webrtc.ICEServer) *SFU {
	if ice == nil {
		ice = func() []webrtc.ICEServer { return nil }
	}
	s := &SFU{
		send:  send,
		ice:   ice,
		rooms: map[string]*room{},
	}
	// Periodically request keyframes so late joiners can decode video promptly.
	go func() {
		for range time.NewTicker(3 * time.Second).C {
			s.dispatchKeyFrames()
		}
	}()
	return s
}

func (s *SFU) getRoom(roomID string) *room {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.rooms[roomID]
	if r == nil {
		r = &room{id: roomID, peers: map[string]*peerState{}, trackLocals: map[string]*webrtc.TrackLocalStaticRTP{}}
		s.rooms[roomID] = r
	}
	return r
}

// Join creates the participant's PeerConnection and kicks off negotiation (the
// SFU offers). Idempotent-ish: a re-join replaces any prior PC for that user.
func (s *SFU) Join(roomID, userID string) error {
	s.Leave(roomID, userID) // drop any stale PC for this user first

	conf := webrtc.Configuration{ICEServers: s.ice()}
	if len(conf.ICEServers) > 0 {
		// Relay-only: present a relay candidate at the public RelayIP so clients
		// (also relay-only under the 443 constraint) can reach the SFU.
		conf.ICETransportPolicy = webrtc.ICETransportPolicyRelay
	}
	pc, err := webrtc.NewPeerConnection(conf)
	if err != nil {
		return err
	}

	// Receive one audio + one video track from this participant.
	for _, typ := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeVideo, webrtc.RTPCodecTypeAudio} {
		if _, err := pc.AddTransceiverFromKind(typ, webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		}); err != nil {
			pc.Close()
			return err
		}
	}

	r := s.getRoom(roomID)
	r.mu.Lock()
	r.peers[userID] = &peerState{pc: pc, userID: userID}
	r.mu.Unlock()

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		data, err := json.Marshal(c.ToJSON())
		if err != nil {
			return
		}
		s.send(Signal{T: "sfu-ice", UserID: userID, RoomID: roomID, Data: data})
	})

	pc.OnConnectionStateChange(func(p webrtc.PeerConnectionState) {
		switch p {
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			s.Leave(roomID, userID)
		default:
		}
	})

	pc.OnTrack(func(t *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		local := s.addTrack(r, t)
		if local == nil {
			return
		}
		defer s.removeTrack(r, local)

		buf := make([]byte, 1500)
		pkt := &rtp.Packet{}
		for {
			n, _, err := t.Read(buf)
			if err != nil {
				return
			}
			if err := pkt.Unmarshal(buf[:n]); err != nil {
				return
			}
			// Strip header extensions: they don't carry across the forward and
			// can confuse subscribers. The (E2EE) payload is untouched.
			pkt.Extension = false
			pkt.Extensions = nil
			if err := local.WriteRTP(pkt); err != nil {
				return
			}
		}
	})

	s.signalPeers(r)
	return nil
}

// Answer applies a participant's answer (JSON-encoded SessionDescription) to an
// SFU offer. Takes raw JSON so callers needn't import pion/webrtc.
func (s *SFU) Answer(roomID, userID string, sdp json.RawMessage) error {
	var desc webrtc.SessionDescription
	if err := json.Unmarshal(sdp, &desc); err != nil {
		return err
	}
	pc := s.peerPC(roomID, userID)
	if pc == nil {
		return nil
	}
	if err := pc.SetRemoteDescription(desc); err != nil {
		return err
	}
	// The PC is stable again → push any tracks that were waiting.
	if r := s.roomIfExists(roomID); r != nil {
		s.signalPeers(r)
	}
	return nil
}

// ICE adds a participant's trickled ICE candidate (JSON-encoded ICECandidateInit).
func (s *SFU) ICE(roomID, userID string, cand json.RawMessage) error {
	var c webrtc.ICECandidateInit
	if err := json.Unmarshal(cand, &c); err != nil {
		return err
	}
	pc := s.peerPC(roomID, userID)
	if pc == nil {
		return nil
	}
	return pc.AddICECandidate(c)
}

// Leave tears down a participant's PC and re-signals the room.
func (s *SFU) Leave(roomID, userID string) {
	r := s.roomIfExists(roomID)
	if r == nil {
		return
	}
	r.mu.Lock()
	p := r.peers[userID]
	delete(r.peers, userID)
	empty := len(r.peers) == 0
	r.mu.Unlock()
	if p != nil {
		_ = p.pc.Close()
	}
	if empty {
		s.mu.Lock()
		delete(s.rooms, roomID)
		s.mu.Unlock()
		return
	}
	s.signalPeers(r)
}

func (s *SFU) addTrack(r *room, t *webrtc.TrackRemote) *webrtc.TrackLocalStaticRTP {
	local, err := webrtc.NewTrackLocalStaticRTP(t.Codec().RTPCodecCapability, t.ID(), t.StreamID())
	if err != nil {
		slog.Error("sfu new local track", "err", err)
		return nil
	}
	r.mu.Lock()
	r.trackLocals[t.ID()] = local
	r.mu.Unlock()
	s.signalPeers(r)
	return local
}

func (s *SFU) removeTrack(r *room, local *webrtc.TrackLocalStaticRTP) {
	r.mu.Lock()
	delete(r.trackLocals, local.ID())
	r.mu.Unlock()
	s.signalPeers(r)
}

// signalPeers reconciles every peer's outbound tracks with the room's track set
// and, when changed, (re)offers. Retries briefly if a PC is mid-negotiation.
func (s *SFU) signalPeers(r *room) {
	r.mu.Lock()
	defer func() {
		r.mu.Unlock()
		s.dispatchKeyFramesRoom(r)
	}()

	attempt := func() (retry bool) {
		for userID, p := range r.peers {
			pc := p.pc
			if pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
				delete(r.peers, userID)
				return true
			}
			// Skip a PC that already has an outstanding offer; it'll be
			// re-synced when its answer lands (see Answer).
			if pc.SignalingState() != webrtc.SignalingStateStable {
				continue
			}

			existing := map[string]bool{}
			for _, sender := range pc.GetSenders() {
				if sender.Track() == nil {
					continue
				}
				existing[sender.Track().ID()] = true
				// A sender for a track that no longer exists → remove it.
				if _, ok := r.trackLocals[sender.Track().ID()]; !ok {
					if err := pc.RemoveTrack(sender); err != nil {
						return true
					}
				}
			}
			// Never send a participant their own track back (loopback).
			for _, recv := range pc.GetReceivers() {
				if recv.Track() == nil {
					continue
				}
				existing[recv.Track().ID()] = true
			}
			// Add any room track this peer isn't sending yet.
			for id, local := range r.trackLocals {
				if !existing[id] {
					if _, err := pc.AddTrack(local); err != nil {
						return true
					}
				}
			}

			senderCount := len(pc.GetSenders())
			if senderCount == 0 {
				// Nothing to offer yet (no other tracks). The initial offer is
				// still needed so the client can publish, so only skip if we've
				// already negotiated once.
				if pc.RemoteDescription() != nil {
					continue
				}
			}

			offer, err := pc.CreateOffer(nil)
			if err != nil {
				return true
			}
			if err := pc.SetLocalDescription(offer); err != nil {
				return true
			}
			data, err := json.Marshal(offer)
			if err != nil {
				return true
			}
			s.send(Signal{T: "sfu-offer", UserID: userID, RoomID: r.id, Data: data})
		}
		return false
	}

	for i := 0; ; i++ {
		if i == 25 {
			go func() {
				time.Sleep(3 * time.Second)
				s.signalPeers(r)
			}()
			return
		}
		if !attempt() {
			break
		}
	}
}

func (s *SFU) dispatchKeyFrames() {
	s.mu.Lock()
	rooms := make([]*room, 0, len(s.rooms))
	for _, r := range s.rooms {
		rooms = append(rooms, r)
	}
	s.mu.Unlock()
	for _, r := range rooms {
		s.dispatchKeyFramesRoom(r)
	}
}

func (s *SFU) dispatchKeyFramesRoom(r *room) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, p := range r.peers {
		for _, recv := range p.pc.GetReceivers() {
			if recv.Track() == nil {
				continue
			}
			_ = p.pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{
				MediaSSRC: uint32(recv.Track().SSRC()),
			}})
		}
	}
}

func (s *SFU) roomIfExists(roomID string) *room {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rooms[roomID]
}

func (s *SFU) peerPC(roomID, userID string) *webrtc.PeerConnection {
	r := s.roomIfExists(roomID)
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if p := r.peers[userID]; p != nil {
		return p.pc
	}
	return nil
}
