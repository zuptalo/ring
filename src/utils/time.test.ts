import { describe, it, expect } from 'vitest';
import {
  formatTime, formatClock, sameDay, dayLabel, formatFull, formatStamp, formatDuration, formatDay,
} from './time';

const DAY = 86_400_000;
const HHMM = /^\d{2}:\d{2}$/;

describe('formatClock', () => {
  it('is a 24-hour HH:MM string', () => {
    expect(formatClock(Date.now())).toMatch(HHMM);
  });
});

describe('formatTime', () => {
  it('shows the clock for today and "Yesterday" for the prior day', () => {
    expect(formatTime(Date.now())).toMatch(HHMM);
    expect(formatTime(Date.now() - DAY)).toBe('Yesterday');
  });

  it('shows a weekday within the past week, and a date beyond it', () => {
    const weekday = formatTime(Date.now() - 3 * DAY);
    expect(weekday).not.toBe('Yesterday');
    expect(weekday).not.toMatch(HHMM);
    expect(formatTime(Date.now() - 30 * DAY)).toMatch(/\d/); // a numeric date
  });
});

describe('dayLabel', () => {
  it('labels today and yesterday by name', () => {
    expect(dayLabel(Date.now())).toBe('Today');
    expect(dayLabel(Date.now() - DAY)).toBe('Yesterday');
  });

  it('uses a weekday within the past week and a full date beyond it', () => {
    const weekday = dayLabel(Date.now() - 3 * DAY);
    expect(['Today', 'Yesterday']).not.toContain(weekday);
    expect(dayLabel(Date.now() - 60 * DAY)).toMatch(/\d{4}/); // full date carries the year
  });
});

describe('sameDay', () => {
  it('is true within one calendar day and false across days', () => {
    const a = new Date(2026, 0, 1, 9, 0).getTime();
    const b = new Date(2026, 0, 1, 23, 30).getTime();
    const c = new Date(2026, 0, 2, 0, 30).getTime();
    expect(sameDay(a, b)).toBe(true);
    expect(sameDay(a, c)).toBe(false);
  });
});

describe('formatFull', () => {
  it('is a zero-padded local YYYY-MM-DD, HH:MM', () => {
    const ts = new Date(2026, 0, 4, 1, 10).getTime();
    expect(formatFull(ts)).toBe('2026-01-04, 01:10');
  });
});

describe('formatStamp', () => {
  it('is just the clock today, and day + clock otherwise', () => {
    expect(formatStamp(Date.now())).toMatch(HHMM);
    expect(formatStamp(Date.now() - DAY)).toMatch(/^Yesterday \d{2}:\d{2}$/);
  });
});

describe('formatDuration', () => {
  it('formats sub-minute, minute, and empty cases', () => {
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(45)).toBe('45 sec');
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(612)).toBe('10:12');
  });
});

describe('formatDay', () => {
  it('formats a local calendar date as YYYY-MM-DD with zero padding', () => {
    // Construct via local-time components so the assertion is timezone-independent.
    const ts = new Date(2026, 5, 19, 14, 30).getTime(); // 2026-06-19 local
    expect(formatDay(ts)).toBe('2026-06-19');
    const jan = new Date(2026, 0, 3, 0, 5).getTime(); // 2026-01-03 local
    expect(formatDay(jan)).toBe('2026-01-03');
  });
});
