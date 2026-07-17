# Quickstart: Verifying 1025 (App-wide UX polish)

Manual verification per item, on the dev stack (`make start`) or a device on the develop image.
Automated coverage lives in the e2e specs listed in the plan.

1. **Deep-link back navigation (US1)**: Fully close the app. Trigger each notification (new message,
   Wall post, friend request, request-accepted, app-update, incoming call) and tap it. When the app
   opens on the target, press/swipe Back → you land on the Chats list, never a blank view.

2. **Media viewer video poster (US4)**: Send a video, open it in the full-screen viewer, swipe to it
   among other media → its poster fills the frame with a centered play control (no tiny image with
   blank margins), crisp on a retina display.

3. **Animations setting (US7)**: Open Settings → confirm exactly one "Animations" entry. Turn off
   the toggles → animated emoji stop animating and GIFs no longer autoplay.

4. **Vibrate (US8)**: Settings → Notifications → In-app notifications → confirm there is no Vibrate
   toggle and the section has no empty gap.

5. **Show preview + hidden precedence (US2)**: Turn "Show preview" off → a new message notification
   shows a generic title and body (no sender, no content). Turn it on → sender + preview appear. Send
   into a hidden chat with preview on → the notification stays generic.

6. **Hidden-chat swipe (US3)**: Unlock hidden chats, swipe a hidden row both directions → the action
   buttons appear immediately and the row content sits on an opaque background (no button
   bleed-through).

7. **Help cleanup (US9)**: Settings → Help → the Version shows the real app version; "Run self-test"
   is present and, when tapped, runs the crypto self-test to a pass/fail summary.

8. **Disappearing countdown (US5)**: Send and receive disappearing messages → visible spacing between
   the timestamp and the green countdown; on incoming messages the countdown is to the right of the
   timestamp.

9. **Calls area (US6)**: Place audio and video calls. Calls list + a call detail show dates as
   `YYYY-MM-DD`; on the detail the Video and Message buttons are swapped; a totals summary shows total
   audio minutes, total video minutes, and data used for audio, video, and combined.

## Gates before "done"

- `npm run build` (typecheck + build) green.
- `npx vitest run` green (new date + call-totals helper unit tests included).
- `npm run test:e2e` green (new/updated specs: deeplink-back, notification-preview, animations-setting, calls-summary).
- `cd server && go build/vet/test ./...` green (server untouched, should stay green).
