import { apiFetch } from './client';
import type { Conversation, ConversationAttachmentItem, ConversationMediaItem, ConversationType, DirectoryUser } from '@messenger/shared';

export function listConversations() {
  return apiFetch<{ conversations: Conversation[] }>('/api/conversations');
}

export function getConversation(id: string) {
  return apiFetch<{ conversation: Conversation }>(`/api/conversations/${id}`);
}

export function createConversation(input: { type: ConversationType; name?: string; memberIds: string[] }) {
  return apiFetch<{ conversation: Conversation }>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Group picture. The server re-checks that the caller is an owner or admin. */
export function uploadConversationAvatar(id: string, file: Blob, fileName = 'avatar.png') {
  const fd = new FormData();
  fd.append('avatar', file, fileName);
  return apiFetch<{ conversation: { id: string; avatar_url: string | null } }>(
    `/api/conversations/${id}/avatar`,
    { method: 'POST', body: fd },
  );
}

export function listDirectory() {
  return apiFetch<{ users: DirectoryUser[] }>('/api/users/directory');
}

export function getConversationMedia(id: string) {
  return apiFetch<{ media: ConversationMediaItem[] }>(`/api/conversations/${id}/media`);
}

export function getConversationAttachments(id: string, types: string[]) {
  return apiFetch<{ items: ConversationAttachmentItem[] }>(
    `/api/conversations/${id}/attachments?types=${types.join(',')}`,
  );
}
