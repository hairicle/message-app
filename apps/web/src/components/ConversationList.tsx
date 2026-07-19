'use client';

import { useState } from 'react';
import type { Conversation } from '@messenger/shared';
import { getConversationTitle, getOtherMember } from '../utils/conversation';
import { decodeMessageText } from '../utils/text';

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
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a conversation…"
            className="w-full pl-8 pr-3 py-2 rounded-lg text-[13px] focus:outline-none"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontSize: 13,
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--accent-dim)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
          />
        </div>
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

          // Last message preview
          let preview = '';
          if (conversation.last_message) {
            const lm = conversation.last_message;
            if (lm.deleted_at) {
              preview = 'Message deleted';
            } else if (lm.type !== 'text') {
              const icons: Record<string, string> = { image: '📷', video: '🎥', audio: '🎤', file: '📎' };
              preview = `${lm.sender_display_name}: ${icons[lm.type] ?? '📎'}`;
            } else {
              preview = `${lm.sender_display_name}: ${decodeMessageText(lm.ciphertext)}`;
            }
          }

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
                {/* Square avatar — matches team-icon */}
                <div
                  className="flex-shrink-0 flex items-center justify-center font-mono font-bold text-[13px] relative"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    border: `1px solid ${isActive ? 'var(--accent-dim)' : 'var(--border)'}`,
                    background: isActive ? 'var(--accent-dim)' : 'var(--panel)',
                    color: isActive ? '#fff' : 'var(--accent)',
                  }}
                >
                  {title.slice(0, 1).toUpperCase()}
                  {/* Presence dot for direct messages */}
                  {other && (
                    <span
                      className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full"
                      style={{
                        background: isOnline ? '#22c55e' : 'var(--text-dim)',
                        border: '1.5px solid var(--bg)',
                      }}
                    />
                  )}
                </div>

                {/* Name + subtitle */}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium truncate" style={{ color: isActive ? 'var(--text)' : 'var(--text-muted)' }}>
                    {title}
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
