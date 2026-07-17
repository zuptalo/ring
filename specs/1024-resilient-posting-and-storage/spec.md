# Feature Specification: Resilient posting & on-device storage management

**Feature Branch**: `feat/1024-resilient-posting-and-storage`

**Created**: 2026-06-30

**Status**: shipped

**Input**: User description: "When sharing media to the Wall (and selecting media in chat), make
posting resilient: tapping Share should dismiss the composer immediately and show a pending
placeholder + progress at the top of the Wall while the upload runs in the background. A post is
only 'made' once the backend has confirmed every item landed — its disappear timer starts then. If
the app is closed mid-upload, the next open offers Retry or Cancel for the unfinished post. Cache
the selected media internally so removing the source mid-flight doesn't break it. Guard available
device storage when selecting items (chat or wall), since encoding/resizing needs headroom; warn to
free space rather than failing halfway."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Share and move on; the post finishes itself (Priority: P1)

I pick a few photos/videos (and maybe a voice clip), tap **Share**, and the composer closes at
once. A placeholder for my post appears at the **top of the Wall** with a progress bar; I can keep
scrolling, switch tabs, or close the app while it uploads. The post becomes "real" only once the
server has every item, and its "disappears in…" countdown starts from that moment — not from when I
tapped Share.

**Why this priority**: This is the core of the request and the biggest UX win — sharing stops
blocking the user, and the post's lifetime reflects when it actually landed, not a guess.

**Independent Test**: Stage media, tap Share, confirm the composer dismisses immediately and a
pending card with progress shows on the Wall; confirm the post flips to a normal post (with a fresh
countdown) only after all items upload.

**Acceptance Scenarios**:

1. **Given** staged media in the composer, **When** I tap Share, **Then** the composer closes
   immediately and a pending post (thumbnails + progress) appears at the top of the Wall.
2. **Given** an uploading post, **When** I navigate away or background the app, **Then** the upload
   continues and completes.
3. **Given** all items have uploaded and the server confirmed them, **When** the post finalizes,
   **Then** it renders as a normal post and its disappear timer starts at that confirmation time.
4. **Given** an uploading post, **When** I remove or de-stage the source media, **Then** nothing
   breaks — the outbox owns its own cached copies.

### User Story 2 - Pick up where it left off after the app closes (Priority: P1)

If the app is closed (or crashes, or loses network) before a post finishes uploading, the next time
I open the app it **auto-retries once**; if that still doesn't finish, the post is shown as pending
with **Retry** or **Cancel**. Cancel removes the post and its cached media; Retry resumes from where
it stopped — only the items the server hasn't confirmed are re-sent.

**Why this priority**: Without persistence, a backgrounded/killed app silently loses the post — the
exact "worse than before" failure the user called out. Pairs with US1 to make posting trustworthy.

**Independent Test**: Start an upload, kill the app mid-flight, reopen — confirm it auto-resumes and
finishes; force a failure and confirm Retry/Cancel appear, Retry resumes only the unconfirmed items,
and Cancel removes the post (and its cached blobs).

**Acceptance Scenarios**:

1. **Given** an upload interrupted by app close/crash/offline, **When** I reopen the app, **Then**
   the system auto-retries once and the post finishes if it can.
2. **Given** the automatic retry fails, **When** I see the pending post, **Then** it offers **Retry**
   and **Cancel**.
3. **Given** a partly-uploaded post (some items confirmed), **When** I Retry, **Then** only the
   not-yet-confirmed items are re-sent.
4. **Given** a pending post, **When** I tap Cancel, **Then** the post and its cached media are
   removed and no envelope is sent.

### User Story 3 - Warned before I run out of space (Priority: P2)

When I select media to share (in chat or on the Wall), if there isn't enough free space for the
encode/resize work, I'm told **before** anything starts — with a hint to free up space and come
back — rather than failing halfway through a long list.

**Why this priority**: Prevents the degraded mid-list failure the user described; cheap insurance
that improves trust, but secondary to the post actually surviving.

**Independent Test**: Simulate low free space, select media exceeding the estimated need, confirm a
clear up-front warning (with a free-space hint) and that no partial encode/upload begins.

**Acceptance Scenarios**:

1. **Given** low available storage, **When** I select media whose estimated working size exceeds
   free space, **Then** I see an up-front warning to free space, and the share does not start.
2. **Given** an upload already running, **When** the device runs out of space mid-encode/upload,
   **Then** the post is marked failed with a "free up space and retry" hint (not a silent stall).

### Edge Cases

- App killed mid-encode vs mid-upload vs after some-but-not-all items uploaded (partial confirm).
- Network drops and recovers during upload.
- Storage exhausted mid-flight.
- Several pending posts queued at once (ordering, independent retry).
- User cancels a pending post while one of its items is mid-upload.
- Device clock skew (the "made at" time comes from confirmation, not the device tap time).
- A cached blob fails to read back on resume (corrupt) → surface as failed, not crash.
- Zero-knowledge: cached working copies are plaintext-at-rest locally (same class as other local
  media); only sealed ciphertext is ever uploaded.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On Share, the system MUST persist a pending-post record — including its own copies of
  the selected media — to a local outbox, then dismiss the composer immediately.
- **FR-002**: The relevant surface MUST render its pending items live with progress + per-item
  state — the Wall feed shows pending posts at the top; a chat thread shows its pending media
  message in place — updating as the upload proceeds.
- **FR-003**: A background worker MUST process pending posts (encode/resize → upload each item →
  seal + send the post envelope), resuming automatically on app start and on regained connectivity.
- **FR-004**: A post MUST be considered "made" only after the backend confirms receipt of **all**
  items and the envelope; its disappear/lifetime timer MUST start at that confirmation time.
- **FR-005**: On app start, the system MUST AUTO-RETRY each interrupted pending item once; only if
  that automatic attempt fails MUST it surface **Retry / Cancel** to the user.
- **FR-006**: Cancel MUST delete the pending post and all its cached working media; Retry MUST
  resume without re-selecting media.
- **FR-007**: Because the system caches its own copies (FR-001), removing or de-staging the source
  media after Share MUST NOT affect the in-flight post.
- **FR-008**: On successful finalization, the system MUST delete the cached working copies (no
  permanent duplication beyond the normal stored post media).
- **FR-009**: When selecting media (chat or Wall), the system MUST estimate the working storage
  needed (selected size × an encode headroom factor) against available free space and warn the user
  up front when it won't fit, without starting any encode/upload.
- **FR-010**: If storage is exhausted mid-flight, the system MUST mark the post failed with a
  free-space hint and keep it retryable (no silent stall, no partial post).
- **FR-011**: The zero-knowledge boundary MUST hold: only sealed ciphertext is uploaded; cached
  working copies are local-only and never leave the device in the clear.
- **FR-012**: The resumable outbox MUST cover BOTH Wall posts AND chat media sends — an interrupted
  chat media send persists and resumes the same way a Wall post does.
- **FR-013**: On app start, an interrupted post MUST be auto-retried once before the user is asked
  (so most posts simply finish on reopen with no action).
- **FR-014**: The system MUST track per-item backend confirmation, and a retry (auto or manual)
  MUST resume only the not-yet-confirmed items — never re-uploading items the backend already has.

### Key Entities *(include if feature involves data)*

- **Pending post (outbox item)**: a not-yet-confirmed post. Attributes: id; ordered media items
  (each with a cached working blob, kind, name, duration, poster); caption; audience; chosen
  lifetime; status (uploading / failed / canceled); per-item + overall progress; failure reason;
  attempt count. Relationship: becomes a normal **Post** on full confirmation, then is removed.
- **Storage estimate**: available free space vs the projected working size of a selection
  (selected bytes × headroom factor); drives the up-front guard.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Tapping Share dismisses the composer and shows the pending post on the Wall in under
  ~300 ms (no waiting on encode/upload).
- **SC-002**: A post interrupted by app close/crash/offline is still present and completable on next
  open in 100% of cases — never silently lost.
- **SC-003**: No post is ever shown to its audience until the backend has confirmed every item; the
  disappear timer reflects confirmation time, not Share time.
- **SC-004**: When free space is insufficient, the user is warned before any encode begins — zero
  half-completed shares due to running out of space mid-list.
- **SC-005**: Removing the source media after Share never affects a successful post (0 failures
  attributable to source removal).
- **SC-006**: After a post finalizes or is canceled, its cached working copies are gone (no storage
  leak).

## Assumptions

- Reuses the existing media pipeline (compress/resize, blob upload, sealed post envelope) and the
  Wall feed rendering; this spec adds the outbox, the background worker, the pending UI, and the
  storage guard around them.
- The outbox + cached working blobs live in IndexedDB (the device's offline-first source of truth);
  a DB version bump adds the store.
- `navigator.storage.estimate()` (or equivalent) is available for the storage guard; where it isn't,
  the guard degrades to a best-effort/no-op rather than blocking sharing.
- Zero-knowledge boundary is non-negotiable: server only ever receives ciphertext + opaque blob ids.
- The resumable outbox covers both Wall posts and chat media sends (FR-012); the storage guard
  likewise covers both chat and Wall media selection.
- Interrupted uploads auto-retry once on reopen before asking the user (FR-013), and retries resume
  only the unconfirmed items via per-item confirmation tracking (FR-014).

## Zero-Knowledge Impact

- **What crosses to the server**: unchanged from today — only **sealed ciphertext blobs** (existing
  `uploadBlob`) and the **sealed post/message envelope** (existing `createPost` / message send), plus
  opaque blob ids and the same recipient routing already used. This feature adds **no new plaintext,
  fields, or endpoints** on the wire.
- **New local plaintext**: the outbox caches **working copies of the selected media (plaintext) in
  IndexedDB** until the post finalizes — the same class/treatment as the existing `media` store
  (device encryption + PIN-lock gate the app; not separately AEAD-wrapped). Copies are deleted on
  finalize or cancel (FR-008) — no lingering plaintext.
- **Confirmation is metadata-free**: per-item confirmation is just the server's existing blob-id and
  2xx responses; the server learns nothing new about content or audience.
- **Timestamps**: `createdAt`/`expiresAt` remain client-set on the sealed envelope exactly as today;
  the only change is *when* (at confirmation rather than at Share).
- **Checklist**: `/speckit-checklist` is REQUIRED (Principle I) and must confirm the at-rest stance
  of the cached blobs before implementation.

## Out of Scope

- Background upload while the app is fully terminated by the OS (no service-worker upload queue in
  v1); resume happens on next app open.
- Editing a pending post's contents after Share (only Retry/Cancel).
- Cross-device handoff of an in-flight post.
