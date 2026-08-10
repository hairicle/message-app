'use client';

import { useRef, useState } from 'react';
import type { FileMeta, MessageType } from '@messenger/shared';
import { useFileBlobUrl } from '../hooks/useFileBlobUrl';
import { formatFileSize } from '../utils/format';
import { useWaveform } from '../hooks/useWaveform';

interface MessageAttachmentProps {
  type: MessageType;
  /** Optional: an attachment message can outlive its file row, and that case is rendered. */
  file?: FileMeta;
  isMine?: boolean;
  compact?: boolean;
  onOpen?: (file: FileMeta, type: MessageType) => void;
}

const WAVE_BARS = 34;

/**
 * Speeds offered, cycled by tapping the control.
 *
 * A cycle rather than a menu: there are three of them, and a voice note is short enough that
 * opening a menu to change speed costs more than listening at the wrong one.
 */
const PLAYBACK_RATES = [1, 1.5, 2] as const;

/**
 * One visual treatment for every attachment variant.
 *
 * These used to be set per branch and had drifted apart: images capped at 220px, video and file
 * cards at 260, radii split between `rounded-xl` and nothing, and no variant agreed on a shadow.
 * A thread mixing a photo, a clip and a PDF showed three different card shapes.
 *
 * `compact` is the exception and deliberately so — there the bubble itself clips the media, so the
 * corners follow the grouped bubble's shape instead of this radius.
 */
export const ATTACHMENT = {
  radius: 14,
  maxWidth: 280,
  /** Media is capped in height too, so a tall portrait photo cannot run the bubble off-screen. */
  maxHeight: 320,
  padding: 10,
  shadow: '0 1px 2px rgba(0, 0, 0, 0.18)',
} as const;

/**
 * Play affordance over a video thumbnail. The two video branches had drifted to different marks —
 * an SVG triangle in one and a "▶" text glyph in the other, which rendered in whatever font the
 * bubble inherited and sat off-centre.
 */
function PlayBadge() {
  return (
    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
        <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </span>
  );
}

export function VoicePlayer({ url, isMine, fileName, durationSecs }: { url: string | null; isMine: boolean; fileName: string; durationSecs: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSecs, setCurrentSecs] = useState(0);
  const [duration, setDuration] = useState(durationSecs ?? 0);
  const [rate, setRate] = useState<number>(1);
  const { peaks } = useWaveform(url, WAVE_BARS);

  function cycleRate() {
    const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate as typeof PLAYBACK_RATES[number]) + 1) % PLAYBACK_RATES.length];
    setRate(next);
    // Applied to the element straight away, not only recorded in state, so a change made while
    // it is playing is heard now rather than at the next load.
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { a.play(); }
  }

  function seekTo(clientX: number, el: HTMLElement) {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * a.duration;
    setProgress(ratio);
    setCurrentSecs(ratio * a.duration);
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  // Colors relative to the bubble background (mine = var(--accent), others = var(--panel))
  const dim = isMine ? 'rgba(255,255,255,0.55)' : 'var(--text-dim)';
  const track = isMine ? 'rgba(255,255,255,0.22)' : 'var(--border)';
  // Play button: white circle on accent bubble; accent circle on panel bubble
  const btnBg = isMine ? 'rgba(255,255,255,0.88)' : 'var(--accent)';
  const btnIcon = isMine ? 'var(--accent)' : '#fff';
  // Waveform: played bars sit at full strength, the rest recede but stay visible.
  const waveActive = isMine ? 'rgba(255,255,255,0.95)' : 'var(--accent)';
  const waveIdle = isMine ? 'rgba(255,255,255,0.35)' : 'var(--accent-dim)';

  if (!url || url === 'error') {
    return (
      <div className="flex items-center gap-2 py-1" style={{ minWidth: 180 }}>
        <div style={{ width: 32, height: 32, borderRadius: 16, background: track, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {url === 'error' ? (
            <svg className="w-4 h-4" style={{ color: dim }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 animate-spin" style={{ color: dim }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          )}
        </div>
        <span style={{ fontSize: 12, color: dim }}>{url === 'error' ? 'Audio unavailable' : 'Loading…'}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 py-1" style={{ minWidth: 200, maxWidth: ATTACHMENT.maxWidth }}>
      <audio ref={audioRef} src={url} preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentSecs(0); }}
        onLoadedMetadata={(e) => {
          const el = e.target as HTMLAudioElement;
          if (!durationSecs) setDuration(el.duration);
          // playbackRate resets whenever a source loads, so a chosen speed has to be re-applied
          // or it silently reverts to 1× the first time the note is played.
          el.playbackRate = rate;
        }}
        onTimeUpdate={(e) => {
          const a = e.target as HTMLAudioElement;
          setCurrentSecs(a.currentTime);
          setProgress(a.duration ? a.currentTime / a.duration : 0);
        }}
      />

      {/* Waveform — click or drag anywhere on it to seek */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentSecs)}
        className="flex-1 flex items-center gap-[2px] cursor-pointer min-w-0"
        style={{ height: 28 }}
        onClick={(e) => seekTo(e.clientX, e.currentTarget)}
        onKeyDown={(e) => {
          const a = audioRef.current;
          if (!a || !a.duration) return;
          if (e.key === 'ArrowRight') a.currentTime = Math.min(a.duration, a.currentTime + 2);
          if (e.key === 'ArrowLeft') a.currentTime = Math.max(0, a.currentTime - 2);
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
        }}
      >
        {peaks.map((p, i) => {
          const played = i / peaks.length < progress;
          return (
            <span
              key={i}
              className="flex-1 rounded-full"
              style={{
                height: Math.max(3, Math.round(p * 26)),
                minWidth: 2,
                background: played ? waveActive : waveIdle,
                transition: 'background-color 120ms linear',
              }}
            />
          );
        })}
      </div>

      {/* Elapsed while playing, total otherwise — matches how the reference reads */}
      <span
        className="flex-shrink-0 tabular-nums"
        style={{ fontSize: 11.5, color: dim, fontFamily: 'var(--font-mono)' }}
        title={fileName}
      >
        {duration > 0 ? fmt(playing || currentSecs > 0 ? currentSecs : duration) : '--:--'}
      </span>

      {/* Speed — only worth offering once there is something to play */}
      <button
        type="button"
        onClick={cycleRate}
        title={`Playback speed ${rate}×`}
        aria-label={`Playback speed ${rate} times. Tap to change.`}
        className="flex-shrink-0 rounded-full tabular-nums transition-opacity hover:opacity-80"
        style={{
          fontSize: 10.5,
          fontFamily: 'var(--font-mono)',
          padding: '2px 6px',
          color: rate === 1 ? dim : (isMine ? 'var(--accent)' : '#fff'),
          background: rate === 1 ? 'transparent' : (isMine ? 'rgba(255,255,255,0.9)' : 'var(--accent)'),
          border: `1px solid ${rate === 1 ? track : 'transparent'}`,
        }}
      >
        {rate}×
      </button>

      {/* Play/pause button */}
      <button type="button" onClick={toggle}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        className="flex-shrink-0 flex items-center justify-center rounded-full transition-opacity hover:opacity-80"
        style={{ width: 34, height: 34, background: btnBg }}>
        {playing ? (
          <svg className="w-3.5 h-3.5" style={{ color: btnIcon }} fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 ml-0.5" style={{ color: btnIcon }} fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function MessageAttachment({ type, file, isMine, compact, onOpen }: MessageAttachmentProps) {
  const previewUrl = useFileBlobUrl(file?.id, file?.hasThumbnail ? 'thumbnail' : 'original');
  const loadingStyle = { color: isMine ? 'var(--bg-deep)' : 'var(--text-dim)', opacity: 0.7 };

  // A message typed as an attachment whose file row is missing. Forwards made before the
  // attachment was carried across left rows like this behind, and returning null rendered them
  // as a completely empty bubble with no hint that anything was meant to be there.
  if (!file) {
    return (
      <p className="text-xs italic" style={{ color: isMine ? 'rgba(8,10,15,0.55)' : 'var(--text-dim)' }}>
        This {type === 'file' ? 'file' : type} is no longer available
      </p>
    );
  }

  if (type === 'image') {
    if (previewUrl === 'error') {
      return <p className="text-xs italic mb-1" style={loadingStyle}>Image unavailable</p>;
    }
    if (!previewUrl) {
      return <p className="text-xs italic mb-1" style={loadingStyle}>Loading {file.fileName}...</p>;
    }
    if (compact) {
      return (
        <button type="button" className="block w-full hover:opacity-90 transition-opacity" onClick={() => onOpen?.(file, type)}>
          <img src={previewUrl} alt={file.fileName} className="block w-full object-cover" style={{ maxHeight: ATTACHMENT.maxHeight }} />
        </button>
      );
    }
    return (
      <button
        type="button"
        className="block mb-1 overflow-hidden hover:opacity-90 transition-opacity"
        style={{ borderRadius: ATTACHMENT.radius, boxShadow: ATTACHMENT.shadow }}
        onClick={() => onOpen?.(file, type)}
      >
        <img
          src={previewUrl}
          alt={file.fileName}
          className="block object-cover"
          style={{ maxWidth: ATTACHMENT.maxWidth, maxHeight: ATTACHMENT.maxHeight }}
        />
      </button>
    );
  }

  if (type === 'video') {
    if (previewUrl === 'error') {
      return <p className="text-xs italic mb-1" style={loadingStyle}>Video unavailable</p>;
    }
    if (!previewUrl) {
      return <p className="text-xs italic mb-1" style={loadingStyle}>Loading {file.fileName}...</p>;
    }
    if (compact) {
      return (
        <button type="button" className="relative block w-full hover:opacity-90 transition-opacity" onClick={() => onOpen?.(file, type)}>
          <video src={previewUrl} preload="metadata" muted className="block w-full object-cover pointer-events-none" style={{ maxHeight: ATTACHMENT.maxHeight }} />
          <PlayBadge />
        </button>
      );
    }
    return (
      <button
        type="button"
        className="relative block mb-1 overflow-hidden hover:opacity-90 transition-opacity"
        style={{ borderRadius: ATTACHMENT.radius, boxShadow: ATTACHMENT.shadow, maxWidth: ATTACHMENT.maxWidth }}
        onClick={() => onOpen?.(file, type)}
      >
        <video src={previewUrl} preload="metadata" muted className="block w-full pointer-events-none" style={{ maxHeight: ATTACHMENT.maxHeight }} />
        <PlayBadge />
      </button>
    );
  }

  if (type === 'audio') {
    return <VoicePlayer url={previewUrl} isMine={!!isMine} fileName={file.fileName} durationSecs={file.durationSecs ?? null} />;
  }

  if (!previewUrl) {
    return (
      <div className="flex items-center gap-2.5 mb-1" style={{ minWidth: 220, maxWidth: ATTACHMENT.maxWidth, padding: ATTACHMENT.padding, borderRadius: ATTACHMENT.radius, background: isMine ? 'rgba(255,255,255,0.14)' : 'var(--panel-alt)' }}>
        <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: ATTACHMENT.radius - 4, background: isMine ? 'rgba(255,255,255,0.15)' : 'var(--panel)' }}>
          <svg className="w-4 h-4 animate-spin" style={loadingStyle} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        </div>
        <span className="text-xs italic truncate" style={loadingStyle}>Loading {file.fileName}...</span>
      </div>
    );
  }

  const { label: extLabel, color: extColor } = fileTypeMeta(file.fileName);

  return (
    <a
      href={previewUrl}
      download={file.fileName}
      className="group flex items-center gap-3 mb-1 transition-colors no-underline"
      style={{
        background: isMine ? 'rgba(255,255,255,0.14)' : 'var(--panel-alt)',
        borderRadius: ATTACHMENT.radius,
        boxShadow: ATTACHMENT.shadow,
        padding: ATTACHMENT.padding,
        minWidth: 220,
        maxWidth: ATTACHMENT.maxWidth,
      }}
    >
      {/* File-type icon badge */}
      <span className="flex-shrink-0 flex items-center justify-center relative" style={{ width: 40, height: 40, borderRadius: ATTACHMENT.radius - 4, background: isMine ? 'rgba(255,255,255,0.2)' : `${extColor}22` }}>
        <svg className="w-[18px] h-[18px]" fill="none" stroke={isMine ? '#fff' : extColor} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 2.25H15a.75.75 0 01.53.22l4.5 4.5a.75.75 0 01.22.53V19.5A2.25 2.25 0 0118 21.75H6A2.25 2.25 0 013.75 19.5V4.5A2.25 2.25 0 016 2.25h3z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M14.25 2.25v4.5a.75.75 0 00.75.75h4.5" />
        </svg>
        {extLabel && (
          <span className="absolute -bottom-1 px-1 rounded font-mono font-bold leading-tight"
            style={{ fontSize: 8.5, background: isMine ? '#fff' : extColor, color: isMine ? extColor : '#fff' }}>
            {extLabel}
          </span>
        )}
      </span>

      <span className="flex flex-col min-w-0 flex-1">
        <span className="text-[13px] font-semibold truncate" style={{ color: isMine ? 'var(--bg-deep)' : 'var(--text)' }}>{file.fileName}</span>
        <span className="text-[11.5px] font-mono" style={{ color: isMine ? 'rgba(8,10,15,0.6)' : 'var(--text-dim)' }}>{formatFileSize(file.sizeBytes)}</span>
      </span>

      {/* Download affordance */}
      <svg className="w-4 h-4 flex-shrink-0 transition-transform group-hover:translate-y-0.5" style={{ color: isMine ? 'rgba(8,10,15,0.55)' : 'var(--text-dim)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    </a>
  );
}

// ── File-type badge color/label ───────────────────────────────────────────
const FILE_TYPE_STYLES: Record<string, { label: string; color: string }> = {
  pdf: { label: 'PDF', color: '#ef4444' },
  doc: { label: 'DOC', color: '#3b82f6' },
  docx: { label: 'DOC', color: '#3b82f6' },
  xls: { label: 'XLS', color: '#22c55e' },
  xlsx: { label: 'XLS', color: '#22c55e' },
  ppt: { label: 'PPT', color: '#f97316' },
  pptx: { label: 'PPT', color: '#f97316' },
  zip: { label: 'ZIP', color: '#f59e0b' },
  rar: { label: 'ZIP', color: '#f59e0b' },
  txt: { label: 'TXT', color: '#71717a' },
  csv: { label: 'CSV', color: '#22c55e' },
};

export function fileTypeMeta(fileName: string): { label: string | null; color: string } {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const meta = FILE_TYPE_STYLES[ext];
  return meta ?? { label: ext ? ext.slice(0, 4).toUpperCase() : null, color: '#3b82f6' };
}
