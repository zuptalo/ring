# Showcase screenshots

Capture marketing-ready screenshots of the Ring UI across device sizes and themes.
It boots the same isolated stack as the e2e suite (`e2e/global-setup.ts`: an
isolated `ringd` on `:8081` + a fresh `ring_e2e` DB + a test Vite on `:5174`),
registers a passwordless account, seeds a curated demo dataset through the dev-only
`window.__ringTest.seedShowcase()` hook (see `src/services/showcase-seed.ts`), and
screenshots each key screen.

## Media assets

Real photos/video/voice audio and portrait avatars live in `showcase/media/`
(gitignored — never committed, since they may be personal photos or third-party
stock content). `capture.spec.ts` reads them off disk and hands them to
`seedShowcase()` as data URLs. Expected layout:

```
showcase/media/
  avatars/{self,alice,daniel,sofia,mom,tomas}.jpg
  photos/{cocktail,pastry,arena1,arena2}.jpg
  video/dog.mp4, video/dog-poster.jpg
  voice/voice.m4a
```

`ffprobe` (part of `ffmpeg`, `brew install ffmpeg`) must be on `PATH` — the spec
uses it to read the video/voice clip's real duration and the video's dimensions
rather than hardcoding them.

## Run

```sh
make db-up                                 # Docker Postgres (once)
npx playwright install webkit chromium     # iPhone/iPad use WebKit; Pixel/Desktop use Chromium
npm run showcase
```

> Spec 1015: the redesigned in-app notification banner (translucent green, anchored
> below the header, dismissible) should be reviewed here across devices + light/dark.
> A capture state that stages the banner is a TODO for `capture.spec.ts`; until then
> review it via `make start` + the `drive/` harness or the `notifications-inapp.spec.ts`
> e2e (which asserts its geometry).

Output lands in `showcase/output/<device>/<theme>/NN-screen.png` (gitignored):

- **devices**: `iphone`, `ipad` (WebKit → iOS-mode styling), `android`, `desktop` (Chromium)
- **themes**: `light`, `dark`
- **screens**: auth, chats, a rich chat (photo/voice/reply/reactions), a group with an
  album + video message, the Wall feed, a Wall post detail, calls, contacts, a contact
  detail page, a chat's all-media grid, settings, profile, about

## Notes

- Pure screenshots, no live calls — so no fake-media flags are needed. An
  active-call screen would need two real accounts + WebRTC (the e2e harness can do
  that) and is a future addition.
- The seed is deterministic; tweak the dataset (people, messages, media) in
  `src/services/showcase-seed.ts`. It's dev-only and tree-shaken from prod.
- To capture a subset, pass a Playwright project: `npm run showcase -- --project=iphone`.

## Known bug: ChatDetailPage corrupts its paint with 3+ messages on a cold mount

`ChatDetailPage` can render the same message bubble (`.bubble[data-mid]`) more than
once — and drop others — the first time a chat with 3+ messages is opened after a
fresh app load. Vue itself throws inside its own patch internals:

```
TypeError: Cannot read properties of null (reading 'nextSibling')
    at patchKeyedChildren → patchChildren → processFragment → patch
TypeError: Cannot read properties of null (reading 'emitsOptions')
    at shouldUpdateComponent → updateComponent → processComponent → patch
```

**Isolated and bisected** (register → seed N plain-text messages into an otherwise-
empty chat → hard-navigate straight into it):

- 2 messages loaded at mount: renders correctly, every time.
- 3+ messages loaded at mount: corrupts, every time — deterministic, not a rare
  race. Retrying the same navigation (hard reload or a soft client-side
  click-through alike), even a dozen-plus times, does **not** clear it.
- Ruled out as causes: real photo/voice/video media, reactions, `replyTo`,
  per-message `seenReportedAt` (whether a "seen" write fires on mount), and
  write-batching (a loop of individual `put()` calls vs. one `bulkPut` — one
  transaction, one change-bus notification — made no difference).
- **Does not** reproduce when messages arrive one at a time into an *already-open*
  chat (`useChatHistory`'s incremental `reconcile()` path) — only when 3+ are
  already present at the chat's very first `reload()`. This is presumably why nothing
  in the existing e2e suite (which builds conversations up message-by-message) has
  caught it, and why real usage is unlikely to hit it (a chat you're opening for the
  first time this session almost always already has its history loaded before you
  ever look at it — the same shape as the working case here, not the broken one).

**Worked around, not fixed**, in this harness: `showcase-seed.ts` seeds Alice's chat
with just its first 2 messages up front, and `seedAliceFollowup()` — called from
`capture.spec.ts` once the chat is already open — appends the rest (voice message,
photo with a reaction, a reply, the closing text) live, the same way a real
conversation accumulates. The underlying `ChatDetailPage`/`useChatHistory` bug is
real and still there; it just isn't triggered by this specific seed shape anymore.
Whether it reproduces against a **production build** (`npm run build` + preview)
rather than the dev server this harness runs against is still open — worth a proper
investigation (and likely a spec/hotfix) outside this screenshot harness's scope.
