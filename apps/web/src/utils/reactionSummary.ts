import type { Reaction } from '@messenger/shared';

/** Names listed in full before the rest become a count. */
const MAX_NAMED = 6;

export interface ReactionGroup {
  emoji: string;
  count: number;
  /** Whether the current user is among the reactors, which is what makes the pill actionable. */
  mine: boolean;
  /** Who reacted, for the tooltip: "You" first, then everyone else. */
  names: string[];
}

/**
 * Collapse a message's reactions into one entry per emoji, keeping who reacted.
 *
 * The API has always returned each reactor's name; the thread counted them and discarded the
 * rest, so a pill could say four people reacted without saying which four.
 */
export function groupReactions(reactions: Reaction[], currentUserId: string): ReactionGroup[] {
  const byEmoji = new Map<string, { count: number; mine: boolean; others: string[] }>();

  for (const r of reactions) {
    const entry = byEmoji.get(r.emoji) ?? { count: 0, mine: false, others: [] };
    entry.count += 1;
    if (r.userId === currentUserId) {
      entry.mine = true;
    } else {
      entry.others.push(r.displayName || r.username || 'Someone');
    }
    byEmoji.set(r.emoji, entry);
  }

  return [...byEmoji.entries()].map(([emoji, { count, mine, others }]) => {
    // "You" leads: the first thing worth knowing about a reaction is whether it is partly yours.
    const named = mine ? ['You', ...others] : [...others];
    const shown = named.slice(0, MAX_NAMED);
    const hidden = named.length - shown.length;
    return {
      emoji,
      count,
      mine,
      names: hidden > 0 ? [...shown, `and ${hidden} more`] : shown,
    };
  });
}
