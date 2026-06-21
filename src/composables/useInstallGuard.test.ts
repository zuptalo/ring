import { describe, it, expect } from 'vitest';
import { isAndroidWebView } from './useInstallGuard';

// Regression for spec 2003: the install gate must call a browser "can't install" ONLY for a
// genuinely-incapable surface (an embedded Android WebView), identified from the user agent —
// NOT because beforeinstallprompt was slow to fire on a capable Chrome.

describe('isAndroidWebView', () => {
  it('detects an embedded Android WebView (the "; wv)" tag)', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36';
    expect(isAndroidWebView(ua)).toBe(true);
  });

  it('detects a legacy Android WebView (Version/x.x alongside Chrome/, no wv tag)', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 9; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/74.0.3729.157 Mobile Safari/537.36';
    expect(isAndroidWebView(ua)).toBe(true);
  });

  it('does NOT flag normal Android Chrome (the bug being fixed)', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36';
    expect(isAndroidWebView(ua)).toBe(false);
  });

  it('does NOT flag Samsung Internet (Chrome token but no Version/)', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36';
    expect(isAndroidWebView(ua)).toBe(false);
  });

  it('does NOT flag Edge on Android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 EdgA/119.0.0.0';
    expect(isAndroidWebView(ua)).toBe(false);
  });

  it('does NOT flag Firefox on Android (no Chrome token)', () => {
    const ua = 'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0';
    expect(isAndroidWebView(ua)).toBe(false);
  });

  it('is not applicable to desktop or iOS user agents', () => {
    expect(
      isAndroidWebView(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
    expect(
      isAndroidWebView(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(false);
  });
});
