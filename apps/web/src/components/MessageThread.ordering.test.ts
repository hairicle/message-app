import { describe, it, expect } from 'vitest';
import type { Message } from '@messenger/shared';
import { addMessage } from './MessageThread';

/** Minimal message — addMessage only reads `id` and `createdAt`. */
const msg = (id: string, iso: string) => ({ id, createdAt: iso }) as Message;

const at = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;
const ids = (list: Message[]) => list.map((m) => m.id);

describe('addMessage', () => {
  it('appends a message that is newer than everything present', () => {
    const list = [msg('a', at('15:09')), msg('b', at('15:14'))];
    expect(ids(addMessage(list, msg('c', at('15:20'))))).toEqual(['a', 'b', 'c']);
  });

  // The regression this guards: a message sent at 3:09pm rendered *below* one at 3:14pm,
  // because arrivals were appended blindly instead of placed by timestamp.
  it('inserts a late-arriving older message in chronological position', () => {
    const list = [msg('b', at('15:14')), msg('c', at('15:20'))];
    expect(ids(addMessage(list, msg('a', at('15:09'))))).toEqual(['a', 'b', 'c']);
  });

  it('inserts into the middle', () => {
    const list = [msg('a', at('15:00')), msg('c', at('15:20'))];
    expect(ids(addMessage(list, msg('b', at('15:10'))))).toEqual(['a', 'b', 'c']);
  });

  it('is idempotent — re-delivering the same id changes nothing', () => {
    const list = [msg('a', at('15:00')), msg('b', at('15:10'))];
    const again = addMessage(list, msg('a', at('15:00')));
    expect(ids(again)).toEqual(['a', 'b']);
    // Socket reconnects can replay events; returning the same reference avoids a re-render.
    expect(again).toBe(list);
  });

  it('deduplicates by id even when the timestamp differs', () => {
    const list = [msg('a', at('15:00'))];
    expect(ids(addMessage(list, msg('a', at('16:00'))))).toEqual(['a']);
  });

  it('handles the empty thread', () => {
    expect(ids(addMessage([], msg('a', at('15:00'))))).toEqual(['a']);
  });

  it('places a message equal in time after the existing one, keeping arrival order', () => {
    const list = [msg('a', at('15:00'))];
    expect(ids(addMessage(list, msg('b', at('15:00'))))).toEqual(['a', 'b']);
  });

  it('does not mutate the array it was given', () => {
    const list = [msg('b', at('15:14'))];
    const copy = [...list];
    addMessage(list, msg('a', at('15:09')));
    expect(list).toEqual(copy);
  });

  it('keeps the thread sorted across many out-of-order arrivals', () => {
    const times = ['15:20', '15:09', '15:30', '15:00', '15:14'];
    let list: Message[] = [];
    times.forEach((t, i) => { list = addMessage(list, msg(String(i), at(t))); });
    const stamps = list.map((m) => new Date(m.createdAt).getTime());
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });
});
