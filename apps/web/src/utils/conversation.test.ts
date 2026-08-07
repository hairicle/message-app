import { describe, it, expect } from 'vitest';
import type { Conversation } from '@messenger/shared';
import { getConversationTitle, getOtherMember } from './conversation';

const ME = 'user-me';

function conversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    type: 'direct',
    name: null,
    members: [],
    ...over,
  } as Conversation;
}

const member = (user_id: string, display_name: string) =>
  ({ user_id, display_name }) as NonNullable<Conversation['members']>[number];

describe('getConversationTitle', () => {
  it('prefers an explicit name over anything derived', () => {
    const c = conversation({ type: 'group', name: 'Design Team' });
    expect(getConversationTitle(c, ME)).toBe('Design Team');
  });

  // The regression this guards: direct chats were rendering the literal placeholder
  // "Direct message" in the sidebar instead of the other person's name.
  it('names a direct chat after the other participant, not the current user', () => {
    const c = conversation({
      members: [member(ME, 'Me'), member('user-other', 'Channa Duong')],
    });
    expect(getConversationTitle(c, ME)).toBe('Channa Duong');
  });

  it('picks the other participant regardless of member order', () => {
    const c = conversation({
      members: [member('user-other', 'Channa Duong'), member(ME, 'Me')],
    });
    expect(getConversationTitle(c, ME)).toBe('Channa Duong');
  });

  it('falls back to a placeholder when the other member is missing', () => {
    expect(getConversationTitle(conversation({ members: [member(ME, 'Me')] }), ME))
      .toBe('Direct message');
  });

  it('falls back when members is absent entirely', () => {
    expect(getConversationTitle(conversation({ members: undefined }), ME))
      .toBe('Direct message');
  });

  it('labels unnamed groups and channels differently', () => {
    expect(getConversationTitle(conversation({ type: 'group' }), ME)).toBe('Untitled group');
    expect(getConversationTitle(conversation({ type: 'channel' }), ME)).toBe('Untitled channel');
  });

  it('treats an empty name as no name', () => {
    // '' is falsy, so it must not short-circuit into rendering a blank title.
    const c = conversation({ type: 'group', name: '' });
    expect(getConversationTitle(c, ME)).toBe('Untitled group');
  });
});

describe('getOtherMember', () => {
  it('returns the member who is not the current user', () => {
    const other = member('user-other', 'Channa Duong');
    const c = conversation({ members: [member(ME, 'Me'), other] });
    expect(getOtherMember(c, ME)).toBe(other);
  });

  it('returns null rather than undefined when there is no other member', () => {
    expect(getOtherMember(conversation({ members: [member(ME, 'Me')] }), ME)).toBeNull();
    expect(getOtherMember(conversation({ members: undefined }), ME)).toBeNull();
  });

  it('returns the first other member in a group', () => {
    const c = conversation({
      type: 'group',
      members: [member(ME, 'Me'), member('u2', 'Dara'), member('u3', 'Nini')],
    });
    expect(getOtherMember(c, ME)?.display_name).toBe('Dara');
  });
});
