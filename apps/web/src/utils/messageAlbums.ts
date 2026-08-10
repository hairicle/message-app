import type { Message } from '@messenger/shared';

/**
 * How close together media has to be sent to read as one batch.
 *
 * Tighter than the message-grouping window: that one asks "is this the same person still
 * talking", which is minutes. This asks "were these picked and sent together", which is seconds —
 * two photos shared four minutes apart are two separate thoughts and should stay two bubbles.
 */
export const ALBUM_WINDOW_MS = 60 * 1000;

/** Fewest tiles worth laying out as a grid. One image is just an image. */
const MIN_ALBUM = 2;

export interface AlbumLayout {
  /** Message id of an album's first member → every message in that album. */
  albums: Map<string, Message[]>;
  /** Ids belonging to an album but not opening it; the thread renders nothing for these. */
  absorbed: Set<string>;
}

/**
 * Whether a message can be a tile in a grid.
 *
 * A reply or a forward is excluded even when it is an image: both carry context of their own —
 * a quoted message, a "Forwarded from" line — that a bare tile has nowhere to show, so folding
 * them into an album would silently drop it.
 */
function canTile(message: Message): boolean {
  if (message.type !== 'image' && message.type !== 'video') return false;
  if (!message.file || message.deletedAt) return false;
  if (message.replyToMessageId || message.forwardedFromMessageId) return false;
  return !!message.senderId;
}

function sameBatch(earlier: Message, later: Message): boolean {
  if (earlier.senderId !== later.senderId) return false;
  const a = new Date(earlier.createdAt);
  const b = new Date(later.createdAt);
  if (a.toDateString() !== b.toDateString()) return false;
  const gap = b.getTime() - a.getTime();
  return gap >= 0 && gap < ALBUM_WINDOW_MS;
}

/**
 * Find runs of media that were sent together, so the thread can lay them out as one block
 * instead of a column of separate bubbles.
 */
export function buildAlbums(messages: Message[]): AlbumLayout {
  const albums = new Map<string, Message[]>();
  const absorbed = new Set<string>();

  let i = 0;
  while (i < messages.length) {
    if (!canTile(messages[i])) {
      i += 1;
      continue;
    }

    let end = i + 1;
    while (end < messages.length && canTile(messages[end]) && sameBatch(messages[end - 1], messages[end])) {
      end += 1;
    }

    const run = messages.slice(i, end);
    if (run.length >= MIN_ALBUM) {
      albums.set(run[0].id, run);
      for (const m of run.slice(1)) absorbed.add(m.id);
    }
    i = end;
  }

  return { albums, absorbed };
}

/**
 * Column spans for each tile, out of a six-column grid.
 *
 * Six because it divides by both two and three, which is what lets every row be filled edge to
 * edge whatever the count: rows of three become spans of two, a leftover pair becomes two halves,
 * and a single leftover takes the full width. Without that, a count like five leaves a ragged
 * hole in the last row.
 *
 * Every tile is laid out — an album that hides its last picture behind a "+2" means those
 * pictures cannot be seen at all without opening the viewer.
 */
export function albumSpans(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [6];
  if (count === 2) return [3, 3];
  // One wide over two reads better than a row of three narrow strips.
  if (count === 3) return [6, 3, 3];
  if (count === 4) return [3, 3, 3, 3];

  const spans: number[] = [];
  const fullRows = Math.floor(count / 3);
  const remainder = count % 3;
  for (let i = 0; i < fullRows * 3; i++) spans.push(2);
  if (remainder === 1) spans.push(6);
  if (remainder === 2) spans.push(3, 3);
  return spans;
}
