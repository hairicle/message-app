import { describe, it, expect } from 'vitest';
import type { Reaction } from '@messenger/shared';
import { groupReactions } from './reactionSummary';

const ME = 'me';
const react = (emoji: string, userId: string, displayName?: string, username?: string): Reaction =>
  ({ emoji, userId, displayName, username }) as Reaction;

describe('groupReactions', () => {
  it('collapses the same emoji into one entry with a count', () => {
    const groups = groupReactions([react('👍', 'a', 'Dara'), react('👍', 'b', 'Nini')], ME);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('keeps different emoji apart', () => {
    const groups = groupReactions([react('👍', 'a', 'Dara'), react('🔥', 'b', 'Nini')], ME);
    expect(groups.map((g) => g.emoji)).toEqual(['👍', '🔥']);
  });

  // The bug this replaces: the pill knew four people reacted, not which four.
  it('names who reacted', () => {
    const groups = groupReactions([react('👍', 'a', 'Dara'), react('👍', 'b', 'Nini')], ME);
    expect(groups[0].names).toEqual(['Dara', 'Nini']);
  });

  it('puts you first and calls you "You"', () => {
    const groups = groupReactions([react('👍', 'a', 'Dara'), react('👍', ME, 'My Name')], ME);
    expect(groups[0].names).toEqual(['You', 'Dara']);
    expect(groups[0].mine).toBe(true);
  });

  it('marks a reaction as not yours when you are absent', () => {
    const groups = groupReactions([react('👍', 'a', 'Dara')], ME);
    expect(groups[0].mine).toBe(false);
    expect(groups[0].names).toEqual(['Dara']);
  });

  it('falls back to the username when there is no display name', () => {
    const groups = groupReactions([react('👍', 'a', '', 'dara_k')], ME);
    expect(groups[0].names).toEqual(['dara_k']);
  });

  it('falls back again when neither is known', () => {
    const groups = groupReactions([react('👍', 'a')], ME);
    expect(groups[0].names).toEqual(['Someone']);
  });

  it('summarises the tail rather than listing everyone', () => {
    const many = Array.from({ length: 10 }, (_, i) => react('👍', `u${i}`, `Person ${i}`));
    const [group] = groupReactions(many, ME);
    expect(group.count).toBe(10);
    expect(group.names).toHaveLength(7);
    expect(group.names.at(-1)).toBe('and 4 more');
  });

  it('counts you within the total, not on top of it', () => {
    const groups = groupReactions([react('👍', ME, 'Me'), react('👍', 'a', 'Dara')], ME);
    expect(groups[0].count).toBe(2);
  });

  it('returns nothing for a message with no reactions', () => {
    expect(groupReactions([], ME)).toEqual([]);
  });
});
