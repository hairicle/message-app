/**
 * The order messages appear in, matching the server's.
 *
 * The server orders by `(created_at, id)`. Ordering by the timestamp alone is not a *total* order,
 * because the timestamp is not unique — `created_at` defaults to `now()`, which is the transaction
 * timestamp and identical for every row written in one transaction. A tie left the order to the
 * database's discretion, which meant two clients could render the same two messages the opposite
 * way round, permanently.
 *
 * This is the same rule on the client, so a message inserted live lands where a reload would put it.
 *
 * ## The one place it cannot be exact
 *
 * The column is microsecond-precision, but Prisma hands it back as a JavaScript `Date` and JSON
 * serialises that to milliseconds — so **the client never sees microseconds at all**. Two messages
 * 100µs apart arrive here with identical timestamps.
 *
 * For the case that matters most that is still exactly right: rows written in one transaction share
 * a timestamp to the microsecond, so the server is tie-breaking on the id too and both agree. It is
 * only two separate, very fast transactions inside one millisecond that could be ordered by
 * microsecond on the server and by id here — and a reload corrects it, because a page is rendered
 * in the order the server returned rather than re-sorted.
 */

export interface Ordered {
  id: string;
  createdAt: string;
}

/**
 * Negative when `a` belongs before `b`, positive when after, zero when they are the same message.
 *
 * The id comparison is lexicographic, which is what Postgres does for a `uuid` — so the tiebreak
 * agrees with the server rather than merely being consistent with itself.
 */
export function compareMessages(a: Ordered, b: Ordered): number {
  const at = new Date(a.createdAt).getTime();
  const bt = new Date(b.createdAt).getTime();
  if (at !== bt) return at - bt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
