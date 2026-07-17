#!/usr/bin/env node
// Generate a GitHub Release body (Markdown) for a tag: the user-facing changes since
// the previous STABLE release, filtered and prettified with the SAME rules the in-app
// "What's new" flow uses — so the release page and the update toast tell one story
// instead of three (this replaced a raw `git log` on the GA side and GitHub's
// `--generate-notes` PR-dump on the RC side, both of which leaked ci/docs/chore noise).
//
// Filtering + wording are mirrored from src/services/release-notes.ts; the parity
// test src/services/release-notes-md-parity.test.ts fails if the two ever drift.
//
// Base selection: a release's notes are diffed from the previous STABLE tag that is an
// ANCESTOR of this tag (prerelease `-rc` tags are ignored as a base). So a GA release
// shows the whole product delta since the last stable — not just the gap since its RC —
// and it works for regenerating an older tag's notes too (only tags reachable from that
// tag are considered).
//
// Usage: node scripts/release-notes-md.mjs --tag v1.2.3 [--repo owner/name]
import { execFileSync } from 'node:child_process';

// ── rules mirrored from src/services/release-notes.ts (keep in sync; parity-tested) ──
export const NOISE_TYPES = new Set(['build', 'chore', 'ci', 'deps', 'docs', 'refactor', 'style', 'test']);
const CC_TYPE = /^([a-z]+)(\([^)]*\))?!?:/i;
const CC_PREFIX = /^[a-z]+(\([^)]*\))?!?:\s*/i;
const TRAILING_REF = /\s*\((?:specs?\s*\d+[^)]*|#\d+|gh-\d+)\)\s*$/i;
const TRAILING_ASIDE = /\s*\(\+[^)]*\)\s*$/;

/** Conventional-Commit type of a subject in lowercase, or null when there's no prefix. */
export function commitType(subject) {
  const m = CC_TYPE.exec(subject.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Whether a subject describes a change a regular user cares about. */
export function isUserFacing(subject) {
  const t = commitType(subject);
  return t === null || !NOISE_TYPES.has(t);
}

/** Drop the `type(scope):` prefix, a trailing `(+ …)` aside and a trailing
 *  spec/issue/PR reference, then capitalize. Non-conforming subjects pass through. */
export function prettify(subject) {
  let stripped = subject.replace(CC_PREFIX, '').trim();
  // Strip stacked trailing refs — `… (spec 1054) (#1012)` — until neither matches.
  for (let prev = ''; prev !== stripped; ) {
    prev = stripped;
    stripped = stripped.replace(TRAILING_ASIDE, '').replace(TRAILING_REF, '').trim();
  }
  const text = stripped || subject.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
// ─────────────────────────────────────────────────────────────────────────────────────

const STABLE_TAG = /^v\d+\.\d+\.\d+$/;

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function isAncestor(a, b) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Build the Markdown body for `tag`, grouping user-facing changes by kind. */
export function buildNotes(tag, repo, opts = {}) {
  const log = opts.log || ((range) => git(['log', range, '--no-merges', '--format=%s']));
  const tags = opts.tags || git(['tag', '--list', '--sort=-v:refname']).split('\n').map((t) => t.trim()).filter(Boolean);
  const ancestor = opts.isAncestor || isAncestor;

  // Previous stable tag that is an ancestor of this tag (so regeneration of an older
  // tag ignores stable tags cut after it).
  const base = tags.find((t) => t !== tag && STABLE_TAG.test(t) && ancestor(t, tag)) || null;
  const range = base ? `${base}..${tag}` : tag;

  const subjects = log(range).split('\n').map((s) => s.trim()).filter(Boolean).filter(isUserFacing);

  const buckets = { security: [], feat: [], fix: [], other: [] };
  for (const s of subjects) {
    const t = commitType(s);
    if (t === 'security') buckets.security.push(prettify(s));
    else if (t === 'feat') buckets.feat.push(prettify(s));
    else if (t === 'fix') buckets.fix.push(prettify(s));
    else buckets.other.push(prettify(s)); // perf + non-conforming, still user-facing
  }

  const sections = [
    ['🔒 Security', buckets.security],
    ['✨ New', buckets.feat],
    ['🐛 Fixes', buckets.fix],
    ['⚡ Improvements', buckets.other],
  ];

  let out = '';
  for (const [title, items] of sections) {
    if (!items.length) continue;
    out += `### ${title}\n\n${items.map((i) => `- ${i}`).join('\n')}\n\n`;
  }
  if (!out) out += '_Maintenance release — internal changes only, nothing user-facing._\n\n';

  out += base
    ? `**Full Changelog**: https://github.com/${repo}/compare/${base}...${tag}\n`
    : `**Full Changelog**: https://github.com/${repo}/commits/${tag}\n`;
  return out;
}

function resolveRepo() {
  const explicit = arg('--repo');
  if (explicit) return explicit;
  try {
    const url = git(['config', '--get', 'remote.origin.url']).trim();
    const slug = url.replace(/^git@github\.com:/, '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (slug) return slug;
  } catch {
    /* fall through */
  }
  return 'zuptalo/ring';
}

function main() {
  const tag = arg('--tag');
  if (!tag) {
    console.error('usage: release-notes-md.mjs --tag <tag> [--repo owner/name]');
    process.exit(1);
  }
  process.stdout.write(buildNotes(tag, resolveRepo()));
}

// Run only when invoked as a script, not when imported by the parity test.
if (process.argv[1] && process.argv[1].endsWith('release-notes-md.mjs')) main();
