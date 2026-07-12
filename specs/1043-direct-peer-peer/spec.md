# Feature Specification: Direct Peer-to-Peer Call Media with Relay Fallback

**Feature Branch**: `feat/1043-direct-peer-peer`

**Created**: 2026-07-12

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Direct peer-to-peer call media with TURN fallback. Today all call media (1:1 and group mesh) is forced through the server's embedded TURN relay. This costs server bandwidth (O(N·(N-1)) flows per group call) and adds latency even when two devices sit on the same Wi-Fi. Change: allow direct paths when networks permit — same-LAN immediately, internet-wide when the operator opts into exposing a UDP endpoint — with the relay remaining as automatic fallback so calls never get less reliable. Add a synced privacy toggle 'Always relay calls' so a user can force relay and keep their IP hidden from call peers. Zero-deployment-change installs keep working exactly as today except same-LAN calls connect directly."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Same-network calls connect directly (Priority: P1)

Two people on the same Wi-Fi network (a household, an office) place a Ring call. Today their audio and video travel out to the Ring server and back, adding delay and consuming server bandwidth for no benefit. After this change, their call media flows directly between their devices while staying end-to-end encrypted, and the server carries none of it.

**Why this priority**: This is the highest-value, lowest-risk slice. It needs no operator action, no new ports, and no server capability — only the client must stop refusing direct paths. It delivers the latency and server-bandwidth win for the common "family on one Wi-Fi" case immediately.

**Independent Test**: Place a call between two devices (or two browsers) on the same network against an unmodified server deployment; inspect the active connection path and confirm it is device-to-device, not via the relay. Break the direct path (e.g. isolate the clients) and confirm the same call setup still succeeds via the relay.

**Acceptance Scenarios**:

1. **Given** two signed-in users on the same local network, **When** one calls the other (1:1, audio or video), **Then** the call connects and media flows directly between the two devices without transiting the relay.
2. **Given** a group call whose members are all on the same local network, **When** the call is up, **Then** each mesh leg flows directly between the two devices it connects.
3. **Given** two users whose networks block any direct path, **When** one calls the other, **Then** the call connects via the relay exactly as today, with no user-visible error.
4. **Given** an existing deployment with no configuration changes, **When** users call across different networks, **Then** calls behave exactly as today (relayed), with no regression in reliability.

---

### User Story 2 - Internet-wide direct calls when the operator opts in (Priority: P2)

A server operator wants calls between users on different networks to connect directly whenever both sides' networks allow it, so the server stops paying bandwidth for most call media and callers get lower delay and headroom for higher quality. The operator enables one additional public UDP endpoint on the server; from then on, clients discover their public addresses through it and connect directly when possible, falling back to the relay when not.

**Why this priority**: This is the big server-bandwidth and quality win for the general case, but it requires an explicit deployment step (opening a UDP port) and therefore ships as an operator opt-in on top of US1.

**Independent Test**: Against a deployment with the UDP endpoint enabled, place a call between two clients on different networks with ordinary home-router NAT; confirm the selected path is direct. Against the same deployment, place a call from a network that blocks UDP; confirm the call still connects via the relay.

**Acceptance Scenarios**:

1. **Given** a deployment with the direct-path UDP endpoint enabled and two users on different networks whose NATs permit it, **When** they call each other, **Then** media flows directly between their devices and not through the relay.
2. **Given** the same deployment and a caller on a network that blocks direct traffic, **When** they call, **Then** the call connects through the relay with no user-visible difference except possibly quality.
3. **Given** a deployment where the operator has NOT enabled the UDP endpoint, **When** users on different networks call each other, **Then** behavior is identical to today (relayed), and nothing warns or errors.
4. **Given** an older app version talking to an upgraded server (or vice versa), **When** a call is placed, **Then** the call connects; mixed versions never break calling.

---

### User Story 3 - "Always relay calls" privacy choice (Priority: P3)

A privacy-conscious user does not want people they call to learn their network address. They switch on a new setting, "Always relay calls". From then on, every call they place or answer routes their media through the Ring server, so call peers only ever see the server's address. The choice follows them to their other devices like their other synced preferences.

**Why this priority**: Direct connections necessarily reveal a network address to the call peer. Ring is privacy-first, so the escape hatch must ship in the same release as direct paths — but it is a small, self-contained addition on top of US1/US2.

**Independent Test**: Toggle the setting on one device, place a call on that device and confirm the selected path is the relay even on the same LAN; sign in on a second device and confirm the setting arrived there.

**Acceptance Scenarios**:

1. **Given** a user with "Always relay calls" switched on, **When** they place or answer any call (1:1 or group), **Then** their media enters and leaves through the relay only, and the call peer never learns a direct address for them.
2. **Given** a user with the setting on and a peer with it off, **When** they call each other, **Then** the call connects through the relay (one relayed side is enough) and both sides' calls work normally.
3. **Given** the setting is toggled during an active call, **When** the current call continues, **Then** the change applies from the next call onward.
4. **Given** the setting is on and the user signs in on another device, **When** the other device syncs, **Then** the setting is on there too.

---

### User Story 4 - Operator clarity and zero-change safety (Priority: P4)

An operator reading the deployment docs can understand exactly what each exposure level buys: doing nothing keeps today's behavior (everything relayed, plus same-LAN direct); opening one UDP port enables internet-wide direct calls. The docs also explain the trade-offs (the UDP endpoint is more fingerprintable than the TLS-on-443 relay path) so operators in restrictive environments can make an informed choice.

**Why this priority**: Documentation and operational safety underpin the other stories but deliver no standalone end-user behavior.

**Independent Test**: Follow the updated deployment docs from scratch on a test host at each exposure level and confirm the documented behavior matches reality.

**Acceptance Scenarios**:

1. **Given** an operator who changes nothing, **When** they upgrade the server, **Then** no new ports are opened and no new listeners start.
2. **Given** an operator following the new docs section, **When** they enable the UDP endpoint and forward the port, **Then** internet-wide direct calls work as described.

---

### Edge Cases

- One participant's network allows direct paths, the other's does not: the call must still connect (via relay) without extra delay beyond normal setup.
- A direct connection degrades or dies mid-call (e.g. one device roams off Wi-Fi): the existing reconnection behavior must recover the call, falling back to the relay if that is all that remains.
- Group call where some legs are direct and others relayed: each leg independently picks the best working path; mixed paths within one call are normal.
- A user with "Always relay calls" on still receives the peer's address candidates during call setup (unavoidable in the signalling); the guarantee is only that *their own* address is never revealed — the spec's privacy wording must not overpromise.
- Server deployed with the UDP endpoint enabled but the operator forgot the firewall/port-forward: clients simply never find a working direct path across networks and fall back to relay; calls must not hang on the missing path.
- Credential lifetime expiry mid-call and ICE restarts must behave the same as today on both direct and relayed paths.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Call media (1:1 and every group-mesh leg) MUST be allowed to use a direct device-to-device path when one exists, instead of being unconditionally forced through the server relay.
- **FR-002**: The server relay MUST remain available as an automatic fallback for every call; a call that would have connected before this change MUST still connect after it.
- **FR-003**: Call media MUST remain end-to-end encrypted on every path (direct or relayed); no server component may gain access to media plaintext.
- **FR-004**: On deployments with no configuration changes, calls between devices on the same local network SHOULD connect directly; all other calls MUST behave exactly as today.
- **FR-005**: The server MUST offer an operator-opt-in public UDP endpoint that lets clients discover their public addresses for direct connections across networks; when it is not configured, no new listener or port is opened.
- **FR-006**: When the UDP endpoint is configured, the server MUST advertise it to calling clients alongside the existing relay, without changing the shape of the credentials response, so that older clients keep working unmodified.
- **FR-007**: Users MUST be able to switch on an "Always relay calls" preference that forces all of their call media through the relay so call peers never learn a direct network address for them; it MUST default to off and MUST sync across the user's devices like other synced preferences.
- **FR-008**: The "Always relay calls" preference MUST take effect from the next call; it is not required to re-route an in-progress call.
- **FR-009**: A call between one relay-forced participant and one direct-capable participant MUST connect (through the relay) with no user-visible failure.
- **FR-010**: Mid-call path loss (direct path stops working) MUST be handled by the existing reconnection behavior, ending in a working relayed connection when that is the only remaining path.
- **FR-011**: Deployment documentation MUST accurately describe media routing at each exposure level (nothing opened; UDP endpoint opened), including the privacy and fingerprintability trade-offs; stale references to a server-side media component that no longer exists MUST be removed.
- **FR-012**: The settings copy for the new preference MUST follow Ring's plain, user-facing voice and be honest about the trade-off (calls may connect slower or at lower quality when relayed).

### Key Entities

- **Call path**: for each call leg, the route media takes — direct (device to device) or relayed (through the server). Chosen automatically per leg; never user-visible except through quality.
- **Relay preference** (`privacy.relayCalls`): a per-user, cross-device synced boolean; off by default; when on, the user's legs are always relayed.
- **Direct-path endpoint**: an optional server-side UDP listener the operator can expose so clients can discover their public addresses; absent by default.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Two devices on the same local network connect calls directly: media round-trip delay between them drops measurably versus today (no server round trip), and the server relays zero media bytes for such calls.
- **SC-002**: On a deployment with the direct-path endpoint enabled, calls between typical home networks connect directly in the common case, and the server's call-media bandwidth for those calls drops to zero.
- **SC-003**: Call setup success rate does not regress: every network scenario that could establish a call before this change still establishes one after it.
- **SC-004**: Call setup time does not regress by more than 300 ms in relay-only network scenarios (measured via the existing call-connect instrumentation, before vs after).
- **SC-005**: A user who enables "Always relay calls" never exposes a direct network address to call peers, verified by inspecting the connection on their device during calls on the same LAN and across the internet.
- **SC-006**: An operator can go from the docs to working internet-wide direct calls with a single configuration change plus one firewall rule.

## Zero-Knowledge Impact

*Required by constitution Principle I for any spec that touches the client/server boundary.*

- **What crosses the wire**: unchanged for content — call signalling (SDP offers/answers, connection candidates) stays sealed end-to-end over the existing per-pair Double Ratchet and is relayed by the server as opaque ciphertext; call media stays end-to-end encrypted between devices on every path. New on the wire: the credentials response may carry one additional advertised server address (the direct-path endpoint), which contains no user data; and clients may exchange short address-discovery packets with the server's UDP endpoint, which carry no user content.
- **What is encrypted**: everything that is encrypted today remains so, under the same schemes. This feature makes **no cryptographic change** — no new keys, no new sealing, no change to `messaging.ts` or the crypto core.
- **What metadata is unavoidably visible, and to whom**:
  - *To the server*: nothing new. The server already sees every client's IP on each HTTP/WebSocket connection and already learns who calls whom from signalling relay and room membership. Address discovery reveals the same client IP it already sees. Net effect is **less** data at the server: when a leg goes direct, the server no longer carries (or sees the volume/timing of) that leg's media. The flip side: the server can infer *that* a leg went direct from the absence of relay traffic (e.g. that two participants likely share a network) — strictly less information than it holds today, when it carries every leg and sees full volume/timing anyway.
  - *To the call peer*: new, bounded exposure — a direct connection necessarily reveals a network address to the accepted call peer (public address across the internet; local addresses stay masked by the browser's built-in obfuscation). This is peer-visible, never server-visible-beyond-today, and is fully suppressible per user via "Always relay calls" (FR-007). A relay-forced user's own address is never revealed; they may still receive the peer's candidates (Edge Cases).
- **Why this is acceptable**: calls only occur between mutually accepted parties; the exposure matches the long-standing default of comparable private messengers; the opt-out is one synced toggle; and the change strictly reduces the metadata concentration at the server.

## Assumptions

- Calls only ever happen between mutually accepted parties (contacts and joined group rooms), so revealing one's network address to a call peer by default is an acceptable, industry-standard trade-off (the same default as comparable private messengers); the synced preference is the opt-out for stricter threat models.
- Browsers mask local (LAN) addresses in call setup by default, so same-network direct paths do not expose raw private addresses to remote peers.
- The existing relay remains reachable on the standard TLS path (port 443) in all deployments; this feature never removes or weakens it, so restrictive-network users lose nothing.
- The e2e test environment (same-host browsers) will naturally use direct paths after this change; no test asserts that media is relayed.
- Media encryption is per-leg, end-to-end, independent of path; no cryptographic change is needed or allowed by this feature.
- The credentials response may gain an additional advertised entry, but its overall shape stays the same, so old clients and new servers (and vice versa) interoperate; the server ships before or with the client.
