// Guardrail: the GitHub-release Markdown generator (scripts/release-notes-md.mjs)
// duplicates the filter + prettify rules from release-notes.ts so it can run in the
// release workflow without a TS toolchain. This test fails if the two ever diverge,
// so the release page and the in-app "What's new" always word a change the same way.
import { describe, it, expect } from 'vitest';
import { isUserFacing as tsIsUserFacing, prettify as tsPrettify } from './release-notes';
// @ts-expect-error — plain ESM script, no type declarations by design.
import { isUserFacing as mdIsUserFacing, prettify as mdPrettify } from '../../scripts/release-notes-md.mjs';

// A corpus that exercises every rule: each Conventional-Commit type, scopes, `!`,
// non-conforming subjects, and every trailing-reference / aside form prettify strips.
const CORPUS = [
  'feat(chat): add reactions to messages',
  'fix(call): connect the first call as fast as a second one (spec 2008)',
  'fix(media): sharper thumbnails (#248)',
  'feat: zero-knowledge social Wall (spec 0003)',
  'perf(sync): batch idb writes',
  'security(auth): rotate device tokens on reinstall',
  'feat(chat)!: drop the quality picker',
  'fix(wall): honest progress (+ flaky test fix)',
  'ci: give release tagging a committer identity',
  'chore: bump version to 1.0.0',
  'docs(spec): flip 16 shipped specs',
  'refactor(store): extract repo interface',
  'test(e2e): cover the Wall',
  'build(deps): bump vite',
  'style: gofmt',
  'deps: update libsodium',
  'Merge branch develop',
  'a bare subject with no conventional prefix',
  'fix(chat): reach you through muted groups (spec 1048 US2/US3)',
  "feat(contacts): set an emoji as a contact's photo (spec 1054) (#1012)", // stacked refs
  'feat(wall): efficient videos upload as-is (spec 2038) (#1004)', // stacked refs
];

describe('release-notes-md.mjs parity with release-notes.ts', () => {
  it('classifies user-facing vs noise identically', () => {
    for (const subject of CORPUS) {
      expect(mdIsUserFacing(subject), subject).toBe(tsIsUserFacing({ sha: 'x', subject }));
    }
  });

  it('prettifies subjects identically', () => {
    for (const subject of CORPUS) {
      expect(mdPrettify(subject), subject).toBe(tsPrettify(subject));
    }
  });
});
