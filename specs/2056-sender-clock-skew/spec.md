# Feature Specification: Messages from a device with a wrong clock must not sort into the past

**Feature Branch**: `fix/2056-sender-clock-skew`

**Created**: 2026-07-27

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User report (with screenshots from both devices): "when chatting with someone in a different time zone on android, their messages get incorrect timestamp and even when they were sending me a new message it wouldn't just show up in the end, I had to leave the chat and come back in and scroll up to actually see the message they have sent … since they were showing up 1 hour before my time! I have not had this issue with iphone users in different time zone."

## Context: why this hotfix exists

A message carries the timestamp its **sender's** device stamped on it, and that timestamp decides both the displayed time and **where the message sits in the conversation**. Conversation order is therefore hostage to every participant's clock.

The reported pair, read off the two screenshots:

| message | sender's screen | recipient's screen | implied offset |
|---|---|---|---|
| "Salam 👋" (recipient → Android) | 14:03 | 15:33 | **+1:30** ✓ consistent |
| "Tt" (Android → recipient) | 15:35 | 13:05 | **−2:30** ✗ should be −1:30 |

The timezone difference is a genuine +1:30. Messages *to* the Android device convert correctly; messages *from* it arrive exactly **one hour early**. So the Android device's wall clock displays correctly to its owner while its actual UTC time is an hour behind — the signature of **stale timezone data** (the phone in the screenshot is on Android 11 / MIUI 12.0.3 with a 2021 security patch level, predating that region dropping DST). Its messages then sorted an hour into the recipient's past: they appeared **above** older messages instead of at the end, so a new message never showed up where the reader was looking — exactly the "leave the chat, come back, scroll up to find it" symptom.

This is not Android-specific in the code. It is "any sender whose clock is wrong" — a stale-tzdata phone, a manually-set clock, a device that lost its battery. iPhones ship timezone updates with the OS, which is why the reporter never saw it from them.

The recipient cannot detect this from the sender's timestamp alone, because "timestamp well in the past" is *also* exactly what a legitimate message queued while the recipient was offline looks like. The discriminator is a reference both sides already share and neither controls: **when the relay accepted the frame**. A genuinely-queued message's claimed time agrees with the relay's; a skewed sender's does not.

A secondary harm: the receive path feeds this untrusted timestamp into the push-zombie heuristics, which infer "this sat queued for ages" from a message's age. A sender running an hour behind forged that evidence on every message, pushing the recipient toward needless push-subscription rotation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A new message always arrives at the end of the chat (Priority: P1)

Whoever sends it, and whatever their device thinks the time is, a newly-received message appears at the bottom of the conversation.

**Why this priority**: The reported defect. Messages effectively go missing — the reader has no reason to scroll up, so a conversation silently stops working.

**Independent Test**: Send from a device whose clock is an hour slow and confirm the message lands last on the recipient's screen, after the message it replies to.

**Acceptance Scenarios**:

1. **Given** a sender whose clock is an hour behind, **When** they reply to my message, **Then** their reply appears after mine, at the end of the chat.
2. **Given** that same sender, **When** they send several messages, **Then** those keep their relative order.
3. **Given** a sender whose clock runs fast, **When** they message me, **Then** it does not sort into the future.
4. **Given** correctly-clocked participants in different timezones, **When** we chat, **Then** nothing changes — times still render in each reader's local zone.

---

### User Story 2 - A genuinely old message stays old (Priority: P1)

A message that really was sent hours ago while I was offline still shows its real time and its historical position.

**Why this priority**: The guard that keeps Story 1 from becoming a worse bug. Naively re-stamping every late message to "now" would collapse an offline backlog to the present and break the delivery-reliability signals that depend on honest message ages.

**Independent Test**: Receive a backlog after being offline and confirm the messages keep their original times and order.

**Acceptance Scenarios**:

1. **Given** messages sent while I was offline, **When** I reconnect, **Then** they appear with their original times, in their original order.
2. **Given** such a backlog, **When** it is applied, **Then** the queued-message reliability signals still see the real ages.

---

### User Story 3 - A skewed sender cannot trip my push-recovery heuristics (Priority: P2)

Another person's wrong clock does not cause my device to churn its push subscription.

**Why this priority**: Silent, self-inflicted damage — invisible to the user but it degrades notification reliability, the area specs 2043–2048 were spent stabilising.

**Independent Test**: Receive messages from a skewed sender and confirm no stale-drain / missed-wake signal is recorded.

**Acceptance Scenarios**:

1. **Given** a sender whose clock is an hour behind, **When** their messages arrive promptly, **Then** no "this sat queued" signal is recorded.
2. **Given** genuinely delayed messages from a correctly-clocked sender, **Then** those signals still fire as before.

---

### Edge Cases

- **A recipient whose OWN clock is wrong** must still order the conversation correctly — the comparison must not involve the reader's clock.
- **No reference available** (a server that does not supply one): behave exactly as today, trusting the sender.
- **Composed offline, sent much later**: the claim and the reference legitimately diverge, so the message is placed when it reached the conversation. Accepted trade-off — see Assumptions.
- **Half-hour timezone offsets** (+3:30, +5:45) must be caught as readily as whole-hour ones.
- **The sender's own copy** keeps the sender's own time; only the receiving side reconciles.

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire**: one extra integer on a delivered frame — the epoch ms at which the relay accepted it. No message content, and the ciphertext stays opaque.
- **Where processing happens**: the reconciliation is entirely client-side, on the recipient's device, after decryption.
- **Unavoidably-visible metadata**: none added. The relay already records when it accepted each frame (`relay_queue.created_at`, used today for retention and queue-age reporting). This hands the recipient — who is already receiving that very frame — a fact the server already had, and tells the server nothing new.
- **Why it stays zero-knowledge**: no new endpoint, no new stored field, no inspection of plaintext. The server does not learn the sender's clock, the correction, or anything about the message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A delivered message frame MUST carry the time the relay accepted it, on both live delivery and replay of a queued frame.
- **FR-002**: That value MUST be identical for both paths for a given message (a queued frame keeps the time it arrived, not the time it was drained).
- **FR-003**: On receive, the sender's claimed timestamp MUST be kept when it is consistent with the relay's time, and replaced by the relay's time when it is not.
- **FR-004**: The consistency tolerance MUST absorb ordinary latency and drift while remaining well below the smallest timezone offset (30 minutes).
- **FR-005**: The reconciliation MUST NOT consult the receiving device's clock, so a reader with a wrong clock still orders correctly.
- **FR-006**: Messages from a skewed sender MUST retain their relative order.
- **FR-007**: When no relay time is available, behaviour MUST be unchanged (trust the sender).
- **FR-008**: Queued-message reliability signals (stale-drain / missed-wake) MUST be skipped for a sender detected as skewed, and unchanged otherwise.
- **FR-009**: Both writers of received messages — the page and the service-worker drain — MUST apply the same reconciliation, so a message sorts identically whichever committed it.

### Key Entities *(include if feature involves data)*

- **Delivered frame**: gains a relay-receive timestamp (transport-level only; not persisted as a message field).
- **Received message**: its stored timestamp becomes a reconciled value rather than the sender's raw claim. No schema change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A message from a sender whose clock is an hour off appears at the end of the recipient's chat, never above older messages.
- **SC-002**: Messages from a skewed sender preserve their relative order.
- **SC-003**: A genuinely queued backlog keeps its original timestamps and order.
- **SC-004**: A recipient with a wrong clock still orders conversations correctly.
- **SC-005**: No stale-drain / missed-wake signal is recorded for a skewed sender; behaviour is unchanged for real delays.
- **SC-006**: Correctly-clocked participants across timezones see no change.

## Assumptions

- The relay's clock is a reasonable shared reference. It is already the sequencing authority for the queue, and the server is a single deployment with normal time sync.
- Placing an offline-composed message at the time it reached the conversation is acceptable, and is the safe direction: it can never sort a message into the distant past, which is the failure being fixed. The sender's own copy keeps their compose time.
- A 90-second tolerance separates the two cases cleanly: it far exceeds real latency and drift, and is far below the 30-minute minimum timezone quantum.

## Out of Scope

- Correcting the sending device's clock, or warning its owner that it is wrong.
- Showing timezone information in the UI, or rendering times in the sender's zone.
- Reordering or re-timestamping messages already stored from before this fix.
- Replacing timestamp-based ordering with a server sequence number (a larger change; this keeps timestamps as the ordering key and makes them trustworthy).
