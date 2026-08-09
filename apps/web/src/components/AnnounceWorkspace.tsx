'use client';

import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api/client';
import * as messagesApi from '../lib/api/messages';
import type { Conversation, Message } from '@messenger/shared';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { decodeMessageText, encodeMessageText } from '../utils/text';
import { Avatar, Badge, SearchInput } from './ui';
import { Linkify } from './Linkify';
import { FaBuilding, FaBullhorn, FaChevronLeft, FaGlobe, FaLock, FaPaperPlane, FaUsers } from 'react-icons/fa6';

interface ChannelGroup {
  label: string;
  icon: React.ReactNode;
  channels: Conversation[];
}

interface ChannelMember {
  user_id: string;
  username: string;
  display_name: string;
  role: string;
}

export function AnnounceWorkspace({ onMobileDetailChange }: { onMobileDetailChange?: (open: boolean) => void }) {
  const { user } = useAuth();
  const socket = useSocket();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { onMobileDetailChange?.(!!selectedId); }, [selectedId]);

  // Load channels (type=channel only) and teams
  useEffect(() => {
    apiFetch<{ conversations: Conversation[] }>('/api/conversations')
      .then(({ conversations }) => {
        setConversations(conversations.filter((c) => c.type === 'channel'));
      }).catch(() => {});
    apiFetch<{ teams: { id: string; name: string }[] }>('/api/teams')
      .then(({ teams }) => setTeams(teams)).catch(() => {});
  }, []);

  // Load messages and members when channel changes
  useEffect(() => {
    if (!selectedId) return;
    setMessages([]);
    setMembers([]);

    messagesApi.listMessages(selectedId)
      // Backend already returns oldest → newest — no client-side reverse needed
      .then(({ messages }) => setMessages(messages))
      .catch(() => {});

    apiFetch<{ conversation: { members?: ChannelMember[] } }>(`/api/conversations/${selectedId}`)
      .then(({ conversation }) => setMembers(conversation.members ?? []))
      .catch(() => {});
  }, [selectedId]);

  // Real-time new messages
  useEffect(() => {
    if (!socket) return;
    const handler = (msg: Message) => {
      if (msg.conversationId !== selectedId) return;
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
    };
    socket.on('message:new', handler);
    return () => { socket.off('message:new', handler); };
  }, [socket, selectedId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e: { preventDefault(): void }) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !selectedId) return;
    setSending(true);
    try {
      if (socket) {
        socket.emit('message:send', { conversationId: selectedId, ciphertext: encodeMessageText(text), type: 'text' },
          (res: { ok: boolean; message?: Message }) => {
            if (res.ok && res.message) {
              setMessages((prev) => prev.some((m) => m.id === res.message!.id) ? prev : [...prev, res.message!]);
            }
          });
      } else {
        const { message } = await messagesApi.sendMessage({ conversationId: selectedId, ciphertext: encodeMessageText(text) });
        setMessages((prev) => [...prev, message]);
      }
      setDraft('');
    } finally {
      setSending(false);
    }
  }

  // Build grouped channel list
  const channels = conversations.filter((c) =>
    !search || (c.name ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const groups: ChannelGroup[] = [
    {
      label: 'General',
      icon: <FaGlobe size={11} />,
      channels: channels.filter((c) => !c.team_id),
    },
    ...teams
      .map((t) => ({
        label: t.name,
        icon: <FaBuilding size={11} />,
        channels: channels.filter((c) => c.team_id === t.id),
      }))
      .filter((g) => g.channels.length > 0),
  ];

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const isAdmin = user?.role === 'admin' || members.find((m) => m.user_id === user?.id)?.role === 'owner';

  return (
    <div className="flex-1 flex overflow-hidden" style={{ fontFamily: 'var(--font-sans)' }}>

      {/* ── LEFT: channel list ── */}
      <div className={`flex-col flex-shrink-0 lg:w-[260px] ${selectedId ? 'hidden lg:flex' : 'flex w-full'}`} style={{ borderRight: '1px solid var(--border)', background: 'var(--bg)' }}>
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center gap-2 mb-4">
            <FaBullhorn size={16} style={{ color: 'var(--accent)' }} />
            <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>Announcements</h1>
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Find a channel…" />
        </div>

        <div className="flex-1 overflow-y-auto pb-4">
          {groups.map((g) => g.channels.length > 0 && (
            <div key={g.label} className="mb-3">
              <div className="flex items-center gap-1.5 px-4 py-1">
                <span style={{ color: 'var(--text-dim)' }}>{g.icon}</span>
                <span className="font-mono text-[9.5px] uppercase tracking-widest font-bold truncate" style={{ color: 'var(--text-dim)' }}>
                  {g.label}
                </span>
              </div>
              {g.channels.map((c) => {
                const active = c.id === selectedId;
                return (
                  <button key={c.id} onClick={() => setSelectedId(c.id)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors"
                    style={{ background: active ? 'var(--accent-wash)' : 'transparent' }}>
                    <FaBullhorn size={14} style={{ flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-medium truncate" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {c.name ?? 'Unnamed'}
                      </p>
                    </div>
                    {(c.unread_count ?? 0) > 0 && (
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: 'var(--danger)', color: '#fff', minWidth: 18, textAlign: 'center' }}>
                        {c.unread_count! > 99 ? '99+' : c.unread_count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {groups.every((g) => g.channels.length === 0) && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 px-6 text-center">
              <FaBullhorn size={32} style={{ color: 'var(--text-dim)', opacity: 0.4 }} />
              <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
                No announcement channels yet
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── CENTER: channel feed ── */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--bg)' }}>
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <button onClick={() => setSelectedId(null)} className="lg:hidden p-2 -ml-1 rounded-xl transition-colors flex-shrink-0" style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }} aria-label="Back">
              <FaChevronLeft size={16} />
            </button>
            <FaBullhorn size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-[18px] font-semibold truncate" style={{ color: 'var(--text)' }}>{selected.name}</p>
              <p className="text-[14px]" style={{ color: 'var(--text-dim)' }}>
                {selected.description ?? 'Broadcast channel'} · {members.length} subscribers
              </p>
            </div>
            <button onClick={() => setShowInfo((v) => !v)} className="btn-ghost">
              <FaUsers size={13} /> {members.length}
            </button>
          </div>

          {/* Channel-only notice for non-admins */}
          {!isAdmin && (
            <div className="flex items-center gap-2 px-6 py-2 flex-shrink-0" style={{ background: 'var(--panel-alt)', borderBottom: '1px solid var(--border)' }}>
              <FaLock size={12} style={{ color: 'var(--text-dim)' }} />
              <p className="text-[13px] font-mono" style={{ color: 'var(--text-dim)' }}>
                This is a broadcast channel — only admins and owners can post
              </p>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-5" style={{ background: 'var(--bg)' }}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <FaBullhorn size={36} style={{ opacity: 0.3 }} />
                <p className="text-[13px]" style={{ color: 'var(--text-dim)' }}>No announcements yet</p>
              </div>
            )}
            {messages.map((m) => {
              const sender = members.find((mb) => mb.user_id === m.senderId);
              const isMe = m.senderId === user?.id;
              return (
                <div key={m.id} className="flex gap-3">
                  <Avatar name={sender?.display_name ?? 'U'} size={36} radius={8} fontSize={13} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-[15px] font-semibold" style={{ color: isMe ? 'var(--accent)' : 'var(--text)' }}>
                        {sender?.display_name ?? 'Unknown'}
                      </span>
                      <span className="font-mono text-[12.5px]" style={{ color: 'var(--text-dim)' }}>
                        {new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="rounded-xl px-4 py-3 inline-block max-w-[85%]"
                      style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
                      <p className="text-[15px] whitespace-pre-wrap break-words leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        {m.deletedAt ? <em style={{ color: 'var(--text-dim)' }}>Message deleted</em> : <Linkify text={decodeMessageText(m.ciphertext)} linkStyle={{ color: 'var(--accent)' }} />}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Composer — only visible to admins/owners */}
          {isAdmin && (
            <form onSubmit={handleSend} className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
              style={{ borderTop: '1px solid var(--border)', background: 'var(--panel)' }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
                placeholder={`Post to ${selected.name}…`}
                className="input-base flex-1" />
              <button type="submit" disabled={!draft.trim() || sending} className="btn-primary disabled:opacity-40">
                <FaPaperPlane size={13} /> Post
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg)' }}>
          <FaBullhorn size={48} style={{ color: 'var(--text-dim)', opacity: 0.3 }} />
          <p className="text-[13px]" style={{ color: 'var(--text-dim)' }}>Select a channel to read announcements</p>
        </div>
      )}

      {/* ── RIGHT: subscriber list — desktop only ── */}
      {selected && showInfo && members.length > 0 && (
        <div className="hidden lg:flex flex-shrink-0 flex-col overflow-hidden" style={{ width: 240, borderLeft: '1px solid var(--border)', background: 'var(--bg)' }}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="font-mono text-[12.5px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
              Subscribers · {members.length}
            </p>
          </div>
          <div className="overflow-y-auto flex-1 py-3">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2.5 px-4 py-2">
                <Avatar name={m.display_name} size={32} radius={7} fontSize={12} />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] truncate" style={{ color: 'var(--text)' }}>{m.display_name}</p>
                  <p className="font-mono text-[12px]" style={{ color: 'var(--text-dim)' }}>@{m.username}</p>
                </div>
                {(m.role === 'owner' || m.role === 'admin') && (
                  <Badge tone="warning">{m.role}</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
