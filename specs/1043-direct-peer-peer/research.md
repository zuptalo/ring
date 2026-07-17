# Research: Direct Peer-to-Peer Call Media with Relay Fallback (spec 1043)

All unknowns from Technical Context resolved. Each decision: what / why / what else was considered.

## D1. Path selection mechanism

- **Decision**: Switch every call peer connection from `iceTransportPolicy: 'relay'` to `'all'` and let ICE pick the best working pair; keep the TURN relay in every candidate set.
- **Rationale**: ICE is the standard, battle-tested mechanism for exactly this problem: it checks all candidate pairs (host, srflx, relay) and selects by priority, preferring direct. No custom logic, no reliability regression — the relay pair that works today is still checked and still wins when nothing else survives.
- **Alternatives considered**:
  - *Try direct first, renegotiate to relay on failure*: hand-rolls what ICE already does, adds failure-window complexity, rejected.
  - *Keep relay-only and add an SFU for groups*: opposite direction — adds a server media component, breaks the "no middle-box" E2EE story (would force per-frame insertable-streams crypto back in), massively more complex. Rejected; this repo deliberately removed its SFU (spec 0004).

## D2. Same-LAN direct without any server change

- **Decision**: Rely on browser mDNS host candidates for same-network direct paths; require no server capability for US1.
- **Rationale**: All evergreen browsers gather mDNS-obfuscated host candidates by default; two peers on one LAN resolve each other's mDNS names locally and connect directly, while remote peers cannot resolve them (privacy preserved). Works against unmodified deployments.
- **Alternatives considered**: advertising a STUN entry as mandatory for US1 — unnecessary; srflx is only needed cross-network.

## D3. Internet-wide direct paths (operator opt-in)

- **Decision**: Optional server UDP listener (`TURN_UDP_LISTEN`, default empty = disabled, even in TLS mode) on which the embedded pion server answers STUN Binding (address discovery) and serves TURN-over-UDP with the same time-windowed REST credentials. When configured, advertise `stun:<STUN_PUBLIC_HOST>:<STUN_PUBLIC_PORT>` (credential-less entry) and `turn:<host>:<port>?transport=udp` alongside the existing `turns:` entry.
- **Rationale**: srflx discovery requires UDP; STUN-over-TCP-443 cannot yield useful UDP srflx. pion/turn already answers STUN on its listeners (the dev branch runs exactly this UDP listener today, `server/internal/turn/server.go:89-113`), so the TLS-mode change is reusing existing code behind a flag. Advertising UDP TURN too is free once the listener exists and upgrades fallback quality (UDP relay beats TCP relay) — ICE still prefers direct pairs, so it never *adds* relay usage.
- **Alternatives considered**:
  - *Public third-party STUN (e.g. Google)*: leaks call-timing metadata to a third party; violates the self-hosted, privacy-first posture. Rejected.
  - *STUN-only on the UDP port (no TURN-over-UDP)*: saves nothing (same listener, pion serves both), forfeits the UDP-relay quality win. Rejected.
  - *Always-on UDP listener*: surprises operators (new open port on upgrade), breaks "zero-deployment-change installs behave identically". Rejected — opt-in.

## D4. Privacy control

- **Decision**: New synced boolean setting `privacy.relayCalls` ("Always relay calls"), default **off**; when on, that user's peer connections are built with `iceTransportPolicy: 'relay'`. Applied at connection construction (next call), synced via the own-sync allowlist.
- **Rationale**: Direct connections necessarily reveal a network address to the accepted call peer. Default-off because: calls occur only between mutually accepted parties; browsers mDNS-mask LAN addresses; Signal ships the identical toggle default-off; default-on would nullify the feature for the majority who never open settings. One relay-forced side suffices to keep the pair relayed (their candidate set contains only relay candidates).
- **Alternatives considered**:
  - *Resurrect `privacy.protectIp`*: rejected — old encrypted own-sync snapshots may still carry a stale value that would silently re-apply; the key stays on the DEAD list (`src/settings/schema.test.ts:33-37`). New key = clean slate.
  - *Default on*: rejected per above; also makes SC-001/002 unreachable in practice.
  - *Per-call choice in the call UI*: more surface, unclear mental model; the synced setting matches the threat model (persistent preference, not per-call whim). Deferred as a possible follow-up.

## D5. ICE candidate volume over sealed signalling

- **Decision**: No batching; candidates continue to be sealed and relayed one at a time as today.
- **Rationale**: Volume grows from ~1-2 (relay-only) to ~5-15 per side. The seal path is already safe: per-session mutex serializes seals (`src/services/messaging.ts:62-79`), and the mesh buffers local ICE until the leg is negotiated (`mesh.ts:822-838`, flushed :891-901) — the known "never seal during ICE hot path" lesson is about the X3DH preamble race, which the existing buffering already prevents. Each seal is a fast symmetric op.
- **Alternatives considered**: *batched candidate signal*: a new signal type old clients can't parse → dropped candidates → broken calls across versions. Rejected outright for v1.

## D6. Wire/API compatibility

- **Decision**: `/v1/turn-credentials` keeps its exact response shape `{iceServers: [...], ttl}`; the stun entry is one more array element without `username`/`credential`. Server ships before (or with) the client.
- **Rationale**: `RTCPeerConnection` accepts credential-less STUN entries natively; old clients pass the extra entry into a `'relay'`-policy connection where it is simply unused. New client + old server → no stun entry → LAN-direct + relay, still correct. No version negotiation needed.
- **Alternatives considered**: versioned endpoint or capability flag — needless machinery for an additive array element. Rejected.

## D7. `RELAY_IP` and mixed pairs

- **Decision**: Keep `RELAY_IP` defaulting to `127.0.0.1`; document (CALLING.md) that operators enabling UDP may set it to the public IP.
- **Rationale**: Both sides always allocate relay candidates, and relay↔relay pairs traverse inside the ringd process — that is exactly today's working path, unaffected. With loopback relay addresses, *mixed* pairs (A's srflx ↔ B's relay-at-127.0.0.1) can never succeed — harmless (wasted checks, visible in webrtc-internals) but worth documenting so nobody chases it as a bug. A public `RELAY_IP` enables the one-sided-relay optimization.
- **Alternatives considered**: auto-detecting the public relay IP — fragile behind NAT/proxies; explicit env knob matches the existing config style. Rejected.

## D8. Setup-latency guardrail (SC-004)

- **Decision**: Accept the small extra gathering/checking cost of `'all'`; verify with the already-instrumented `markConnect` timings (useCall.ts) via the drive harness before/after.
- **Rationale**: Trickle ICE means candidates flow as discovered; the relay candidate is still gathered immediately and usable as soon as checked. The old header comment's stated reason for `'relay'` ("host/srflx pairs would only add gathering latency") is the trade-off we are consciously reversing — the latency cost is milliseconds against a permanent double-hop for all media.
- **Alternatives considered**: aggressive ICE timeouts / candidate filtering — premature; measure first.
