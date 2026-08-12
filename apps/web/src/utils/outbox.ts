/**
 * Which queued message to send next.
 *
 * Extracted from the flush loop because the rule is easy to state and was got wrong in a way
 * nothing caught: the loop asked for the first item that was *not* `sending`, meaning "not already
 * in flight", while a newly written message was queued as `sending` — so every message was stepped
 * over the instant it was written, and no text was ever sent. The failure was silent, because the
 * message stayed on screen looking like it was on its way.
 */

export type OutboxState = 'queued' | 'sending' | 'failed';

export interface OutboxEntry {
  id: string;
  state: OutboxState;
}

/**
 * The next item to hand to the network, or undefined when there is nothing to do.
 *
 * Queued messages come first and in order, so what someone typed first arrives first. Retries of
 * failed ones come after everything waiting: a message that already failed once has waited longer,
 * but pushing it ahead would let a stale send arrive before something written since.
 *
 * An item that is `sending` is never returned. It is in flight, and picking it again is how the
 * same message gets delivered twice — which is what a reconnect during a retry used to do.
 */
export function nextToSend<T extends OutboxEntry>(items: readonly T[]): T | undefined {
  return items.find((item) => item.state === 'queued') ?? items.find((item) => item.state === 'failed');
}
