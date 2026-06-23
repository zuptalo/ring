/**
 * On-screen call stats panel (the ⓘ button on the active call). In a production
 * deploy the server logs are unreachable and a phone's browser console isn't
 * readable without tethering, so per-leg connection stats are printed right in the
 * call UI for self-diagnosis on a bad network. Two parts:
 *   - a SNAPSHOT block (refreshed every couple of seconds by MeshSession): per-leg
 *     connection state, negotiated codec, and in/out video bitrate + frame counters.
 *   - a short EVENT log (e.g. a remote track arriving).
 *
 * (Formerly the SFU-era "call-video" diagnostics; the per-frame E2EE decrypt tallies
 * were dropped with the SFU/insertable-streams path — mesh media is native DTLS-SRTP.)
 */
import { ref } from 'vue';

const MAX_LINES = 24;

// Hidden by default; revealed via the ⓘ button on the call's main video.
export const callDiagOpen = ref(false);
export const callDiagLines = ref<string[]>([]); // event log (most recent last)
export const callDiagSnapshot = ref<string[]>([]); // refreshed status block

export function pushDiag(line: string): void {
  callDiagLines.value = [...callDiagLines.value.slice(-(MAX_LINES - 1)), `${stamp()} ${line}`];
}

export function setDiagSnapshot(lines: string[]): void {
  callDiagSnapshot.value = lines;
}

export function clearDiag(): void {
  callDiagLines.value = [];
}

function stamp(): string {
  const d = new Date();
  return `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
