'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';

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
   * Opens the photo full-size on click, the way the profile panel does for your own.
   * Ignored when the person has no photo — there is nothing to enlarge.
   */
  viewable?: boolean;
}

export function Avatar({
  name, avatarUrl, size = 32, radius = 7, fontSize, online, showPresence, className = '', style, title,
  viewable,
}: AvatarProps) {
  const fs = fontSize ?? Math.max(10, Math.round(size * 0.4));
  const dotSize = Math.max(8, Math.round(size * 0.28));
  const [broken, setBroken] = React.useState(false);
  const [viewing, setViewing] = React.useState(false);

  const hasPhoto = !!avatarUrl && !broken;
  const canView = !!viewable && hasPhoto;

  // A span rather than a button: several call sites render avatars inside a clickable row, and a
  // nested button is invalid markup. Click propagation is stopped so opening the photo does not
  // also trigger that row.
  const open = (e: React.SyntheticEvent) => {
    if (!canView) return;
    e.stopPropagation();
    setViewing(true);
  };

  return (
    <div className={`relative flex-shrink-0 ${className}`} style={{ width: size, height: size, ...style }} title={title}>
      <div
        role={canView ? 'button' : undefined}
        tabIndex={canView ? 0 : undefined}
        aria-label={canView ? `View ${name}'s photo` : undefined}
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
      {viewing && avatarUrl && (
        <AvatarViewer name={name} src={avatarUrl} onClose={() => setViewing(false)} />
      )}
    </div>
  );
}

/** Full-size photo overlay, matching how message images open in Lightbox. */
function AvatarViewer({ name, src, onClose }: { name: string; src: string; onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`${name}'s photo`}
    >
      <button
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <img
        src={src}
        alt={name}
        onClick={(e) => e.stopPropagation()}
        className="block max-w-[85vw] max-h-[75vh] rounded-2xl object-contain"
        style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
      />
      <p className="mt-4 font-mono text-[13px] text-white/80">{name}</p>
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
      <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ fontSize: 13, color: 'var(--text-dim)' }} />
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
