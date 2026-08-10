'use client';

import { useRef, useState } from 'react';
import type { Conversation } from '@messenger/shared';
import { getConversationTitle, getOtherMember } from '../utils/conversation';
import { messagePreview } from '../utils/messagePreview';
import { FaBell, FaBellSlash, FaThumbtack } from 'react-icons/fa6';
import { Avatar, SearchInput } from './ui';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  currentUserId: string;
  presence: Record<string, 'online' | 'offline'>;
  onSelect: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onToggleMute: (id: string, muted: boolean) => void;
}

export function ConversationList({
  conversations,
  selectedId,
  currentUserId,
  presence,
  onSelect,
  onTogglePin,
  onToggleMute,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  /** The row whose menu is open, and where to draw it. */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const longPressRef = useRef<number | null>(null);

  const menuFor = menu ? conversations.find((c) => c.id === menu.id) ?? null : null;

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
                // Right-click here rather than a row of hover buttons: pinning and muting are
                // occasional, and a control that is always visible costs every row width it
                // could have given the name.
                onContextMenu={(e) => { e.preventDefault(); setMenu({ id: conversation.id, x: e.clientX, y: e.clientY }); }}
                onTouchStart={(e) => {
                  const { clientX, clientY } = e.touches[0];
                  longPressRef.current = window.setTimeout(() => setMenu({ id: conversation.id, x: clientX, y: clientY }), 450);
                }}
                onTouchEnd={() => { if (longPressRef.current) window.clearTimeout(longPressRef.current); }}
                onTouchMove={() => { if (longPressRef.current) window.clearTimeout(longPressRef.current); }}
                className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors"
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
                    {conversation.is_pinned && (
                      <FaThumbtack size={9} className="flex-shrink-0" style={{ color: 'var(--text-dim)' }} title="Pinned" />
                    )}
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

      {/* One menu for the whole list, drawn where the pointer was and clamped so it cannot open
          off-screen. */}
      {menu && menuFor && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
          />
          <div
            className="fixed z-50 w-52 rounded-xl overflow-hidden py-1"
            style={{
              top: Math.min(menu.y, typeof window !== 'undefined' ? window.innerHeight - 130 : menu.y),
              left: Math.min(menu.x, typeof window !== 'undefined' ? window.innerWidth - 220 : menu.x),
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
            }}
          >
            <button
              type="button"
              onClick={() => { onTogglePin(menuFor.id, !menuFor.is_pinned); setMenu(null); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt"
              style={{ color: 'var(--text-muted)' }}
            >
              <FaThumbtack size={12} style={{ color: 'var(--text-dim)' }} />
              {menuFor.is_pinned ? 'Unpin' : 'Pin to top'}
            </button>
            <button
              type="button"
              onClick={() => { onToggleMute(menuFor.id, !menuFor.is_muted); setMenu(null); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt"
              style={{ color: 'var(--text-muted)' }}
            >
              {menuFor.is_muted ? <FaBell size={12} style={{ color: 'var(--text-dim)' }} /> : <FaBellSlash size={12} style={{ color: 'var(--text-dim)' }} />}
              {menuFor.is_muted ? 'Unmute' : 'Mute notifications'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
