import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

/**
 * Spec 2059 — the half of the fix that a pill-watching test cannot see.
 *
 * The bug was never really about labels: the shared audio element was given ONE app-wide rate.
 * These assertions read the element itself, so a change that only repainted the pill would fail
 * here. Driven directly rather than through the UI because a decodable audio fixture is not
 * needed to check which rate the element was handed — and an undecodable one tears the element
 * down mid-assertion, which is a property of the fixture, not the behaviour.
 *
 * The suite runs in the repo's fast Node environment (no DOM, by deliberate choice in
 * vitest.config.ts), and `useAudioPlayer` builds its element at module load — so a minimal
 * stand-in for HTMLAudioElement is installed before the module is imported. Only the surface
 * the module actually touches is implemented; anything else would be guessing.
 */
class FakeAudio {
  playbackRate = 1;
  loop = false;
  paused = true;
  src = '';
  duration = 0;
  currentTime = 0;
  addEventListener(): void {}
  removeAttribute(): void {}
  load(): void {
    this.playbackRate = 1; // matches the real element: load() resets the rate
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

type Mod = typeof import('./useAudioPlayer');
type Rates = typeof import('./usePlaybackRates');
let player: Mod;
let rates: Rates;

beforeAll(async () => {
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
  player = await import('./useAudioPlayer');
  rates = await import('./usePlaybackRates');
});

describe('the shared audio element gets the track’s own rate', () => {
  beforeEach(() => {
    rates.__resetPlaybackRates();
    player.audioCurId.value = null;
  });

  const track = (id: string) => ({ id, url: `blob:${id}`, title: id });

  it('plays a message nobody has changed at normal speed', () => {
    player.playAudio(track('m1'));
    expect(player.audioElementRateNow()).toBe(1);
  });

  it('applies the message’s own chosen rate when it starts playing', () => {
    rates.cycleRateFor('m1'); // 1 → 1.5
    player.playAudio(track('m1'));
    expect(player.audioElementRateNow()).toBe(1.5);
  });

  it('changing the PLAYING message’s rate takes effect on the element immediately', () => {
    player.playAudio(track('m1'));
    player.cycleAudioRate('m1');
    expect(player.audioElementRateNow()).toBe(1.5);
    expect(player.audioElementRateNow()).toBe(rates.rateFor('m1'));
  });

  // FR-006 — the heart of the reported bug. Changing some other message's speed while you are
  // listening to this one must not reach into what is playing.
  it('changing a DIFFERENT message’s rate leaves the playing one alone', () => {
    player.playAudio(track('playing'));
    expect(player.audioElementRateNow()).toBe(1);

    player.cycleAudioRate('elsewhere-in-the-list');
    player.cycleAudioRate('elsewhere-in-the-list');

    expect(rates.rateFor('elsewhere-in-the-list')).toBe(2); // that message did change
    expect(player.audioElementRateNow()).toBe(1); // and this one did not
    expect(rates.rateFor('playing')).toBe(1);
  });

  it('starting a different track switches to THAT track’s rate', () => {
    rates.cycleRateFor('fast');
    rates.cycleRateFor('fast'); // → 2
    player.playAudio(track('fast'));
    expect(player.audioElementRateNow()).toBe(2);

    player.playAudio(track('untouched'));
    expect(player.audioElementRateNow()).toBe(1);
  });
});
