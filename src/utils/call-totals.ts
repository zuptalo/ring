/**
 * Spec 1025 (US6): aggregate a set of on-device Call records into headline totals for the Calls tab
 * — total audio minutes, total video minutes, and data used for audio, video, and combined. Pure
 * (no IndexedDB), so it is unit-tested directly. A call missing `bytes` (old or interrupted)
 * contributes 0 to the data totals but still contributes its duration to the minutes total; a
 * missing/zero `durationSec` contributes 0 minutes.
 */
import type { Call } from '@/db/types';

export interface CallTotals {
  audioMinutes: number;
  videoMinutes: number;
  audioBytes: number;
  videoBytes: number;
  combinedBytes: number;
}

export function computeCallTotals(calls: Call[]): CallTotals {
  let audioSec = 0;
  let videoSec = 0;
  let audioBytes = 0;
  let videoBytes = 0;
  for (const c of calls) {
    const sec = c.durationSec ?? 0;
    const bytes = c.bytes ?? 0;
    if (c.video) {
      videoSec += sec;
      videoBytes += bytes;
    } else {
      audioSec += sec;
      audioBytes += bytes;
    }
  }
  return {
    audioMinutes: Math.round(audioSec / 60),
    videoMinutes: Math.round(videoSec / 60),
    audioBytes,
    videoBytes,
    combinedBytes: audioBytes + videoBytes,
  };
}
