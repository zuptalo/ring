/**
 * DIAG(call-video): an ON-SCREEN diagnostics panel for the active call, built so
 * a single screenshot carries everything needed to find why group video doesn't
 * show on iPhone/Safari while audio is fine.
 *
 * In a production-mode deploy the server's slog output is filtered/unreachable and
 * an iPhone's Safari console isn't readable without a tethered Mac, so the stats
 * are printed right in the call UI. The panel has two parts:
 *   - a SNAPSHOT block (refreshed every few seconds): the negotiated codec, the
 *     outbound/inbound video RTP counters, and - the decisive bit - per-frame
 *     decrypt OK/FAIL counts split by audio vs video. If video decrypt FAILs climb
 *     while audio decrypt is clean, the encrypted video payload is being corrupted
 *     in packetization (not a key problem - audio shares the key).
 *   - a short EVENT log (ontrack, missing-key, etc.).
 *
 * Temporary; remove with the rest of the call-diag instrumentation once the root
 * cause is confirmed.
 */
import { ref } from 'vue';

const MAX_LINES = 24;

export const callDiagOpen = ref(true); // visible by default: this build exists to collect evidence
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

// --- per-frame decrypt counters (split by media kind) -----------------------
// Plain numbers (not reactive): updated per frame at media rate, then sampled
// into the snapshot by the periodic stats timer. The MAIN-THREAD insertable path
// calls noteDecrypt directly; the WORKER path keeps its own counters and posts
// them to the main thread, which feeds them in via setWorkerDecrypt.
const dec = { audOk: 0, audFail: 0, vidOk: 0, vidFail: 0 };
const workerDec = { audOk: 0, audFail: 0, vidOk: 0, vidFail: 0 };

export function noteDecrypt(kind: string, ok: boolean): void {
  if (kind === 'video') ok ? dec.vidOk++ : dec.vidFail++;
  else ok ? dec.audOk++ : dec.audFail++;
}

export function setWorkerDecrypt(s: { audOk: number; audFail: number; vidOk: number; vidFail: number }): void {
  workerDec.audOk = s.audOk;
  workerDec.audFail = s.audFail;
  workerDec.vidOk = s.vidOk;
  workerDec.vidFail = s.vidFail;
}

/** Combined decrypt tallies (main-thread + worker) for the snapshot. */
export function decryptTotals(): { audOk: number; audFail: number; vidOk: number; vidFail: number } {
  return {
    audOk: dec.audOk + workerDec.audOk,
    audFail: dec.audFail + workerDec.audFail,
    vidOk: dec.vidOk + workerDec.vidOk,
    vidFail: dec.vidFail + workerDec.vidFail,
  };
}
