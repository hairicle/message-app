import { describe, it, expect } from 'vitest';
import type { Message } from '@messenger/shared';
import { groupingFor, GROUP_WINDOW_MS } from './messageGrouping';

/** Minimal message — groupingFor only reads `senderId` and `createdAt`. */
const msg = (senderId: string | null, iso: string) => ({ senderId, createdAt: iso }) as Message;

/**
 * Built in local time, not UTC: day dividers follow the viewer's calendar day, so a fixture
 * written as `...Z` would land on a different date than intended anywhere off UTC.
 */
const on = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 7, day, h, m).toISOString();
};
const at = (hhmm: string) => on(7, hhmm);
const nextDay = (hhmm: string) => on(8, hhmm);

/** Compact shape of a whole thread: S=starts, E=ends, SE=alone, ·=middle. */
const shape = (messages: Message[]) =>
  messages.map((_, i) => {
    const g = groupingFor(messages, i);
    if (g.startsGroup && g.endsGroup) return 'SE';
    if (g.startsGroup) return 'S';
    if (g.endsGroup) return 'E';
    return '·';
  });

describe('groupingFor', () => {
  it('merges a burst from one sender into a single block', () => {
    const thread = [msg('a', at('10:00')), msg('a', at('10:01')), msg('a', at('10:02'))];
    expect(shape(thread)).toEqual(['S', '·', 'E']);
  });

  it('breaks the block when the sender changes', () => {
    const thread = [msg('a', at('10:00')), msg('b', at('10:01')), msg('a', at('10:02'))];
    expect(shape(thread)).toEqual(['SE', 'SE', 'SE']);
  });

  it('breaks the block once the gap exceeds the window', () => {
    const thread = [msg('a', at('10:00')), msg('a', at('10:30'))];
    expect(shape(thread)).toEqual(['SE', 'SE']);
  });

  it('keeps a gap just inside the window together', () => {
    const start = new Date(at('10:00')).getTime();
    const thread = [
      msg('a', at('10:00')),
      msg('a', new Date(start + GROUP_WINDOW_MS - 1000).toISOString()),
    ];
    expect(shape(thread)).toEqual(['S', 'E']);
  });

  it('splits a block at a day boundary even when the messages are minutes apart', () => {
    // 23:59 → 00:01 is two minutes, but a date divider lands between them.
    const thread = [msg('a', at('23:59')), msg('a', nextDay('00:01'))];
    expect(shape(thread)).toEqual(['SE', 'SE']);
    expect(groupingFor(thread, 1).startsDay).toBe(true);
  });

  it('marks the first message of the thread as starting a day', () => {
    const thread = [msg('a', at('10:00'))];
    expect(groupingFor(thread, 0).startsDay).toBe(true);
  });

  it('does not mark a same-day follow-up as starting a day', () => {
    const thread = [msg('a', at('10:00')), msg('b', at('14:00'))];
    expect(groupingFor(thread, 1).startsDay).toBe(false);
  });

  // Regression: `null === null` is true, so an equality-only check merged unrelated system
  // messages into one block attributed to nobody.
  it('never merges messages with no sender', () => {
    const thread = [msg(null, at('10:00')), msg(null, at('10:01'))];
    expect(shape(thread)).toEqual(['SE', 'SE']);
  });

  it('does not merge a system message into a real sender’s block', () => {
    const thread = [msg('a', at('10:00')), msg(null, at('10:01')), msg('a', at('10:02'))];
    expect(shape(thread)).toEqual(['SE', 'SE', 'SE']);
  });

  it('treats a single message as both the start and the end of its block', () => {
    expect(shape([msg('a', at('10:00'))])).toEqual(['SE']);
  });

  it('handles a long run without splitting it in the middle', () => {
    const thread = Array.from({ length: 6 }, (_, i) => msg('a', at(`10:0${i}`)));
    expect(shape(thread)).toEqual(['S', '·', '·', '·', '·', 'E']);
  });

  // Out-of-order arrivals are placed by timestamp, but a negative gap would still be "< window".
  it('does not merge across a negative gap', () => {
    const thread = [msg('a', at('10:05')), msg('a', at('10:00'))];
    expect(groupingFor(thread, 1).startsGroup).toBe(true);
  });
});
