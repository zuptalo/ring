# Showcase screenshots

Capture marketing-ready screenshots of the Ring UI across device sizes and themes.
It boots the same isolated stack as the e2e suite (`e2e/global-setup.ts`: an
isolated `ringd` on `:8081` + a fresh `ring_e2e` DB + a test Vite on `:5174`),
registers a passwordless account, seeds a curated demo dataset through the dev-only
`window.__ringTest.seedShowcase()` hook (see `src/services/showcase-seed.ts`), and
screenshots each key screen.

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
- **screens**: auth, chats, a rich chat, calls, contacts, group info, settings, profile

## Notes

- Pure screenshots, no live calls — so no fake-media flags are needed. An
  active-call screen would need two real accounts + WebRTC (the e2e harness can do
  that) and is a future addition.
- The seed is deterministic; tweak the dataset (people, messages, media) in
  `src/services/showcase-seed.ts`. It's dev-only and tree-shaken from prod.
- To capture a subset, pass a Playwright project: `npm run showcase -- --project=iphone`.
