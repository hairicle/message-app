import type { Conversation } from '@messenger/shared';

export function getConversationTitle(conversation: Conversation, currentUserId: string): string {
  if (conversation.name) {
    return conversation.name;
  }

  if (conversation.type === 'direct') {
    const other = conversation.members?.find((m) => m.user_id !== currentUserId);
    return other?.display_name ?? 'Direct message';
  }

  return conversation.type === 'channel' ? 'Untitled channel' : 'Untitled group';
}

export function getOtherMember(conversation: Conversation, currentUserId: string) {
  return conversation.members?.find((m) => m.user_id !== currentUserId) ?? null;
}
