/** Human-friendly timestamp helpers for the chat/call lists. */

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Uses the device's local timezone automatically; forced to 24-hour format.
const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/** List-style: time today, "Yesterday", weekday this week, else date. */
export function formatTime(ts: number): string {
  const now = new Date();
  const today = startOfDay(now);
  const day = startOfDay(new Date(ts));
  const dayMs = 86_400_000;

  if (day === today) return clock(ts);
  if (day === today - dayMs) return 'Yesterday';
  if (today - day < 7 * dayMs)
    return new Date(ts).toLocaleDateString([], { weekday: 'long' });
  return new Date(ts).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
}

/** Always HH:MM, used inside a conversation. */
export const formatClock = clock;

/** True if two timestamps fall on the same local calendar day. */
export function sameDay(a: number, b: number): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/** Day-divider label inside a conversation: "Today", "Yesterday", a weekday for
 *  the past week, else a full date ("January 1, 2026"). */
export function dayLabel(ts: number): string {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(ts));
  const dayMs = 86_400_000;
  if (day === today) return 'Today';
  if (day === today - dayMs) return 'Yesterday';
  if (today - day < 7 * dayMs) return new Date(ts).toLocaleDateString([], { weekday: 'long' });
  return new Date(ts).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Full local date + time, e.g. "2026-06-04, 01:10" (used in the media viewer). */
export function formatFull(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "When" stamp with both day and time (e.g. "Today 19:35", "Wednesday 14:20"). */
export function formatStamp(ts: number): string {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(ts));
  return day === today ? clock(ts) : `${dayLabel(ts)} ${clock(ts)}`;
}

/** Call duration, e.g. "45 sec" or "10:12". */
export function formatDuration(sec?: number): string {
  if (!sec) return '';
  if (sec < 60) return `${sec} sec`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
