# Feature Specification: Group Adds You Can Trust

**Feature Branch**: `feat/1052-group-adds-you`

**Created**: 2026-07-14

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: Settings audit (2026-07-14) found `privacy.groups` ("Who can add me to groups", Everyone/My contacts) fully unenforced — and structurally vacuous: pickers are contacts-only and contacts are mutual, so "Everyone" describes an adder that cannot exist in the honest UI. User decision after review: replace it with an "Ask before adding me to groups" toggle plus unconditional receiver-side hardening.

## Clarifications

### Session 2026-07-14

- Q: Wire enforcement for the existing chooser, remove it, or redesign? → A: **Redesign per recommendation** — drop the placebo chooser, add the approval toggle (default off = today's behavior), and harden the wire path regardless of any setting.
- Design fact driving FR-006: a bare group MESSAGE for an unknown group currently materializes the chat (`ensureGroupChat`), so any consent gate must also stop that path or it is bypassed by the first message.

## User Stories

### US1 - Ask before adding me to groups (P1)

With the new toggle ON, being added to any group — even by a friend — arrives as the existing group invitation: accept to join, decline to stay out. Off (default), friends' adds keep working instantly as today.

**Acceptance**: toggle ON: a contact's auto-add lands as an invitation (no group chat appears); accepting joins and converges the roster; declining removes you on the adder's side too. Toggle OFF: unchanged instant add.

### US2 - Strangers can never conjure a group onto your device (P1, unconditional)

A group add (create/update card) that would materialize a NEW group is honored only when its sender is someone you're connected with. From anyone else it arrives — at most — as an invitation. Bare group messages for a group you don't have never create it; they wait, and apply only after the group legitimately materializes.

**Acceptance**: a raw create card from a non-connected sender yields an invitation request, never a group chat; group messages arriving before the card (or before acceptance) don't create the chat and are present in the conversation after it materializes; expired parked frames vanish without residue.

### US3 - The placebo is gone (P2)

The Everyone/My-contacts chooser is removed; its key joins the never-reuse dead list (old synced snapshots may carry stale values). The Groups privacy screen now holds the single honest toggle.

## Requirements

- **FR-001**: Remove the `privacy.groups` control and key: schema node replaced, key deleted from the synced allowlist, added to the dead-key guard (never reuse — stale snapshots exist).
- **FR-002**: New toggle `privacy.groupAddApproval` (default false, synced): when true, ANY card that would join this device to a group converts to the existing group-invitation flow instead.
- **FR-003 (hardening, no setting)**: an auto-join create/update card that would materialize a group this device doesn't have is honored only from a CONNECTED sender; from anyone else it converts to an invitation. Roster updates for groups you're already in are unaffected.
- **FR-004**: Declining a group invitation (converted or ordinary) also emits a leave for that group, so an adder who already counted you as a member converges; a leave from a non-member is a no-op everywhere (idempotent).
- **FR-005**: Accepting a converted invitation joins via the existing accept-card path; the adder's roster already contains you and the accept is idempotent there.
- **FR-006**: A group message for a group this device doesn't have MUST NOT create the chat. Such frames are parked durably (bounded count, expiry) and replayed through the normal receive path when the group materializes (card honored or invitation accepted); expired frames are dropped cleanly. Decryption replay is safe by the same skipped-key idempotency the SW preview relies on (spec 1032).
- **FR-007**: Every path keeps hidden-chat reset tombstones and existing invite semantics intact (pre-join history stays out — invitations still never materialize the chat early).

## Zero-Knowledge Impact

None new on the wire: cards, invitations, accepts, leaves, and messages are the existing sealed frames. The server learns nothing it didn't; all trust decisions are receiver-side. (The removed key also leaves the synced snapshot over time — full-state prefs replace.)

## Success Criteria

- **SC-001**: e2e — toggle ON: contact's createGroup lands as an invitation; accept ⇒ member with converged roster; decline ⇒ absent from the adder's roster (leave observed). Toggle OFF suite (groups.spec, push-routing.spec) unchanged.
- **SC-002**: e2e — a create card from a NON-connected sender (dev hook) produces an invitation request and no chat; with the invitation declined, nothing remains.
- **SC-003**: e2e — messages sent to the group before acceptance appear in the chat after accepting; none exist before.
- **SC-004**: Unit — parked-frame queue is bounded and expiring; dead-key guard contains `privacy.groups`.
- **SC-005**: Full existing group/invite/game-group suites stay green.

## Addendum: chat-list riders (user-directed, same branch)

- **Hidden chats above the pinned area**: while revealed, hidden chats render as
  their own block directly under the "Hide hidden chats" affordance — ABOVE the
  pinned grid — and leave the grid/plain rows for the duration (the hidden
  section reads as one unit). e2e: document-order assertion in hidden-chats.spec.
- **Pinned grid scrolls the list**: tiles move from `touch-action: none` to
  `pan-y` — a vertical swipe starting on a tile now scrolls the list (the
  browser claims the pan; the drag controller's pointercancel path drops the
  pending press cleanly), while press-and-hold still lifts because the post-lift
  non-passive touchmove blocker owns the finger from LIFT_MS on. The 1045 drag
  suites stay green; real-device scroll feel is on the manual matrix.

## Assumptions

- `/speckit-checklist` not required: no wire change, no crypto change; the hardening tightens receiver-side authorization only (spec-1020 @everyone-validation precedent).
- The park queue reuses the locked-frame pending-queue pattern (ciphertext + sender + remoteId, replayed via receiveIncoming); cap 200 frames / 48h TTL.
