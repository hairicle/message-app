'use client';

import { useState } from 'react';
import type { Conversation } from '@messenger/shared';
import { getConversationTitle, getOtherMember } from '../utils/conversation';
import { messagePreview } from '../utils/messagePreview';
import { FaBellSlash } from 'react-icons/fa6';
import { Avatar, SearchInput } from './ui';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  currentUserId: string;
  presence: Record<string, 'online' | 'offline'>;
  onSelect: (id: string) => void;
}

export function ConversationList({
  conversations,
  selectedId,
  currentUserId,
  presence,
  onSelect,
}: ConversationListProps) {
  const [search, setSearch] = useState('');

  const filtered = conversations.filter((c) => {
    if (!search.trim()) return true;
    const title = getConversationTitle(c, currentUserId).toLowerCase();
    return title.includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search — matches TeamWorkspace "Find a team…" */}
      <div className="px-5 pb-4 flex-shrink-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Find a conversation…" />
      </div>

      {/* Conversation rows — mirrors TeamWorkspace team rows exactly */}
      <ul className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {filtered.length === 0 && (
          <li className="text-center py-8 text-[13px]" style={{ color: 'var(--text-dim)' }}>
            {search ? 'No conversations found' : 'No conversations yet.'}
          </li>
        )}
        {filtered.map((conversation) => {
          const title = getConversationTitle(conversation, currentUserId);
          const other = conversation.type === 'direct' ? getOtherMember(conversation, currentUserId) : null;
          const isOnline = other ? presence[other.user_id] === 'online' : false;
          const isActive = conversation.id === selectedId;
          const unread = conversation.unread_count ?? 0;

          // Last message preview — attachments read as "Name sent a photo" rather than an
          // emoji the reader has to decode.
          const lm = conversation.last_message;
          const preview = lm
            ? messagePreview({
                type: lm.type,
                ciphertext: lm.ciphertext,
                senderName: lm.sender_display_name,
                deleted: !!lm.deleted_at,
              })
            : '';

          const subtitleText = other
            ? isOnline ? '● Online' : '○ Offline'
            : preview || (conversation.type === 'group' ? 'Group' : 'Channel');

          return (
            <li key={conversation.id}>
              <button
                onClick={() => onSelect(conversation.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors"
                style={{
                  background: isActive ? 'var(--accent-wash)' : 'transparent',
                }}
              >
                {/* Square avatar */}
                <Avatar name={title} avatarUrl={other ? other.avatar_url : conversation.avatar_url} size={36} radius={8} fontSize={13} showPresence={!!other} online={isOnline} />

                {/* Name + subtitle */}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium truncate flex items-center gap-1.5" style={{ color: isActive ? 'var(--text)' : 'var(--text-muted)' }}>
                    <span className="truncate">{title}</span>
                    {/* Said out loud, or a conversation that never makes a sound looks broken
                        rather than muted. */}
                    {conversation.is_muted && (
                      <FaBellSlash size={10} className="flex-shrink-0" style={{ color: 'var(--text-dim)' }} title="Muted" />
                    )}
                  </p>
                  <p
                    className="text-[12px] truncate font-mono"
                    style={{
                      color: other
                        ? isOnline ? 'var(--accent)' : 'var(--text-dim)'
                        : 'var(--text-dim)',
                    }}
                  >
                    {preview
                      ? preview
                      : subtitleText}
                  </p>
                </div>

                {/* Unread badge */}
                {unread > 0 && !isActive && (
                  <span
                    className="text-[11px] font-bold rounded-full flex-shrink-0"
                    style={{ background: 'var(--danger)', color: '#fff', minWidth: 18, textAlign: 'center', padding: '2px 5px' }}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
