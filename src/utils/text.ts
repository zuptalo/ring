/**
 * Tidy an outgoing message before it's sent: strip trailing spaces on each line,
 * collapse runs of blank lines to at most one, and drop leading/trailing blank
 * lines, so messages don't carry unnecessary vertical space. Shared by the main
 * chat composer and the notification quick-reply so both behave identically.
 */
export function normalizeOutgoing(text: string): string {
  return text
    .replace(/[^\S\n]+$/gm, '') // trailing spaces/tabs per line
    .replace(/\n{3,}/g, '\n\n') // at most one blank line between paragraphs
    .trim(); // leading/trailing blank lines + whitespace
}

/**
 * Capitalize the first letter for display (e.g. "ada" → "Ada"), leaving the rest
 * untouched so existing casing in multi-word names is preserved. Non-destructive:
 * used at render time and when seeding the profile name from the username.
 */
export function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

