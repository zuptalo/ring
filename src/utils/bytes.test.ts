import { describe, it, expect } from 'vitest';
import { formatBytes } from './bytes';

describe('formatBytes', () => {
  it('shows whole bytes under 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('scales up through the units with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB'); // trailing .0 dropped
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
  });

  it('caps at the largest unit', () => {
    expect(formatBytes(5 * 1024 ** 4)).toBe('5 TB');
  });

  it('treats zero/negative/NaN as 0 KB', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(-100)).toBe('0 KB');
    expect(formatBytes(NaN)).toBe('0 KB');
  });
});
