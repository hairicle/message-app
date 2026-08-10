'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api/client';
import * as conversationsApi from '../lib/api/conversations';
import { FaPen, FaRegPaperPlane } from 'react-icons/fa6';
import { useAuth } from '../context/AuthContext';
import { formatLastSeen } from '../utils/lastSeen';
import { Badge } from './ui';

/**
 * How the card asks the app to do something it cannot reach itself.
 *
 * It is rendered from inside Avatar, which appears in message rows, member lists and headers
 * alike — none of which know about conversation selection. Threading a callback through every one
 * of those call sites to serve a single button would be a lot of prop for very little, so the
 * card announces the intent and the chat page acts on it.
 */
export const OPEN_CONVERSATION_EVENT = 'messenger:open-conversation';
export const OPEN_OWN_PROFILE_EVENT = 'messenger:open-own-profile';

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  department: string | null;
  role: string;
  lastSeenAt?: string | null;
}

interface UserProfileCardProps {
  userId: string;
  /** Shown immediately so the card never opens blank while the fetch is in flight. */
  fallbackName: string;
  fallbackAvatarUrl?: string | null;
  online?: boolean;
  onClose: () => void;
}

/**
 * The card shown when you click a colleague's avatar. Their photo alone is not much use — this
 * adds who they are, so the avatar becomes a way to identify someone rather than just an image.
 */
export function UserProfileCard({
  userId, fallbackName, fallbackAvatarUrl, online, onClose,
}: UserProfileCardProps) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ profile: PublicProfile }>(`/api/users/${userId}`)
      .then(({ profile }) => { if (!cancelled) setProfile(profile); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape closes the enlarged photo first, then the card.
      if (photoOpen) setPhotoOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, photoOpen]);

  const { user } = useAuth();
  const isSelf = user?.id === userId;
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  /**
   * Open a direct conversation with this person.
   *
   * The server returns the existing one when there is already a pair, so pressing this twice does
   * not leave two chats each holding half the history.
   */
  async function startConversation() {
    setOpening(true);
    setOpenError(null);
    try {
      const { conversation } = await conversationsApi.createConversation({
        type: 'direct',
        memberIds: [userId],
      });
      window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: { conversationId: conversation.id } }));
      onClose();
    } catch (err) {
      setOpenError((err as Error).message || 'Could not open a conversation');
      setOpening(false);
    }
  }

  const name = profile?.displayName ?? fallbackName;
  const avatar = profile?.avatarUrl ?? fallbackAvatarUrl ?? null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name}'s profile`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[300px] rounded-2xl overflow-hidden"
        style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}
      >
        <div className="flex flex-col items-center px-6 pt-6 pb-5">
          {/* Photo, enlargeable — the previous behaviour, kept rather than replaced. */}
          <button
            type="button"
            onClick={() => avatar && setPhotoOpen(true)}
            disabled={!avatar}
            aria-label={avatar ? `View ${name}'s photo full size` : undefined}
            className={`relative mb-3 ${avatar ? 'cursor-pointer transition-opacity hover:opacity-85' : 'cursor-default'}`}
            style={{ width: 88, height: 88 }}
          >
            <span
              className="absolute inset-0 overflow-hidden flex items-center justify-center font-mono font-bold select-none"
              style={{ borderRadius: 22, border: '1px solid var(--border)', background: 'var(--panel-alt)', fontSize: 32, color: 'var(--accent)' }}
            >
              {name.slice(0, 1).toUpperCase()}
              {avatar && <img src={avatar} alt={name} className="absolute inset-0 w-full h-full object-cover" />}
            </span>
            {online !== undefined && (
              <span
                className="absolute right-0 bottom-0 rounded-full"
                style={{ width: 20, height: 20, background: online ? 'var(--success)' : 'var(--text-dim)', border: '3px solid var(--panel)' }}
              />
            )}
          </button>

          <h3 className="text-[17px] font-bold text-center leading-snug" style={{ color: 'var(--text)' }}>{name}</h3>
          {profile && (
            <p className="font-mono text-[12.5px] mt-0.5" style={{ color: 'var(--text-dim)' }}>@{profile.username}</p>
          )}

          {/* Only when they are away: "last seen" about someone who is here reads as a mistake. */}
          {profile && online === false && formatLastSeen(profile.lastSeenAt) && (
            <p className="text-[11.5px] font-mono mt-1.5" style={{ color: 'var(--text-dim)' }}>
              Last seen {formatLastSeen(profile.lastSeenAt)}
            </p>
          )}

          {profile && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3">
              <Badge tone={profile.role === 'admin' ? 'warning' : 'neutral'}>{profile.role}</Badge>
              {online !== undefined && (
                <Badge tone={online ? 'success' : 'neutral'}>{online ? 'Online' : 'Offline'}</Badge>
              )}
            </div>
          )}
        </div>

        {profile && (
          <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="font-mono text-[10.5px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>
              Department
            </p>
            <p className="text-[14px]" style={{ color: profile.department ? 'var(--text)' : 'var(--text-dim)' }}>
              {profile.department ?? 'Not assigned'}
            </p>
          </div>
        )}

        {profile && (
          <div className="px-6 pb-5 pt-4">
            {isSelf ? (
              <button
                type="button"
                onClick={() => { window.dispatchEvent(new CustomEvent(OPEN_OWN_PROFILE_EVENT)); onClose(); }}
                className="btn-ghost w-full justify-center"
              >
                <FaPen size={12} /> Edit profile
              </button>
            ) : (
              <button
                type="button"
                onClick={startConversation}
                disabled={opening}
                className="btn-primary w-full justify-center disabled:opacity-40"
              >
                <FaRegPaperPlane size={12} /> {opening ? 'Opening…' : 'Message'}
              </button>
            )}
            {openError && <p className="mt-2 text-[11px] text-center" style={{ color: 'var(--danger)' }}>{openError}</p>}
          </div>
        )}

        {!profile && (
          <div className="px-6 pb-5 text-center font-mono text-[12px]" style={{ color: 'var(--text-dim)' }}>
            {failed ? 'Could not load this profile.' : 'Loading…'}
          </div>
        )}
      </div>

      {photoOpen && avatar && (
        <div
          className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-black/90"
          onClick={(e) => { e.stopPropagation(); setPhotoOpen(false); }}
        >
          <img
            src={avatar}
            alt={name}
            onClick={(e) => e.stopPropagation()}
            className="block max-w-[85vw] max-h-[75vh] rounded-2xl object-contain"
            style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
          />
          <p className="mt-4 font-mono text-[13px] text-white/80">{name}</p>
        </div>
      )}
    </div>
  );
}
