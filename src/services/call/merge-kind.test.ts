// Unit tests for the pure kind-reconciliation rule (spec 1030, T005). After a
// merge, a call whose combined distinct headcount still fits the video cap is
// video-capable (the per-participant "Turn on video" control applies); past the
// cap it stays audio-only for everyone. A call that is already video stays video.
import { describe, it, expect } from 'vitest';
import { videoCapableAfterMerge } from './merge-kind';
import { VIDEO_MAX } from './types';

describe('videoCapableAfterMerge', () => {
  it('a video call stays video-capable', () => {
    expect(videoCapableAfterMerge('video', 2)).toBe(true);
    expect(videoCapableAfterMerge('video', VIDEO_MAX)).toBe(true);
  });

  it('an audio call at or under the video cap is video-capable', () => {
    expect(videoCapableAfterMerge('audio', 2)).toBe(true);
    expect(videoCapableAfterMerge('audio', 3)).toBe(true);
    expect(videoCapableAfterMerge('audio', VIDEO_MAX)).toBe(true);
  });

  it('an audio call past the video cap stays audio-only', () => {
    expect(videoCapableAfterMerge('audio', VIDEO_MAX + 1)).toBe(false);
    expect(videoCapableAfterMerge('audio', 8)).toBe(false);
  });
});
