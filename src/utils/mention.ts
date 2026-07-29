/**
 * (spec 1064) @mention handle parsing — ONE definition of what a handle looks like, shared by
 * every site that reads or writes one.
 *
 * Why this module exists: the charset was previously inlined in four separate regexes (render,
 * autocomplete query, pick-insert, and the send-time resolve), and all four omitted the dot that
 * usernames are allowed to contain. A handle like `parham.hoseini` therefore matched only as
 * `parham`, which resolves to nobody — so the mention rendered as raw text AND, far worse, the
 * send-time resolve produced an EMPTY mentions array. That array is what marks the frame as a
 * mention, so a person whose handle contains a dot was never notified, never pierced a mute, and
 * never lit the "@" badge. Keeping the charset here means the render and the send can't disagree.
 *
 * The charset mirrors the username rule enforced by BOTH sides (`USERNAME_RE` in services/auth.ts
 * and `usernameRE` in the server's internal/api/username.go): letters, digits and underscore,
 * with dots allowed only INSIDE — never leading or trailing.
 */

/** A handle body: starts and ends with an alphanumeric/underscore, dots permitted between. */
const HANDLE = '[A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_])?';

/**
 * Handles must sit at the start of the text or follow whitespace. That boundary is what keeps an
 * email address out of the mention path — now that dots are legal, an unguarded scan would read
 * `foo@bar.com` as a mention of `bar.com`. Emails are recognised separately as tappable entities,
 * so a mention must never swallow one.
 */
const SCAN = new RegExp(`(^|\\s)@(${HANDLE})`, 'g');

/** While TYPING, a trailing dot is still a valid prefix (`@parham.` on the way to
 *  `@parham.hoseini`), so the picker must stay open for it — unlike a completed handle. */
const QUERY = /(?:^|\s)@([A-Za-z0-9_.]*)$/;

export interface MentionToken {
  /** The handle without the leading '@', exactly as written. */
  handle: string;
  /** Index of the '@' in the source text. */
  start: number;
  /** Index one past the last handle character. */
  end: number;
}

/**
 * Every @handle token in `text`, in order, with the offsets a renderer needs to slice around
 * them. Offsets point at the '@' itself, not the boundary character before it.
 */
export function findMentions(text: string): MentionToken[] {
  const out: MentionToken[] = [];
  SCAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCAN.exec(text))) {
    const start = m.index + m[1].length; // skip the consumed boundary char (empty at string start)
    const end = start + 1 + m[2].length;
    out.push({ handle: m[2], start, end });
    // Resume AT the token's end so the character following it can serve as the next boundary
    // ("@a @b" must yield both), rather than after the boundary the engine would otherwise eat.
    SCAN.lastIndex = end;
  }
  return out;
}

/** The @query being typed at the very end of `text` (caret position), or null when the caret
 *  isn't in a mention. Empty string means "@" was just typed — the picker should open. */
export function mentionQueryAt(text: string): string | null {
  const m = QUERY.exec(text);
  return m ? m[1] : null;
}

/** Replace the in-progress @query at the end of `text` with a chosen handle, leaving a trailing
 *  space so typing continues naturally. Preserves the boundary character before the '@'. */
export function replaceMentionQuery(text: string, username: string): string {
  return text.replace(/(^|\s)@[A-Za-z0-9_.]*$/, `$1@${username} `);
}

/**
 * (spec 1064) Rewrite `@handle` tokens as `@Display Name` for the handles `nameFor` recognises,
 * so a notification reads the way the chat bubble does — with the name you know a person by,
 * including a local rename — instead of a raw directory handle.
 *
 * Unknown handles are left exactly as written: a plain "@word" that resolves to nobody is not a
 * mention and must not be reworded. Pure (no storage access) so the service worker can use it on
 * the push path alongside the page.
 */
/** The minimum a directory entry needs for mention naming — structural, so both the page's
 *  Contact rows and the service worker's copies satisfy it without importing the db types. */
export interface MentionNamed {
  name: string;
  username?: string;
}

/** Build a handle → display-name resolver over the people this device knows. `name` is already
 *  the locally-renamed name where one was set, so a rename flows through for free. */
export function mentionNameResolver(people: readonly MentionNamed[]): (handle: string) => string | undefined {
  const byHandle = new Map<string, string>();
  for (const p of people) {
    if (p.username && p.name) byHandle.set(p.username.toLowerCase(), p.name);
  }
  return (handle) => byHandle.get(handle);
}

export function substituteMentionNames(
  text: string,
  nameFor: (handle: string) => string | undefined,
): string {
  const toks = findMentions(text);
  if (!toks.length) return text;
  let out = '';
  let last = 0;
  for (const t of toks) {
    const name = nameFor(t.handle.toLowerCase());
    if (!name) continue; // not a known mention → leave the raw token in place
    out += text.slice(last, t.start) + '@' + name;
    last = t.end;
  }
  return out + text.slice(last);
}
