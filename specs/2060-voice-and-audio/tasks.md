---
description: "Task list for spec 2060 — voice/audio blank on chat-list open"
---

# Tasks: Voice/audio must not render blank when a chat is opened from the list

**Tests**: REQUIRED (2001+ hotfix). Red first.

## Phase 1: Baseline + supply chain
- [x] T001 `npm run build` + `npx vitest run` green on the untouched branch
- [x] T002 Docker Scout scan of `zuptalo/ring:1.0.32`; apply fixable advisories — `x/net` 0.56.0
      (CVE-2026-46600), `x/text` 0.39.0 (CVE-2026-56852) in `server/go.mod`; `go mod tidy`
- [x] T003 `go build ./... && go vet ./... && go test ./...` green after the bump
- [x] T004 Bump `package.json` to 1.0.34 (start of a new release cycle)

## Phase 2: RED (Constitution III gate)
- [x] T005 `e2e/chat-open-media-render.spec.ts`: open a chat from the LIST (tap its row) with a
      voice message; assert `.bubble .vp` renders. Plus audio-card and (regression) photo cases
- [x] T006 Run it and observe voice + audio FAIL (0 players) while photo passes — the memo freezes
      poster-less media that resolves after first paint

## Phase 3: Fix (US1/US2)
- [x] T007 Add `mediaInfo[m.mediaId!]?.url` to the bubble `v-memo` deps in `ChatDetailPage.vue`, so
      a poster-less message re-renders when its media resolves
- [x] T008 Run the new spec — all cases pass

## Phase 4: Gates
- [x] T009 `npm run build` + `npx vitest run` (1310) green
- [x] T010 Regression: voice-pending (2058), playback-speed (2059), chat-media-scroll, media-viewer
      — green (the two viewer clear/delete tests are pre-existing flake; 9/9 with retries)
- [x] T011 Flip spec Status to shipped + `make roadmap`
- [ ] T012 Ship: PR to develop → merge → release PR develop→main (1.0.34)
