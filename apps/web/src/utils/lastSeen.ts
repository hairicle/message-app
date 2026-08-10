/**
 * How long ago someone was last connected, in words.
 *
 * Deliberately vague at the short end and precise at the long end: "a few minutes ago" is what a
 * person means, while "last seen 14 August" is what they need once it stops being today. An exact
 * minute count for someone who left an hour ago is precision nobody asked for.
 */
export function formatLastSeen(lastSeenAt: string | Date | null | undefined, now: Date = new Date()): string | null {
  if (!lastSeenAt) return null;

  const seen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  if (Number.isNaN(seen.getTime())) return null;

  const seconds = Math.floor((now.getTime() - seen.getTime()) / 1000);
  // A clock a little behind the server's would otherwise read as "in 4 seconds".
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  // Past a week the gap stops being the useful part and the date starts being it.
  const sameYear = seen.getFullYear() === now.getFullYear();
  return seen.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
