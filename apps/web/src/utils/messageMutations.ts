/**
 * Applying an edit or a deletion everywhere a message's text is held.
 *
 * The thread is not the only place a message body lives on screen. The pinned bar, the bookmarks
 * list and the search results each keep their own copy — necessarily, because a pinned message may
 * be thousands of messages up and never loaded into the thread at all, so they cannot hold an id
 * and look it up.
 *
 * That is the duplication, and it had a consequence worth naming: the socket handlers updated the
 * thread and nothing else, so **deleting a pinned message left its text readable in the pinned
 * bar**. Deletion is administrators-only — it exists to remove something that should not be
 * there — and it reported success while the words were still on screen twice over.
 *
 * These helpers exist so the correction is written once and applied to each list, rather than
 * remembered separately in two handlers. They are deliberately pure and shape-agnostic: a `Message`
 * identifies itself with `id`, a `PinnedMessage` and a `BookmarkedMessage` with `messageId`, and
 * all three carry `ciphertext`.
 */

/** Anything on screen that holds a message body. */
export type MessageBearing = { ciphertext: string } & ({ id: string } | { messageId: string });

/** Whichever field this shape uses to name the message. */
function idOf(item: MessageBearing): string {
  return 'messageId' in item ? item.messageId : (item as { id: string }).id;
}

/**
 * The new text for a message that was edited.
 *
 * `editedAt` is set only on shapes that have it — the pinned and bookmark rows do not, and inventing
 * the field would put a property in state that no renderer reads and no refetch would reproduce.
 */
export function applyEdit<T extends MessageBearing>(
  items: T[],
  messageId: string,
  ciphertext: string,
  editedAt: string | null,
): T[] {
  let changed = false;
  const next = items.map((item) => {
    if (idOf(item) !== messageId) return item;
    changed = true;
    return 'editedAt' in item
      ? { ...item, ciphertext, editedAt }
      : { ...item, ciphertext };
  });
  // The same array back when nothing matched, so React skips the re-render.
  return changed ? next : items;
}

/**
 * Blank a message that was deleted.
 *
 * Blanked rather than removed, because that is what the server does: `deleteMessage` writes an
 * empty body and leaves the row, and the pin and bookmark queries do not filter deleted messages
 * out. Dropping the entry here would look tidier and disagree with the next refetch.
 *
 * The attachment goes with the text. A deleted image message that kept its `file` would still
 * render a picture.
 */
export function applyDeletion<T extends MessageBearing>(
  items: T[],
  messageId: string,
  deletedAt: string | null,
): T[] {
  let changed = false;
  const next = items.map((item) => {
    if (idOf(item) !== messageId) return item;
    changed = true;
    const blanked = { ...item, ciphertext: '' } as T & { file?: unknown; deletedAt?: string | null };
    if ('file' in item) blanked.file = undefined;
    if ('deletedAt' in item) blanked.deletedAt = deletedAt;
    return blanked;
  });
  return changed ? next : items;
}
