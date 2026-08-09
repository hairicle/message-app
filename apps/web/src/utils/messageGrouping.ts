import type { Message } from '@messenger/shared';

/**
 * Messages from one sender, sent close together, are drawn as a single block: one avatar, one
 * name, one timestamp. Without this a burst of four quick replies costs four avatars and four
 * headers, which is what makes a thread read as noisy and scroll far taller than it needs to.
 *
 * Five minutes rather than a tighter window because a burst is usually someone thinking out loud
 * — pauses to type a longer follow-up routinely run past three.
 */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface Grouping {
  /** First of a run: carries the avatar and the name + time header. */
  startsGroup: boolean;
  /** Last of a run: closes the block, so the trailing corner stays rounded. */
  endsGroup: boolean;
  /** A new calendar day begins here, so a date divider is drawn above. */
  startsDay: boolean;
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/**
 * Whether `later` continues the block `earlier` started.
 *
 * A null sender means a system message. Those must never merge — two of them in a row both have
 * `senderId === null`, and an equality test alone would happily read that as "same person".
 */
function joins(earlier: Message, later: Message): boolean {
  if (!later.senderId || !earlier.senderId) return false;
  if (earlier.senderId !== later.senderId) return false;

  const gap = new Date(later.createdAt).getTime() - new Date(earlier.createdAt).getTime();
  return gap >= 0 && gap < GROUP_WINDOW_MS;
}

/** Where the message at `index` sits within its block. */
export function groupingFor(messages: Message[], index: number): Grouping {
  const message = messages[index];
  const at = new Date(message.createdAt);
  const prev = index > 0 ? messages[index - 1] : null;
  const next = index < messages.length - 1 ? messages[index + 1] : null;

  const startsDay = !prev || !sameDay(at, new Date(prev.createdAt));

  // A day divider always breaks the block, however close the two messages are in wall-clock time.
  const continuesFrom = !startsDay && !!prev && joins(prev, message);
  const continuesInto = !!next && sameDay(at, new Date(next.createdAt)) && joins(message, next);

  return { startsGroup: !continuesFrom, endsGroup: !continuesInto, startsDay };
}
