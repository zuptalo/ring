/** Stops the isolated test backend started in global-setup.ts. */
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIDS_FILE = path.join(ROOT, '.tmp', 'e2e-pids.json');

export default function globalTeardown(): void {
  try {
    const { ringd } = JSON.parse(readFileSync(PIDS_FILE, 'utf-8')) as { ringd?: number };
    if (ringd) {
      try {
        // Negative pid → kill the detached process group.
        process.kill(-ringd, 'SIGTERM');
      } catch {
        try {
          process.kill(ringd, 'SIGTERM');
        } catch {
          /* already gone */
        }
      }
    }
    rmSync(PIDS_FILE, { force: true });
  } catch {
    /* nothing to tear down */
  }
}
