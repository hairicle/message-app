import { describe, it, expect } from 'vitest';
import { nextToSend, type OutboxEntry } from './outbox';

const q = (id: string): OutboxEntry => ({ id, state: 'queued' });
const sending = (id: string): OutboxEntry => ({ id, state: 'sending' });
const failed = (id: string): OutboxEntry => ({ id, state: 'failed' });

describe('nextToSend', () => {
  it('returns nothing when the queue is empty', () => {
    expect(nextToSend([])).toBeUndefined();
  });

  // The bug this exists to prevent. A newly written message was queued as `sending`, and the loop
  // asked for the first item that was *not* sending — so it stepped over every message the moment
  // it was written, and no text was ever sent.
  it('picks a freshly queued message', () => {
    expect(nextToSend([q('a')])?.id).toBe('a');
  });

  it('sends what was typed first, first', () => {
    expect(nextToSend([q('a'), q('b')])?.id).toBe('a');
  });

  // Picking an in-flight item again is how the same message gets delivered twice, which is what a
  // reconnect during a retry used to do.
  it('never returns something already in flight', () => {
    expect(nextToSend([sending('a')])).toBeUndefined();
  });

  it('skips past an in-flight item to a queued one', () => {
    expect(nextToSend([sending('a'), q('b')])?.id).toBe('b');
  });

  it('retries a failed message when nothing is waiting', () => {
    expect(nextToSend([failed('a')])?.id).toBe('a');
  });

  // A message that already failed has waited longer, but pushing it ahead would let a stale send
  // arrive before something written since.
  it('prefers a queued message over a retry', () => {
    expect(nextToSend([failed('old'), q('new')])?.id).toBe('new');
  });

  it('returns nothing when everything is in flight', () => {
    expect(nextToSend([sending('a'), sending('b')])).toBeUndefined();
  });

  it('carries the whole item through, not just its id', () => {
    const items = [{ id: 'a', state: 'queued' as const, text: 'hello' }];
    expect(nextToSend(items)?.text).toBe('hello');
  });
});
