import { describe, it, expect } from 'vitest';
import { firstLink, linkDomain, shouldBuildLinkPreview } from './link-preview';

describe('firstLink', () => {
  it('finds the first http(s) URL in a body', () => {
    expect(firstLink('see https://example.com/x for more')).toBe('https://example.com/x');
    expect(firstLink('http://a.test and https://b.test')).toBe('http://a.test');
  });

  it('returns undefined when there is no URL', () => {
    expect(firstLink('just some text')).toBeUndefined();
    expect(firstLink('not a link: example.com')).toBeUndefined(); // no scheme
  });
});

describe('linkDomain', () => {
  it('strips a leading www.', () => {
    expect(linkDomain('https://www.example.com/path')).toBe('example.com');
    expect(linkDomain('https://sub.example.com')).toBe('sub.example.com');
  });
});

describe('shouldBuildLinkPreview (spec 1026 US2 / FR-009)', () => {
  it('builds a preview for a link when previews are enabled', () => {
    expect(shouldBuildLinkPreview('look https://example.com', false)).toBe(true);
  });

  it('does NOT build a preview when "Disable link previews" is on', () => {
    expect(shouldBuildLinkPreview('look https://example.com', true)).toBe(false);
  });

  it('does NOT build a preview when the body has no link', () => {
    expect(shouldBuildLinkPreview('no link here', false)).toBe(false);
  });
});
