// Spec 2044 — the legacy-iOS classifier and the bounded-read helper behind the
// lite push path. The classifier decides which devices get the guaranteed-visible
// generic-only wake (iOS <= 16, where SW-context IndexedDB/decrypt is unreliable);
// everything else — including anything unparseable — MUST stay on the modern rich
// path, so these tests pin both directions. The bounded-read helper is what keeps
// showGeneric's diagnostics read from hanging the last-resort show on a wedged DB.
import { describe, it, expect } from 'vitest';
import { iosMajorVersion, isLegacyIOS, withTimeout } from './sw-inbox';

// Real-world UA shapes (home-screen PWAs omit Version/Safari tokens; browsers keep them).
const UA = {
  iphone8Pwa: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iphone8Safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  iphoneIos15: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipadIos16: 'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  chromeIos16: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1',
  iphoneIos17Pwa: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iphoneIos26Pwa: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  // iPadOS 13+ in desktop mode masquerades as macOS — carries "OS 10_15" but NO iPhone/iPad
  // token, so it must parse as null (modern), never as legacy iOS 10.
  ipadOsMacintosh: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.113 Mobile Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  iphoneNoVersion: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
};

describe('spec 2044: iosMajorVersion', () => {
  it('parses the major version from iPhone and iPad UAs', () => {
    expect(iosMajorVersion(UA.iphone8Pwa)).toBe(16);
    expect(iosMajorVersion(UA.iphone8Safari)).toBe(16);
    expect(iosMajorVersion(UA.iphoneIos15)).toBe(15);
    expect(iosMajorVersion(UA.ipadIos16)).toBe(16);
    expect(iosMajorVersion(UA.chromeIos16)).toBe(16);
    expect(iosMajorVersion(UA.iphoneIos17Pwa)).toBe(17);
    expect(iosMajorVersion(UA.iphoneIos26Pwa)).toBe(26);
  });
  it('returns null for non-iOS and unparseable UAs (never misreads macOS "OS 10_15")', () => {
    expect(iosMajorVersion(UA.ipadOsMacintosh)).toBeNull();
    expect(iosMajorVersion(UA.androidChrome)).toBeNull();
    expect(iosMajorVersion(UA.winChrome)).toBeNull();
    expect(iosMajorVersion(UA.iphoneNoVersion)).toBeNull();
    expect(iosMajorVersion('')).toBeNull();
  });
});

describe('spec 2044: isLegacyIOS (the ONLY gate into the lite wake path)', () => {
  it('iOS <= 16 is legacy, in every skin', () => {
    for (const ua of [UA.iphone8Pwa, UA.iphone8Safari, UA.iphoneIos15, UA.ipadIos16, UA.chromeIos16]) {
      expect(isLegacyIOS(ua)).toBe(true);
    }
  });
  it('iOS 17+ and every non-iOS platform stay on the modern path (the isolation pin)', () => {
    for (const ua of [UA.iphoneIos17Pwa, UA.iphoneIos26Pwa, UA.ipadOsMacintosh, UA.androidChrome, UA.winChrome]) {
      expect(isLegacyIOS(ua)).toBe(false);
    }
  });
  it('anything unparseable fails toward modern — a fresh device must never be downgraded by accident', () => {
    for (const ua of [UA.iphoneNoVersion, '', 'Some Future Browser/1.0']) {
      expect(isLegacyIOS(ua)).toBe(false);
    }
  });
});

describe('spec 2044: withTimeout (bounds reads that may hang on a wedged IndexedDB)', () => {
  it('resolves with the value when the promise settles in time', async () => {
    expect(await withTimeout(Promise.resolve(true), 1000, false)).toBe(true);
  });
  it('falls back when the promise NEVER settles (the hung-IDB case)', async () => {
    const hung = new Promise<boolean>(() => {});
    expect(await withTimeout(hung, 20, false)).toBe(false);
  });
  it('falls back on rejection too — a throwing read must not kill the show', async () => {
    expect(await withTimeout(Promise.reject(new Error('idb dead')), 1000, 'fb')).toBe('fb');
  });
});
