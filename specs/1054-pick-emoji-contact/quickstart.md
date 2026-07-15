# Quickstart: Emoji contact photos + reset to their photo (spec 1054)

## Run locally

```sh
make start          # Postgres + ringd (hot reload) + Vite on :5173
```

Register two accounts (dev invite codes `RINGDEV1`..`RINGDEV9`), pair them
(Contacts → add by username), or drive it with the `drive/` harness.

## Verify the feature by hand

1. Open a contact → **Contact info** → tap **Change photo**.
2. The sheet shows **Take photo / Choose photo / Pick an emoji / Cancel**
   (no reset entry yet — nothing is overridden).
3. **Pick an emoji** → choose 😎 → the contact's picture becomes the emoji
   disc on the contact page, Contacts tab, chat list, and chat header —
   animated where emoji profile pictures animate.
4. Also give the contact a custom name via **Edit name**.
5. Reopen **Change photo** → the sheet now ends with **Reset to their photo**.
6. Tap it: the picture reverts to what the contact set for themselves; the
   custom name stays. The "Reset to their name & photo" row still resets both.
7. Offline check: airplane-mode the device, override the photo, reset — the
   picture still reverts immediately (last-known copy), and refreshes to the
   contact's current one on reconnect.

## Tests

```sh
npm run build                                        # typecheck gate
npx playwright test e2e/contact-emoji-avatar.spec.ts # this feature's e2e (needs `make db-up`)
npm run test:e2e                                     # full suite
```
