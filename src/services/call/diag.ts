/**
 * DIAG(call-video): a tiny reactive ring-buffer of call diagnostics surfaced
 * ON-SCREEN during a call (the in-app debug overlay in CallActivePage).
 *
 * In a production-mode deploy the server's slog output is filtered/unreachable,
 * and an iPhone's Safari console isn't readable without a tethered Mac - so the
 * only practical way to see why group video isn't flowing on iOS is to print the
 * stats right in the call UI. Temporary; remove together with the rest of the
 * call-diag instrumentation once the root cause is confirmed.
 */
import { ref } from 'vue';

const MAX_LINES = 60;

export const callDiagLines = ref<string[]>([]);
// Starts visible: this build exists specifically to collect the evidence.
export const callDiagOpen = ref(true);

export function pushDiag(line: string): void {
  const d = new Date();
  const ts = `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  callDiagLines.value = [...callDiagLines.value.slice(-(MAX_LINES - 1)), `${ts} ${line}`];
}

export function clearDiag(): void {
  callDiagLines.value = [];
}
