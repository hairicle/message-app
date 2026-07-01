import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext';

const AVATAR_HEX = [
  '#6366f1','#a855f7','#ec4899','#ef4444','#f97316',
  '#273c8d','#3d52a8','#1a2d6b','#4a6fa8','#2d4a9e',
];
function avatarBg(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_HEX[Math.abs(h) % AVATAR_HEX.length];
}
import * as conversationsApi from '../api/conversations';
import * as teamsApi from '../api/teams';
import type { Conversation, Message, Team } from '../api/types';
import { ConversationList } from '../components/ConversationList';
import { MessageThread } from '../components/MessageThread';
import { NewConversationDialog } from '../components/NewConversationDialog';
import { AdminDashboard } from '../components/AdminDashboard';
import { AnnounceWorkspace } from '../components/AnnounceWorkspace';
import { ProfilePanel } from '../components/ProfilePanel';
import { TeamWorkspace } from '../components/TeamWorkspace';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

type Section = 'chat' | 'teams' | 'dashboard' | 'announcements';

export function ChatPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const socket = useSocket();

  const [section, setSection] = useState<Section>('chat');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presence, setPresence] = useState<Record<string, 'online' | 'offline'>>({});

  // Refs so socket handlers always see the latest values (avoid stale closure)
  const selectedIdRef = useRef<string | null>(null);
  const sectionRef = useRef<Section>('chat');
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { sectionRef.current = section; }, [section]);

  // Teams state
  const [showProfile, setShowProfile] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    conversationsApi.listConversations().then(({ conversations }) => {
      setConversations(conversations);
      setSelectedId((cur) => cur ?? conversations[0]?.id ?? null);
    });
    teamsApi.listMyTeams().then(({ teams }) => setTeams(teams)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onInit = (p: { onlineUserIds: string[] }) => {
      const s: Record<string, 'online' | 'offline'> = {};
      for (const id of p.onlineUserIds) s[id] = 'online';
      setPresence(s);
    };
    const onUpdate = (p: { userId: string; status: 'online' | 'offline' }) =>
      setPresence((prev) => ({ ...prev, [p.userId]: p.status }));
    const onMsg = (m: Message) =>
      setConversations((prev) => {
        const i = prev.findIndex((c) => c.id === m.conversationId);
        if (i === -1) return prev;
        const next = [...prev];
        const [c] = next.splice(i, 1);
        // Use refs to avoid stale closure — always see current selectedId/section
        const isMyMessage = m.senderId === user?.id;
        const isActive = c.id === selectedIdRef.current && sectionRef.current === 'chat';
        const isTeamActive = sectionRef.current === 'teams';
        const shouldIncrement = !isMyMessage && !isActive && !isTeamActive;
        next.unshift({
          ...c,
          updated_at: m.createdAt,
          unread_count: shouldIncrement ? (c.unread_count ?? 0) + 1 : c.unread_count,
        });
        return next;
      });
    const reqPresence = () => socket.emit('presence:get');
    socket.on('presence:init', onInit);
    socket.on('presence:update', onUpdate);
    socket.on('message:new', onMsg);
    socket.on('connect', reqPresence);
    if (socket.connected) reqPresence();
    return () => {
      socket.off('presence:init', onInit);
      socket.off('presence:update', onUpdate);
      socket.off('message:new', onMsg);
      socket.off('connect', reqPresence);
    };
  }, [socket]);

  function handleConversationCreated(conv: Conversation) {
    setConversations((prev) => (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]));
    setSelectedId(conv.id);
    setSection('chat');
  }

  // Separate channel types for badges
  const teamChannels    = conversations.filter((c) => c.type === 'channel' && c.team_id);
  const announceChannels = conversations.filter((c) => c.type === 'channel' && !c.team_id);
  const chats           = conversations.filter((c) => c.type !== 'channel');
  const announcements   = conversations.filter((c) => c.type === 'channel');

  // Unread badge counts per section
  const chatUnread     = chats.reduce((s, c) => s + (c.unread_count ?? 0), 0);
  const teamUnread     = teamChannels.reduce((s, c) => s + (c.unread_count ?? 0), 0);
  const announceUnread = announceChannels.reduce((s, c) => s + (c.unread_count ?? 0), 0);

  // Reset unread for a conversation when user navigates to it
  const clearConvUnread = useCallback((convId: string) => {
    setConversations((prev) =>
      prev.map((c) => c.id === convId ? { ...c, unread_count: 0 } : c),
    );
  }, []);

  if (!user) return null;

  // ── Nav item helper ──────────────────────────────────────────────────
  function NavItem({ id, label, icon, badge }: { id: Section; label: string; icon: React.ReactNode; badge?: number }) {
    const active = section === id;
    return (
      <button
        onClick={() => {
          setSection(id);
          // When switching to Teams, clear unread for all team channels
          if (id === 'teams') {
            setConversations((prev) =>
              prev.map((c) => c.type === 'channel' && c.team_id ? { ...c, unread_count: 0 } : c)
            );
          }
          // When switching to Announce, clear unread for general channels
          if (id === 'announcements') {
            setConversations((prev) =>
              prev.map((c) => c.type === 'channel' && !c.team_id ? { ...c, unread_count: 0 } : c)
            );
          }
        }}
        className="relative flex flex-col items-center gap-1 w-full py-3 px-1 transition-colors rounded-xl"
        style={{ color: active ? 'var(--accent)' : 'var(--text-dim)', background: active ? 'var(--accent-wash)' : 'transparent' }}
        title={label}
      >
        <span className="relative">
          {icon}
          {(badge ?? 0) > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
              {(badge ?? 0) > 99 ? '99+' : badge}
            </span>
          )}
        </span>
        <span className="text-[10px] font-medium leading-none">{label}</span>
      </button>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} />}

      {/* ── Icon navigation (like MS Teams left rail) ─────────────────── */}
      <nav className="w-16 flex flex-col items-center py-3 gap-1 flex-shrink-0" style={{ background: 'var(--bg)', borderRight: '1px solid var(--border)' }}>
        {/* User avatar — click to open profile */}
        <button onClick={() => setShowProfile(true)} title="My profile"
          style={{ backgroundColor: avatarBg(user.username) }}
          className="relative w-9 h-9 rounded-full mb-3 flex-shrink-0 hover:ring-2 hover:ring-white/40 transition-all overflow-hidden">
          {user.avatarUrl && (
            <img src={user.avatarUrl} alt={user.displayName}
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          )}
          <span className="absolute inset-0 flex items-center justify-center text-white text-sm font-bold">
            {user.displayName.slice(0, 1).toUpperCase()}
          </span>
        </button>

        <NavItem id="chat" label="Chat" badge={chatUnread} icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        } />

        <NavItem id="teams" label="Teams" badge={teamUnread} icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        } />

        <NavItem id="announcements" label="Announce" badge={announceUnread} icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        } />

        {user.role === 'admin' && (
          <NavItem id="dashboard" label="Dashboard" icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          } />
        )}

        <div className="flex-1" />
        {/* Theme toggle */}
        <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="transition-colors p-2 rounded-xl mb-1 hover-panel-alt" style={{ color: 'var(--text-dim)' }}>
          {theme === 'dark' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>
        <button onClick={logout} className="transition-colors p-2 rounded-xl hover-panel-alt" style={{ color: 'var(--text-dim)' }} title="Sign out">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </nav>

      {/* ── Secondary panel — hidden when dashboard or teams is active ── */}
      <aside className={`w-72 flex flex-col flex-shrink-0 ${section === 'dashboard' || section === 'teams' || section === 'announcements' ? 'hidden' : ''}`} style={{ background: 'var(--bg)', borderRight: '1px solid var(--border)' }}>

        {/* ── CHAT panel ── */}
        {section === 'chat' && (
          <>
            <div className="px-5 pt-6 pb-0 flex-shrink-0">
              <h1 className="text-[22px] font-bold tracking-tight mb-3" style={{ color: 'var(--text)' }}>Chat</h1>
            </div>
            <ConversationList
              conversations={chats}
              selectedId={selectedId}
              currentUserId={user.id}
              presence={presence}
              onSelect={(id) => { setSelectedId(id); clearConvUnread(id); }}
            />
            <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
              <NewConversationDialog onCreated={handleConversationCreated} />
            </div>
          </>
        )}

        {/* Teams section is handled by TeamWorkspace (full screen) */}

        {/* ── ANNOUNCEMENTS panel ── */}
        {section === 'announcements' && (
          <>
            <div className="px-4 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>Announcements</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>Grouped by division</p>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {(() => {
                const general = announcements.filter((c) => !c.team_id);
                return general.length > 0 ? (
                  <div className="mb-2">
                    <p className="px-4 py-1 text-[10px] font-bold font-mono uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>🌐 General</p>
                    {general.map((c) => (
                      <button key={c.id} onClick={() => setSelectedId(c.id)}
                        className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors"
                        style={selectedId === c.id ? { background: 'var(--accent-wash)', borderLeft: '2px solid var(--accent)' } : { borderLeft: '2px solid transparent' }}>
                        <span className="text-base">📢</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: selectedId === c.id ? 'var(--text)' : 'var(--text-muted)' }}>{c.name ?? 'Announcement'}</p>
                          {c.unread_count ? <span className="text-xs font-mono" style={{ color: 'var(--accent)' }}>{c.unread_count} new</span> : null}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}

              {teams.map((team) => {
                const teamChannels = announcements.filter((c) => c.team_id === team.id);
                if (teamChannels.length === 0) return null;
                return (
                  <div key={team.id} className="mb-2">
                    <p className="px-4 py-1 text-[10px] font-bold font-mono uppercase tracking-widest truncate" style={{ color: 'var(--text-dim)' }}>
                      🏢 {team.name}
                    </p>
                    {teamChannels.map((c) => (
                      <button key={c.id} onClick={() => setSelectedId(c.id)}
                        className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors"
                        style={selectedId === c.id ? { background: 'var(--accent-wash)', borderLeft: '2px solid var(--accent)' } : { borderLeft: '2px solid transparent' }}>
                        <span className="text-base">📢</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: selectedId === c.id ? 'var(--text)' : 'var(--text-muted)' }}>{c.name ?? 'Announcement'}</p>
                          {c.unread_count ? <span className="text-xs font-mono" style={{ color: 'var(--accent)' }}>{c.unread_count} new</span> : null}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}

              {announcements.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center mt-12" style={{ color: 'var(--text-dim)' }}>
                  <span className="text-4xl opacity-40">📢</span>
                  <p className="text-sm">No announcement channels yet.<br/>Create a channel conversation to get started.</p>
                </div>
              )}
            </div>

            <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
              <NewConversationDialog onCreated={handleConversationCreated} />
            </div>
          </>
        )}

      </aside>

      {/* ── Main content area ─────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Teams: full workspace replaces both sidebar and main content */}
        {section === 'teams' ? (
          <TeamWorkspace />
        ) : section === 'announcements' ? (
          <AnnounceWorkspace />
        ) : section === 'dashboard' ? (
          <AdminDashboard />
        ) : selectedId ? (
          <MessageThread
            key={selectedId}
            conversationId={selectedId}
            presence={presence}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: 'var(--text-dim)' }}>
            <svg className="w-16 h-16 opacity-20" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
              <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
            </svg>
            <p className="text-sm">Select a conversation to start chatting</p>
          </div>
        )}
      </main>
    </div>
  );
}
