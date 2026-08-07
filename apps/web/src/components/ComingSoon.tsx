'use client';

import type { IconType } from 'react-icons';


export interface ComingSoonProps {
  icon: IconType;
  title: string;
  /** What the feature will do, in the user's terms. */
  description: string;
  /** e.g. "Phase 2" — omit for features with no scheduled phase yet. */
  phase?: string;
  /** A few concrete capabilities, so the placeholder says something useful. */
  highlights?: string[];
}

/**
 * Placeholder for a feature that is visible in the navigation but not part of the current phase.
 * Shown instead of the real workspace so the roadmap is discoverable without exposing work in
 * progress as if it were finished.
 */
export function ComingSoon({ icon: Icon, title, description, phase, highlights }: ComingSoonProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-md text-center">
        <span
          className="inline-flex items-center justify-center rounded-2xl mb-5"
          style={{
            width: 64,
            height: 64,
            background: 'var(--accent-wash)',
            border: '1px solid var(--accent-dim)',
            color: 'var(--accent)',
          }}
        >
          <Icon size={26} />
        </span>

        <div className="flex items-center justify-center gap-2 mb-2">
          <h2 className="text-[20px] font-bold" style={{ color: 'var(--text)' }}>{title}</h2>
          {phase && (
            <span
              className="font-mono text-[10.5px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide"
              style={{ background: 'var(--warning-wash)', color: 'var(--warning)', border: '1px solid var(--warning-border)' }}
            >
              {phase}
            </span>
          )}
        </div>

        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
          {description}
        </p>

        {highlights && highlights.length > 0 && (
          <ul className="mt-5 space-y-2 text-left inline-block">
            {highlights.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-6 font-mono text-[11.5px]" style={{ color: 'var(--text-dim)' }}>
          Chat is available now.
        </p>
      </div>
    </div>
  );
}
