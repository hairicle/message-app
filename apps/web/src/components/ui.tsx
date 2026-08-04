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
}

export function Avatar({
  name, avatarUrl, size = 32, radius = 7, fontSize, online, showPresence, className = '', style, title,
}: AvatarProps) {
  const fs = fontSize ?? Math.max(10, Math.round(size * 0.4));
  const dotSize = Math.max(8, Math.round(size * 0.28));
  return (
    <div className={`relative flex-shrink-0 ${className}`} style={{ width: size, height: size, ...style }} title={title}>
      <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: radius, border: '1px solid var(--border)', background: 'var(--panel-alt)' }}>
        <span className="absolute inset-0 flex items-center justify-center font-mono font-bold select-none" style={{ fontSize: fs, color: 'var(--accent)' }}>
          {name.slice(0, 1).toUpperCase()}
        </span>
        {avatarUrl && (
          <img src={avatarUrl} alt={name} className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        )}
      </div>
      {showPresence && (
        <span className="absolute -right-0.5 -bottom-0.5 rounded-full"
          style={{ width: dotSize, height: dotSize, background: online ? 'var(--success)' : 'var(--text-dim)', border: '1.5px solid var(--bg)' }} />
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
