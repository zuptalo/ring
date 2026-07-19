// Spec 1034 + 2023 — the pure halves of the no-silent-pushes policy: the platform
// gate and visible-client test that together license a silent outcome, and the
// content-free quiet note shown when the rich path has nothing it may display.
import { describe, it, expect } from 'vitest';
import { anyClientVisible, quietNote, platformTrustsSilence, mayEndWakeSilently, stampedShow, countAccepted, shouldShowPlaceholderFirst } from './sw-inbox';

// Real-world user agents for the platform gate's truth table (spec 2023 FR-002).
const UA = {
  iphonePwa: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1',
  edgeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/125.0.2535.72 Version/17.0 Mobile/15E148 Safari/604.1',
  firefoxIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.113 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  headlessChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/125.0.0.0 Safari/537.36',
  firefoxDesktop: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
};

describe('spec 2023: platformTrustsSilence', () => {
  it('every WebKit consumer of webpushd is unsafe: iOS in all its skins, and Safari on macOS', () => {
    // The strike counter (3 cumulative silent pushes, no reset, no visible-page
    // exemption) lives in Apple's push daemon — silence is never safe there.
    for (const ua of [UA.iphonePwa, UA.iphoneSafari, UA.ipad, UA.chromeIos, UA.edgeIos, UA.firefoxIos, UA.macSafari]) {
      expect(platformTrustsSilence(ua)).toBe(false);
    }
  });
  it('Chromium engine is trusted on every OS it runs on, including macOS', () => {
    // Chromium uses its own push service everywhere and documents the
    // "site open and focused" exemption.
    for (const ua of [UA.macChrome, UA.winChrome, UA.winEdge, UA.androidChrome, UA.androidSamsung, UA.headlessChrome]) {
      expect(platformTrustsSilence(ua)).toBe(true);
    }
  });
  it('Firefox, empty, and unrecognized user agents fail to the safe direction', () => {
    for (const ua of [UA.firefoxDesktop, '', 'Some Future Browser/1.0']) {
      expect(platformTrustsSilence(ua)).toBe(false);
    }
  });
});

describe('spec 2023: mayEndWakeSilently', () => {
  const focusedVisible = [{ visibilityState: 'visible', focused: true }];
  it('an iPhone with a focused, visible Ring window still may NOT end a wake silently (the regression this spec exists for)', () => {
    expect(mayEndWakeSilently(UA.iphonePwa, focusedVisible)).toBe(false);
  });
  it('a Chromium browser with a focused, visible window keeps the documented exemption', () => {
    expect(mayEndWakeSilently(UA.winChrome, focusedVisible)).toBe(true);
  });
  it('a Chromium browser with a visible but unfocused window does not license silence', () => {
    expect(mayEndWakeSilently(UA.winChrome, [{ visibilityState: 'visible', focused: false }])).toBe(false);
  });
});

describe('spec 1034: anyClientVisible', () => {
  it('no clients → not visible (fully closed app must always show)', () => {
    expect(anyClientVisible([])).toBe(false);
  });
  it('a hidden/frozen background client does NOT license silence', () => {
    expect(anyClientVisible([{ visibilityState: 'hidden', focused: false }])).toBe(false);
    expect(anyClientVisible([{ visibilityState: 'hidden', focused: true }])).toBe(false); // focus alone is not on-screen
  });
  it('a visible but UNFOCUSED window does NOT license silence', () => {
    // The stale-snapshot case the focused-AND-visible tightening exists for, and
    // Chromium's exemption wording is "open and focused", not merely visible.
    expect(anyClientVisible([{ visibilityState: 'visible', focused: false }])).toBe(false);
  });
  it('a visible and focused client licenses a silent outcome', () => {
    expect(anyClientVisible([{ visibilityState: 'hidden', focused: false }, { visibilityState: 'visible', focused: true }])).toBe(true);
  });
  it('clients missing either field (older platforms) fail closed', () => {
    expect(anyClientVisible([{}])).toBe(false);
    expect(anyClientVisible([{ focused: true }])).toBe(false);
    // visibilityState present but `focused` absent must NOT fall back to the old
    // visibility-only license — this pins the fail-closed default.
    expect(anyClientVisible([{ visibilityState: 'visible' }])).toBe(false);
  });
});

describe('spec 2048: shouldShowPlaceholderFirst (show-first gate)', () => {
  it('no clients (app closed) → show first (locked/closed is the norm on iOS)', () => {
    expect(shouldShowPlaceholderFirst([])).toBe(true);
  });
  it('a frozen/background PWA (visible but NOT focused) → show first — it will not render the banner', () => {
    expect(shouldShowPlaceholderFirst([{ visibilityState: 'visible', focused: false }])).toBe(true);
    expect(shouldShowPlaceholderFirst([{ visibilityState: 'hidden', focused: true }])).toBe(true);
  });
  it('a focused+visible window → do NOT show first (that page renders the in-app banner; await its claim)', () => {
    expect(shouldShowPlaceholderFirst([{ visibilityState: 'visible', focused: true }])).toBe(false);
  });
  it('missing fields fail closed → show first (never assume a page will render)', () => {
    expect(shouldShowPlaceholderFirst([{}])).toBe(true);
    expect(shouldShowPlaceholderFirst([{ visibilityState: 'visible' }])).toBe(true);
  });
});

describe('spec 1034: quietNote', () => {
  it('message kind keeps the generic message copy, content-free', () => {
    const n = quietNote('msg');
    expect(n.title).toBe('New message');
    expect(n.options.body).toBe('You have a new message.');
    expect(n.options.silent).toBe(true);
  });
  it('activity kinds are the neutral Ring note', () => {
    const n = quietNote('activity');
    expect(n.title).toBe('Ring');
    expect(n.options.body).toBe('New activity');
    expect(n.options.silent).toBe(true);
  });
  it('both flavors are self-replacing on the generic tag with no re-alert', () => {
    for (const kind of ['msg', 'activity'] as const) {
      const n = quietNote(kind);
      expect(n.options.tag).toBe('ring-incoming');
      expect(n.options.renotify).toBe(false);
    }
  });
});

describe('spec 2023: stampedShow (a show is only "shown" once the platform accepts it)', () => {
  it('stamps exactly once when the platform accepts the show', async () => {
    let stamps = 0;
    const show = stampedShow(() => Promise.resolve(), () => { stamps++; });
    await show();
    expect(stamps).toBe(1);
  });
  it('a REJECTED show never stamps, and the rejection still reaches the caller', async () => {
    let stamps = 0;
    const show = stampedShow(() => Promise.reject(new Error('permission revoked')), () => { stamps++; });
    await expect(show()).rejects.toThrow('permission revoked');
    expect(stamps).toBe(0);
  });
  it('passes its arguments through to the raw show', async () => {
    const seen: unknown[] = [];
    const show = stampedShow((...args: unknown[]) => { seen.push(args); return Promise.resolve(); }, () => {});
    await show('Title', { tag: 't' });
    expect(seen).toEqual([['Title', { tag: 't' }]]);
  });
});

describe('spec 2023: countAccepted (a batch\'s visible outcome is its accepted count)', () => {
  it('empty batch → 0', async () => {
    expect(await countAccepted([])).toBe(0);
  });
  it('every show rejected → 0 (the wake has NOT ended visibly)', async () => {
    expect(await countAccepted([
      () => Promise.reject(new Error('a')),
      () => Promise.reject(new Error('b')),
    ])).toBe(0);
  });
  it('a mixed batch counts only the accepted shows, and one rejection never kills the rest', async () => {
    const order: string[] = [];
    expect(await countAccepted([
      () => { order.push('one'); return Promise.resolve(); },
      () => { order.push('two'); return Promise.reject(new Error('mid-batch')); },
      () => { order.push('three'); return Promise.resolve(); },
    ])).toBe(2);
    expect(order).toEqual(['one', 'two', 'three']);
  });
});
