'use client';

import React from 'react';
import { FaMagnifyingGlass } from 'react-icons/fa6';
import { UserProfileCard } from './UserProfileCard';

/**
 * Shared visual primitives used across Chat, Teams, Announce, and the Admin
 * Dashboard so the four features render identically instead of each hand-
 * rolling its own avatar/badge/button markup. Backed by the `.btn-*`,
 * `.input-base`, `.avatar-box` classes and CSS variables in globals.css.
 */

// ── Avatar ─────────────────────────────────────────────────────────────────
interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  radius?: number;
  fontSize?: number;
  online?: boolean;
  showPresence?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  /**
   * Opens that person's profile card on click — who they are, not just their photo, with the
   * photo still enlargeable from inside the card. Needs the user's id to fetch the profile.
   */
  profileUserId?: string | null;
}

export function Avatar({
  name, avatarUrl, size = 32, radius = 7, fontSize, online, showPresence, className = '', style, title,
  profileUserId,
}: AvatarProps) {
  const fs = fontSize ?? Math.max(10, Math.round(size * 0.4));
  const dotSize = Math.max(8, Math.round(size * 0.28));
  const [broken, setBroken] = React.useState(false);
  const [viewing, setViewing] = React.useState(false);

  // Unlike the photo-only version this replaces, a profile is worth opening even for someone with
  // no picture — the name, handle and department are the point.
  const canView = !!profileUserId;

  // A span rather than a button: several call sites render avatars inside a clickable row, and a
  // nested button is invalid markup. Click propagation is stopped so opening the photo does not
  // also trigger that row.
  const open = (e: React.SyntheticEvent) => {
    if (!canView) return;
    e.stopPropagation();
    setViewing(true);
  };

  const label = canView ? `View ${name}'s profile` : undefined;

  return (
    <div className={`relative flex-shrink-0 ${className}`} style={{ width: size, height: size, ...style }} title={title}>
      <div
        role={canView ? 'button' : undefined}
        tabIndex={canView ? 0 : undefined}
        aria-label={label}
        onClick={open}
        onKeyDown={(e) => { if (canView && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(e); } }}
        className={`absolute inset-0 overflow-hidden ${canView ? 'cursor-pointer transition-opacity hover:opacity-85' : ''}`}
        style={{ borderRadius: radius, border: '1px solid var(--border)', background: 'var(--panel-alt)' }}
      >
        <span className="absolute inset-0 flex items-center justify-center font-mono font-bold select-none" style={{ fontSize: fs, color: 'var(--accent)' }}>
          {name.slice(0, 1).toUpperCase()}
        </span>
        {avatarUrl && !broken && (
          <img src={avatarUrl} alt={name} className="absolute inset-0 w-full h-full object-cover"
            onError={() => setBroken(true)} />
        )}
      </div>
      {showPresence && (
        <span className="absolute -right-0.5 -bottom-0.5 rounded-full"
          style={{ width: dotSize, height: dotSize, background: online ? 'var(--success)' : 'var(--text-dim)', border: '1.5px solid var(--bg)' }} />
      )}
      {viewing && profileUserId && (
        <UserProfileCard
          userId={profileUserId}
          fallbackName={name}
          fallbackAvatarUrl={avatarUrl}
          online={showPresence ? online : undefined}
          onClose={() => setViewing(false)}
        />
      )}
    </div>
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────
type BadgeTone = 'neutral' | 'accent' | 'warning' | 'danger' | 'success';

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'text-[var(--text-muted)] border-[var(--border)]',
  accent: 'text-[var(--accent)] border-[var(--accent-dim)] bg-[var(--accent-wash)]',
  warning: 'text-[var(--warning)] border-[var(--warning-border)] bg-[var(--warning-wash)]',
  danger: 'text-[var(--danger)] border-[var(--danger-border)] bg-[var(--danger-wash)]',
  success: 'text-[var(--success)] border-[var(--success-border)] bg-[var(--success-wash)]',
};

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`font-mono text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${BADGE_TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

// ── SearchInput ────────────────────────────────────────────────────────────
interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder, className = '' }: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <FaMagnifyingGlass size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-dim)' }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-base w-full"
        style={{ paddingLeft: 32 }}
      />
    </div>
  );
}

// ── StatusDot ──────────────────────────────────────────────────────────────
export function StatusDot({ ok = true, okLabel = 'ALL SYSTEMS NORMAL', badLabel = 'ATTENTION NEEDED' }: { ok?: boolean; okLabel?: string; badLabel?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[13px] tracking-wide" style={{ color: ok ? 'var(--accent)' : 'var(--danger)' }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: ok ? 'var(--accent)' : 'var(--danger)', boxShadow: `0 0 6px ${ok ? 'var(--accent)' : 'var(--danger)'}` }} />
      {ok ? okLabel : badLabel}
    </span>
  );
}
