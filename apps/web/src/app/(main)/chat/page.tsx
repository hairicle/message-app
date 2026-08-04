'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBullhorn, faMessage, faUsers, faGauge, faRightFromBracket, faSun, faMoon, faComments } from '@fortawesome/free-solid-svg-icons';
import * as conversationsApi from '@/lib/api/conversations';
import * as teamsApi from '@/lib/api/teams';
import * as profileApi from '@/lib/api/profile';
import { playNotificationSound } from '@/utils/notificationSound';
import { decodeMessageText } from '@/utils/text';
import type { Conversation, Message, Team } from '@messenger/shared';
import { ConversationList } from '@/components/ConversationList';
import { MessageThread } from '@/components/MessageThread';
import { NewConversationDialog } from '@/components/NewConversationDialog';
import { AdminDashboard } from '@/components/AdminDashboard';
import { AnnounceWorkspace } from '@/components/AnnounceWorkspace';
import { ProfilePanel } from '@/components/ProfilePanel';
import { TeamWorkspace } from '@/components/TeamWorkspace';
import { Avatar } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';

type Section = 'chat' | 'teams' | 'dashboard' | 'announcements';

export default function ChatPage() {
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

  // Notification preferences — synced live from ProfilePanel via onPrefsChange, drives the sound + desktop alert below
  const [notifyPrefs, setNotifyPrefs] = useState({ soundEnabled: true, desktopEnabled: true, emailEnabled: false });
  const notifyPrefsRef = useRef(notifyPrefs);
  useEffect(() => { notifyPrefsRef.current = notifyPrefs; }, [notifyPrefs]);

  const applyNotifyPrefs = useCallback((prefs: { soundEnabled: boolean; desktopEnabled: boolean; emailEnabled: boolean }) => {
    setNotifyPrefs(prefs);
    if (prefs.desktopEnabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    profileApi.getNotificationPrefs().then(({ prefs }) => applyNotifyPrefs(prefs)).catch(() => {});
  }, [applyNotifyPrefs]);

  useEffect(() => {
    conversationsApi.listConversations().then(({ conversations }) => {
      setConversations(conversations);
      setSelectedId((cur) => cur ?? conversations[0]?.id ?? null);
    }).catch(() => {});
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
        // Only suppress team-channel messages while broadly in the Teams section (TeamWorkspace
        // manages its own open-channel state that this component can't see) — DMs and announcements
        // must still notify even while the user happens to be browsing Teams.
        const isTeamChannelActive = sectionRef.current === 'teams' && !!c.team_id;
        const shouldIncrement = !isMyMessage && !isActive && !isTeamChannelActive;

        if (shouldIncrement) {
          const prefs = notifyPrefsRef.current;
          if (prefs.soundEnabled) playNotificationSound();
          // Fires whenever this conversation isn't the one you're looking at — not gated on the
          // whole tab being backgrounded, since you're usually still "in" the app on another section.
          if (prefs.desktopEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const senderName = m.senderId ? (c.members?.find((mb) => mb.user_id === m.senderId)?.display_name ?? 'New message') : 'New message';
            const body = m.type === 'text' ? decodeMessageText(m.ciphertext) : `Sent a ${m.type === 'file' ? 'file' : m.type}`;
            try {
              new Notification(senderName, { body, tag: c.id });
            } catch (err) {
              console.warn('Desktop notification failed to display:', err);
            }
          }
        }

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

  // Unread badge counts per section
  const chatUnread     = chats.reduce((s, c) => s + (c.unread_count ?? 0), 0);
  const teamUnread     = teamChannels.reduce((s, c) => s + (c.unread_count ?? 0), 0);
  const announceUnread = announceChannels.reduce((s, c) => s + (c.unread_count ?? 0), 0);
  const totalUnread    = chatUnread + teamUnread + announceUnread;

  // Tab-title badge — mirrors the nav-rail red dots so unread state is visible even when the tab isn't focused
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread > 99 ? '99+' : totalUnread}) Internal Messenger` : 'Internal Messenger';
    return () => { document.title = 'Internal Messenger'; };
  }, [totalUnread]);

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
      {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} onPrefsChange={applyNotifyPrefs} />}

      {/* ── Icon navigation — desktop only, replaced by bottom bar on mobile ── */}
      <nav className="hidden sm:flex w-16 flex-col items-center py-3 gap-1 flex-shrink-0" style={{ background: 'var(--bg)', borderRight: '1px solid var(--border)' }}>
        {/* User avatar — click to open profile */}
        <button onClick={() => setShowProfile(true)} title="My profile"
          className="mb-3 flex-shrink-0 rounded-lg hover:ring-2 hover:ring-[var(--accent-dim)] transition-all">
          <Avatar name={user.displayName} avatarUrl={user.avatarUrl} size={36} radius={8} fontSize={14} />
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
            <div className="px-5 pt-6 pb-3 flex-shrink-0">
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

        {/* Teams and Announcements sections are handled by their own full-screen workspace components below */}

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
          <Avatar name={user.displayName} avatarUrl={user.avatarUrl} size={24} radius={7} fontSize={11} />
          <span className="text-[10px] font-medium leading-none">Me</span>
        </button>
      </nav>
    </div>
  );
}
