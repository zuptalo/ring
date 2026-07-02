<!-- GENERATED FILE — do not edit by hand.
     Regenerate with: make roadmap   (or python3 scripts/roadmap-gen.py)
     Source of truth: specs/<NNNN-slug>/spec.md (Status line + directory number).
     CI fails if this file is out of date. -->

# Ring Roadmap

Every change ships through a numbered spec (see [CONTRIBUTING.md](CONTRIBUTING.md)).
Specs are grouped by category band; status moves
`planned → in-progress → in-review → shipped`.

## 📌 Planned Features (0001–0999)

| Spec | Title | Status |
|------|-------|--------|
| [0001](specs/0001-show-what-changed/spec.md) | Show what changed in the update toast (release-note delta) | 🟢 shipped |
| [0002](specs/0002-connections-and-friendship/spec.md) | Connections & Friendship | 🟢 shipped |
| [0003](specs/0003-zero-knowledge-social/spec.md) | Zero-Knowledge Social Wall | 🟢 shipped |
| [0004](specs/0004-group-call-reliability/spec.md) | Group call reliability, adaptive quality, caps, audio cues & busy signalling | 🔵 in-review |
| [0005](specs/0005-call-waiting-hold/spec.md) | Call waiting — hold, swap & drop between two concurrent calls | 🔵 in-review |
| [0007](specs/0007-adaptive-call-quality/spec.md) | Adaptive call quality — per-receiver, network- and screen-aware, with peer-reported health | 🔵 in-review |

## ⚡ Ad-hoc (1001–1999)

| Spec | Title | Status |
|------|-------|--------|
| [1001](specs/1001-smooth-tab-transitions/spec.md) | Smooth Tab Transitions | 🟢 shipped |
| [1002](specs/1002-local-dev-deployment/spec.md) | Local Dev Deployment Tooling + Hot Reload | 🟢 shipped |
| [1003](specs/1003-empty-chats-calls/spec.md) | Empty Chats/Calls Hint | 🟢 shipped |
| [1004](specs/1004-message-action-menu/spec.md) | Message Action Menu | 🟢 shipped |
| [1005](specs/1005-chat-history-scroll/spec.md) | Chat History Scroll Performance & Media Caching | 🟢 shipped |
| [1006](specs/1006-test-coverage-uplift/spec.md) | Test Coverage Uplift | 🟢 shipped |
| [1007](specs/1007-media-playback-and/spec.md) | Media Playback & Embedded Thumbnails | 🟢 shipped |
| [1008](specs/1008-one-tap-media/spec.md) | One-Tap Media Open & Inline Quick-React Bar | 🟢 shipped |
| [1009](specs/1009-activity-indicators/spec.md) | Ephemeral Activity Indicators (Typing & Recording) | 🟢 shipped |
| [1010](specs/1010-group-seen-receipts/spec.md) | Group "Seen" Receipts — Durable, Private, and Counted | 🟢 shipped |
| [1011](specs/1011-smooth-chat-history/spec.md) | Smooth Chat-History Scroll-Up (verified by a multi-user end-to-end exercise) | 🟢 shipped |
| [1012](specs/1012-scroll-to-bottom-button/spec.md) | Hovering "Scroll to Latest" Button in Chat | 🟢 shipped |
| [1013](specs/1013-jump-pill-seen-receipts/spec.md) | Expanding "Jump to Latest" Pill + Visibility-Driven Seen Receipts | 🟢 shipped |
| [1014](specs/1014-image-thumbnails-album/spec.md) | Multi-Size Image Thumbnails + Album-View Overhaul | 🟢 shipped |
| [1015](specs/1015-reliable-push-notifications/spec.md) | Reliable Push & Redesigned In-App Notifications | 🟢 shipped |
| [1016](specs/1016-9-am-local/spec.md) | 9-AM-Local Version-Announcement Push (Per-Device, Behind-Only) | 🟢 shipped |
| [1017](specs/1017-cache-reusable-assets/spec.md) | Cache reusable assets (animated emoji + avatars) so they aren't refetched | 🔵 in-review |
| [1018](specs/1018-media-sharing-and/spec.md) | Media Sharing & Viewer Improvements | 🔵 in-review |
| [1019](specs/1019-hidden-chats-pin/spec.md) | Hidden Chats Locked Behind a PIN | 🔵 in-review |
| [1020](specs/1020-mentions-group-chats/spec.md) | @mentions in group chats | 🔵 in-review |
| [1021](specs/1021-support-contributions/spec.md) | Support the project (pay-what-you-want contributions) | 🔵 in-review |
| [1024](specs/1024-resilient-posting-and-storage/spec.md) | Resilient posting & on-device storage management | 🔵 in-review |
| [1025](specs/1025-app-ux-polish/spec.md) | App-wide UX polish and fixes | 🔵 in-review |
| [1026](specs/1026-friends-only-and-settings-refinements/spec.md) | Friends-only messaging with privacy, settings and help refinements | 🔵 in-review |
| [1027](specs/1027-harden-hidden-chats/spec.md) | Harden Hidden Chats + One-Hidden-One-Visible Per Person | 🔵 in-review |
| [1028](specs/1028-robust-audio-and/spec.md) | Robust Calls + Add-to-Call (Merge Incoming, Add People) | ⚪ planned |

## 🐛 Hotfixes & Bug Fixes (2001+)

| Spec | Title | Status |
|------|-------|--------|
| [2001](specs/2001-stabilize-message-status/spec.md) | Stabilize message status reporting around downloaded-blob receipts | 🟢 shipped |
| [2002](specs/2002-media-thumbnails-stay/spec.md) | Media Thumbnails Stay Thumbnails (no autoplay storm) | 🟢 shipped |
| [2003](specs/2003-android-install-gate/spec.md) | Fix Android install-gate false "browser can't install" warning | 🟢 shipped |
| [2004](specs/2004-unify-app-notifications/spec.md) | Unify in-app notifications/toasts + user-friendly "What's new" | 🟢 shipped |
| [2005](specs/2005-pause-resume-during/spec.md) | Video-message recording — stop & review before sending, clean start, right-sized, out of the gallery | 🟢 shipped |
| [2006](specs/2006-install-page-guidance/spec.md) | Install-page guidance for a Play Protect "older Android" block | 🟢 shipped |
| [2007](specs/2007-video-hd-sd/spec.md) | HD/SD video sends are transcoded for real on device | 🔵 in-review |
| [2008](specs/2008-fast-first-call-connect/spec.md) | Make the first call connect as fast as a call-waiting second call | 🔵 in-review |
| [2009](specs/2009-single-call-waiting-slot/spec.md) | Only one caller may wait in call-waiting; further callers get busy | 🔵 in-review |
| [2010](specs/2010-nav-notification-robustness/spec.md) | Navigation & notification robustness | 🔵 in-review |
| [2011](specs/2011-hold-ui-and-1to1-diag/spec.md) | Call on-hold visualization & 1:1 diagnostics | 🔵 in-review |
| [2012](specs/2012-call-invite-recovery/spec.md) | Call invite recovery & honest ringing | 🔵 in-review |
| [2013](specs/2013-peer-resume-countdown/spec.md) | Mirror the resume countdown for the swapper | 🔵 in-review |
| [2014](specs/2014-notif-title-and-auth/spec.md) | Notification title tidy & generic-fallback diagnosis | 🔵 in-review |
| [2015](specs/2015-sw-preview-ratchet/spec.md) | Background notifications decrypt queued messages reliably | 🔵 in-review |
| [2016](specs/2016-sw-no-spurious-generic/spec.md) | Stop background notifications showing a generic placeholder when there's nothing new | 🔵 in-review |
| [2017](specs/2017-sw-burst-coalesce/spec.md) | Coalesce burst notifications into one clean per-chat notification | 🔵 in-review |
