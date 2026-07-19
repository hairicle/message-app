import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBullhorn, faMessage, faUsers, faGauge, faRightFromBracket, faSun, faMoon, faComments, faGlobe, faBuilding } from '@fortawesome/free-solid-svg-icons';

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
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Reset inner detail when switching sections
  useEffect(() => { setMobileDetailOpen(false); }, [section]);

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
  function NavItem({ id, label, icon, badge, bottom }: { id: Section; label: string; icon: React.ReactNode; badge?: number; bottom?: boolean }) {
    const active = section === id;
    return (
      <button
        onClick={() => {
          setSection(id);
          if (id === 'teams') {
            setConversations((prev) =>
              prev.map((c) => c.type === 'channel' && c.team_id ? { ...c, unread_count: 0 } : c)
            );
          }
          if (id === 'announcements') {
            setConversations((prev) =>
              prev.map((c) => c.type === 'channel' && !c.team_id ? { ...c, unread_count: 0 } : c)
            );
          }
        }}
        className={`relative flex flex-col items-center gap-1 transition-colors rounded-xl ${bottom ? 'flex-1 py-2 px-1' : 'w-full py-3 px-1'}`}
        style={{ color: active ? 'var(--accent)' : 'var(--text-dim)', background: active ? 'var(--accent-wash)' : 'transparent' }}
        title={label}
      >
        <span className="relative inline-flex">
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

      {/* ── Icon navigation — desktop only, replaced by bottom bar on mobile ── */}
      <nav className="hidden sm:flex w-16 flex-col items-center py-3 gap-1 flex-shrink-0" style={{ background: 'var(--bg)', borderRight: '1px solid var(--border)' }}>
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

        <NavItem id="chat" label="Chat" badge={chatUnread} icon={<FontAwesomeIcon icon={faMessage} style={{ fontSize: 18 }} />} />
        <NavItem id="teams" label="Teams" badge={teamUnread} icon={<FontAwesomeIcon icon={faUsers} style={{ fontSize: 18 }} />} />
        <NavItem id="announcements" label="Announce" badge={announceUnread} icon={<FontAwesomeIcon icon={faBullhorn} style={{ fontSize: 18 }} />} />
        {user.role === 'admin' && (
          <NavItem id="dashboard" label="Dashboard" icon={<FontAwesomeIcon icon={faGauge} style={{ fontSize: 18 }} />} />
        )}

        <div className="flex-1" />
        <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="transition-colors p-2 rounded-xl mb-1 hover-panel-alt" style={{ color: 'var(--text-dim)' }}>
          <FontAwesomeIcon icon={theme === 'dark' ? faSun : faMoon} style={{ fontSize: 18 }} />
        </button>
        <button onClick={logout} className="transition-colors p-2 rounded-xl hover-panel-alt" style={{ color: 'var(--text-dim)' }} title="Sign out">
          <FontAwesomeIcon icon={faRightFromBracket} style={{ fontSize: 18 }} />
        </button>
      </nav>

      {/* ── Secondary panel ─────────────────────────────────────────────── */}
      <aside className={
        section === 'dashboard' || section === 'teams' || section === 'announcements'
          ? 'hidden'
          : selectedId
            ? 'hidden sm:flex sm:flex-col sm:flex-shrink-0 sm:w-72'
            : 'flex flex-col flex-shrink-0 w-full sm:w-72 sm:pb-0'
      } style={{ background: 'var(--bg)', borderRight: '1px solid var(--border)', paddingBottom: selectedId ? undefined : 'calc(56px + env(safe-area-inset-bottom))' }}>

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
                        <FontAwesomeIcon icon={faBullhorn} style={{ fontSize: 16, color: 'var(--text-dim)' }} />
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
                        <FontAwesomeIcon icon={faBullhorn} style={{ fontSize: 16, color: 'var(--text-dim)' }} />
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
                  <FontAwesomeIcon icon={faBullhorn} style={{ fontSize: 36, opacity: 0.4, color: 'var(--text-dim)' }} />
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
      <main className={`flex-1 flex-col min-w-0 overflow-hidden ${section === 'chat' && !selectedId ? 'hidden sm:flex' : 'flex'}`}>

        {/* Teams: full workspace replaces both sidebar and main content */}
        {section === 'teams' ? (
          <TeamWorkspace onMobileDetailChange={setMobileDetailOpen} />
        ) : section === 'announcements' ? (
          <AnnounceWorkspace onMobileDetailChange={setMobileDetailOpen} />
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
            <FontAwesomeIcon icon={faComments} style={{ fontSize: 64, opacity: 0.2 }} />
            <p className="text-sm">Select a conversation to start chatting</p>
          </div>
        )}
      </main>

      {/* ── Mobile bottom tab bar ───────────────────────────────────────── */}
      <nav className={`sm:hidden fixed bottom-0 inset-x-0 z-50 ${(section === 'chat' && selectedId) || mobileDetailOpen ? 'hidden' : 'flex'}`} style={{ background: 'var(--bg)', borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom)', minHeight: 56 }}>
        <NavItem bottom id="chat" label="Chat" badge={chatUnread} icon={<FontAwesomeIcon icon={faMessage} style={{ fontSize: 18 }} />} />
        <NavItem bottom id="teams" label="Teams" badge={teamUnread} icon={<FontAwesomeIcon icon={faUsers} style={{ fontSize: 18 }} />} />
        <NavItem bottom id="announcements" label="Announce" badge={announceUnread} icon={<FontAwesomeIcon icon={faBullhorn} style={{ fontSize: 18 }} />} />
        {user.role === 'admin' && (
          <NavItem bottom id="dashboard" label="Dashboard" icon={<FontAwesomeIcon icon={faGauge} style={{ fontSize: 18 }} />} />
        )}
        <button
          onClick={() => setShowProfile(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-1 transition-colors"
          style={{ color: 'var(--text-dim)' }}
          title="My profile"
        >
          <span className="relative w-6 h-6 rounded-full overflow-hidden flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
            style={{ backgroundColor: avatarBg(user.username) }}>
            {user.avatarUrl && (
              <img src={user.avatarUrl} alt={user.displayName}
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            )}
            {user.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-[10px] font-medium leading-none">Me</span>
        </button>
      </nav>
    </div>
  );
}
