import { describe, it, expect } from 'vitest';
import { formatLastSeen } from './lastSeen';

const NOW = new Date('2026-08-14T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('formatLastSeen', () => {
  it('says nothing when there is nothing to say', () => {
    expect(formatLastSeen(null, NOW)).toBeNull();
    expect(formatLastSeen(undefined, NOW)).toBeNull();
  });

  it('ignores an unparseable value rather than printing "Invalid Date"', () => {
    expect(formatLastSeen('not a date', NOW)).toBeNull();
  });

  it('rounds the last minute down to "just now"', () => {
    expect(formatLastSeen(ago(5 * SEC), NOW)).toBe('just now');
    expect(formatLastSeen(ago(59 * SEC), NOW)).toBe('just now');
  });

  // A client clock slightly behind the server's produces a negative gap.
  it('does not say someone was seen in the future', () => {
    expect(formatLastSeen(new Date(NOW.getTime() + 4 * SEC), NOW)).toBe('just now');
  });

  it('counts minutes, singular and plural', () => {
    expect(formatLastSeen(ago(MIN), NOW)).toBe('a minute ago');
    expect(formatLastSeen(ago(45 * MIN), NOW)).toBe('45 minutes ago');
  });

  it('counts hours', () => {
    expect(formatLastSeen(ago(HOUR), NOW)).toBe('an hour ago');
    expect(formatLastSeen(ago(5 * HOUR), NOW)).toBe('5 hours ago');
  });

  it('calls one day "yesterday"', () => {
    expect(formatLastSeen(ago(DAY), NOW)).toBe('yesterday');
  });

  it('counts days up to a week', () => {
    expect(formatLastSeen(ago(3 * DAY), NOW)).toBe('3 days ago');
  });

  it('switches to a date once the gap stops being the useful part', () => {
    const out = formatLastSeen(ago(20 * DAY), NOW)!;
    expect(out).not.toMatch(/ago|yesterday/);
    expect(out).toMatch(/Jul/);
  });

  it('includes the year only when it is not this one', () => {
    expect(formatLastSeen(ago(20 * DAY), NOW)).not.toMatch(/2026/);
    expect(formatLastSeen(new Date('2025-03-02T12:00:00Z'), NOW)).toMatch(/2025/);
  });

  it('accepts an ISO string as readily as a Date', () => {
    expect(formatLastSeen(ago(2 * HOUR).toISOString(), NOW)).toBe('2 hours ago');
  });
});
