import type { Conversation } from '@messenger/shared';

/**
 * Pinned conversations first, everything else in the order it already had.
 *
 * The server orders the list this way on load, but the client reorders it constantly afterwards —
 * an arriving message moves its conversation to the top. Without re-applying the rule there, the
 * first message in any unpinned conversation would jump above the pinned ones and pinning would
 * appear to have come undone.
 *
 * Relies on sort being stable, which it is: within each group the existing order is kept, so this
 * never disturbs the recency ordering it is layered on top of.
 */
export function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => Number(!!b.is_pinned) - Number(!!a.is_pinned));
}
