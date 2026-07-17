/** Pure call-log presentation helpers, split out of queries.ts so they're unit-testable
 *  without pulling in the IndexedDB layer (and its transitive UI imports). */
import type { CallLog } from './types';

const clockDur = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Preview/summary text for a call-log chat row + chats-list preview. */
export function callLogPreview(log: CallLog): string {
  if (log.isGroup) {
    if (log.missed) return 'Group call, no answer';
    return log.durationSec ? `Group call · ${clockDur(log.durationSec)}` : 'Group call';
  }
  // An outgoing call we couldn't complete reads clearer than a blanket "No answer".
  if (log.outcome === 'busy') return 'Busy';
  if (log.outcome === 'unavailable') return 'Unavailable';
  if (log.outcome === 'declined') return log.direction === 'incoming' ? 'Declined' : 'Call declined';
  if (log.missed) return log.direction === 'incoming' ? 'Missed call' : 'No answer';
  return `Call · ${clockDur(log.durationSec ?? 0)}`;
}
