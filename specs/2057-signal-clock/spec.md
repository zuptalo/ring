# Feature Specification: Reactions and game moves still trust the sender's clock

**Feature Branch**: `fix/2057-signal-clock`

**Created**: 2026-07-28

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User report after 1.0.30: "There is a glitch when a new reaction happens in a chat and I am in the Chats list, the in app notification shows correctly, but that chat's last interaction preview is not updated unless I change from the chats to something else and come back to the list." Plus: "in the intro animation, the game pad height is too little compared to the other elements."

## Context: why this hotfix exists

**Spec 2056 reconciled MESSAGE timestamps against the relay's receive time, but not SIGNALS.** A reaction, game move, edit or poll vote carries its own `at` stamped by the sender's device, and two of those paths write it straight into the chat summary (`lastMessageTime`, `updatedAt`). The Chats list sorts on `lastMessageTime`.

So a reaction from the very device 2056 was written for — a phone whose clock runs an hour behind — drives the chat's `lastMessageTime` an hour **backwards**. Measured against a live pair with the reactor's clock shifted −1h: `chat row lastMessageTime vs my own message: -60 min`. Instead of rising to the top on a brand-new interaction, the chat **sinks down the list**, so the list does not show the interaction where the reader looks for it, even though the notification fired correctly.

This is the same class of defect as 2056 and the same fix: reconcile the sender's claim against when the relay accepted the frame.

**Not established:** the reporter also describes the preview text refreshing only after switching tabs and returning. That specific symptom could not be reproduced on the dev stack (the rendered row updated within ~1s in both a cold-open and an open-chat-then-back flow), so it is deliberately NOT claimed as fixed here. The ordering defect above is real, measured, and fixed; whether it fully accounts for what the reporter saw needs their confirmation.

**Rider (visual):** in the launch montage, every intermediate silhouette is uniform-scaled so its LONGEST edge hits one shared box. That punishes a wide, short shape: the controller is 90×49 raw, so fitting its width to 66 left it ~36 tall — the shortest symbol in the montage, against the camera's ~41 and the resolved shield's ~70. That is the "game pad height is too little" report.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A reaction lifts the chat to the top of the list (Priority: P1)

Someone reacts to my message; that chat moves to the top of the Chats list as the most recent interaction, whatever their device thinks the time is.

**Why this priority**: The reported defect. A new interaction that sorts into the past is effectively invisible in the list.

**Independent Test**: With a reactor whose clock is an hour behind, react to a message and confirm the chat's summary time does not move backwards.

**Acceptance Scenarios**:

1. **Given** a reactor whose clock runs an hour behind, **When** they react to my message, **Then** the chat's last-interaction time does not go backwards and the chat sorts as the newest interaction.
2. **Given** a correctly-clocked reactor, **When** they react, **Then** behaviour is unchanged.
3. **Given** a game move from a skewed-clock player, **When** it arrives, **Then** the same holds.
4. **Given** my OWN reaction, **When** I make it, **Then** it continues to use my own clock (unchanged).

---

### User Story 2 - The game pad reads at the same weight as the other intro symbols (Priority: P3)

The controller in the launch montage looks the same visual size as the phone, chat bubble and camera rather than squat.

**Why this priority**: Cosmetic polish on the first-run animation, no functional impact.

**Independent Test**: Compare the normalized height of each montage silhouette; the controller should no longer be the outlier.

**Acceptance Scenarios**:

1. **Given** the launch montage, **When** the controller is shown, **Then** its height is comparable to the other intermediate symbols.
2. **Given** the same montage, **When** it resolves, **Then** the final shield/ring app icon is unchanged.

---

### Edge Cases

- **A genuinely old queued reaction** (sent while the recipient was offline) must keep its real time — same reconciliation rule as 2056, not a blind re-stamp.
- **Per-user reaction last-write-wins** compares one user's own successive stamps and stays on the raw sender value, which is self-consistent; only the chat SUMMARY is reconciled.
- **Own reactions/moves** already use the local clock and must not change.
- **Wide silhouettes** may exceed the shared width box once a height floor applies; they must stay within the drawing viewBox and keep their own aspect ratio.

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire**: nothing new. It reuses the relay-receive time already added by spec 2056.
- **Where processing happens**: client-side, after decryption.
- **Unavoidably-visible metadata**: unchanged.
- **Why it stays zero-knowledge**: a local decision about which of two already-held timestamps to store.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An incoming reaction's contribution to the chat summary (`lastMessageTime`, `updatedAt`) MUST be reconciled against the relay's receive time, exactly as message timestamps are.
- **FR-002**: An incoming game move MUST do the same.
- **FR-003**: Locally-originated reactions and moves MUST keep using the local clock.
- **FR-004**: Per-signal last-write-wins comparisons MUST keep their existing semantics.
- **FR-005**: A genuinely queued-while-offline signal MUST retain its real time.
- **FR-006**: The launch montage MUST NOT let a wide silhouette collapse below a minimum normalized height; uniform scaling and the resolved app icon MUST be preserved.

### Key Entities *(include if feature involves data)*

- **Signal (`at`)**: the sender-stamped time on a reaction/move. Its use for the chat summary becomes a reconciled value. No schema change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reaction from a device an hour behind does not move the chat's last-interaction time backwards.
- **SC-002**: The chat sorts as the newest interaction after such a reaction.
- **SC-003**: Correctly-clocked reactions and own reactions are unchanged.
- **SC-004**: The controller silhouette is no longer the shortest symbol in the montage, and the final icon is unchanged.

## Assumptions

- Reactions and game moves are the signals whose sender time reaches the chat summary; other signals (edits, poll votes) affect their target message's own bookkeeping rather than list ordering, so they are left alone here.
- Equalising the controller's height with the camera's is the right visual target; the shield finale stays taller by design because it is the resolved app icon.

## Out of Scope

- The reporter's "preview only refreshes after switching tabs" symptom — not reproducible on the dev stack; see Context. Needs confirmation before any change is attempted.
- Reconciling signal times used purely for per-signal last-write-wins.
- Redrawing any montage silhouette; this only changes how they are scaled.
