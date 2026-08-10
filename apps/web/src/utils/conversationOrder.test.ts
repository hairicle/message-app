import { describe, it, expect } from 'vitest';
import type { Conversation } from '@messenger/shared';
import { sortConversations } from './conversationOrder';

const conv = (id: string, pinned = false) => ({ id, is_pinned: pinned }) as Conversation;
const ids = (list: Conversation[]) => list.map((c) => c.id);

describe('sortConversations', () => {
  it('lifts pinned conversations above the rest', () => {
    expect(ids(sortConversations([conv('a'), conv('b', true), conv('c')]))).toEqual(['b', 'a', 'c']);
  });

  // The reason this exists: a new message moves its row to the top of the list.
  it('keeps a newly-active unpinned conversation below the pinned ones', () => {
    const afterNewMessage = [conv('busy'), conv('pinned', true), conv('quiet')];
    expect(ids(sortConversations(afterNewMessage))).toEqual(['pinned', 'busy', 'quiet']);
  });

  it('preserves the order within each group', () => {
    const list = [conv('p1', true), conv('p2', true), conv('u1'), conv('u2')];
    expect(ids(sortConversations(list))).toEqual(['p1', 'p2', 'u1', 'u2']);
  });

  it('leaves a list with nothing pinned untouched', () => {
    expect(ids(sortConversations([conv('a'), conv('b'), conv('c')]))).toEqual(['a', 'b', 'c']);
  });

  it('treats a missing flag as not pinned', () => {
    const list = [{ id: 'a' } as Conversation, conv('b', true)];
    expect(ids(sortConversations(list))).toEqual(['b', 'a']);
  });

  it('does not mutate the list it is given', () => {
    const list = [conv('a'), conv('b', true)];
    sortConversations(list);
    expect(ids(list)).toEqual(['a', 'b']);
  });

  it('handles an empty list', () => {
    expect(sortConversations([])).toEqual([]);
  });
});
