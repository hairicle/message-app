import { useRef, useState } from 'react';
import type { FileMeta, MessageType } from '../api/types';
import { useFileBlobUrl } from '../hooks/useFileBlobUrl';
import { formatFileSize } from '../utils/format';

interface MessageAttachmentProps {
  type: MessageType;
  file: FileMeta;
  isMine?: boolean;
  compact?: boolean;
  onOpen?: (file: FileMeta, type: MessageType) => void;
}

function VoicePlayer({ url, isMine, fileName, durationSecs }: { url: string | null; isMine: boolean; fileName: string; durationSecs: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSecs, setCurrentSecs] = useState(0);
  const [duration, setDuration] = useState(durationSecs ?? 0);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { a.play(); }
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // Colors relative to the bubble background (mine = var(--accent), others = var(--panel))
  const dim = isMine ? 'rgba(255,255,255,0.55)' : 'var(--text-dim)';
  const track = isMine ? 'rgba(255,255,255,0.22)' : 'var(--border)';
  // Play button: white circle on accent bubble; accent circle on panel bubble
  const btnBg = isMine ? 'rgba(255,255,255,0.88)' : 'var(--accent)';
  const btnIcon = isMine ? 'var(--accent)' : '#fff';

  if (!url) {
    return (
      <div className="flex items-center gap-2 py-1" style={{ minWidth: 180 }}>
        <div style={{ width: 32, height: 32, borderRadius: 16, background: track, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg className="w-4 h-4 animate-spin" style={{ color: dim }} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        </div>
        <span style={{ fontSize: 12, color: dim }}>Loading…</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 py-1" style={{ minWidth: 200, maxWidth: 260 }}>
      <audio ref={audioRef} src={url} preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentSecs(0); }}
        onLoadedMetadata={(e) => { if (!durationSecs) setDuration((e.target as HTMLAudioElement).duration); }}
        onTimeUpdate={(e) => {
          const a = e.target as HTMLAudioElement;
          setCurrentSecs(a.currentTime);
          setProgress(a.duration ? a.currentTime / a.duration : 0);
        }}
      />

      {/* Play/pause button */}
      <button type="button" onClick={toggle}
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

      {/* Waveform / progress bar + time */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        {/* Progress bar */}
        <div className="relative h-1.5 rounded-full cursor-pointer" style={{ background: track }}
          onClick={(e) => {
            const a = audioRef.current;
            if (!a || !a.duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration;
          }}>
          <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${progress * 100}%`, background: btnBg }} />
        </div>
        {/* Time */}
        <div className="flex justify-between" style={{ fontSize: 10, color: dim, fontFamily: 'monospace' }}>
          <span>{fmt(currentSecs)}</span>
          <span>{duration > 0 ? fmt(duration) : fileName}</span>
        </div>
      </div>
    </div>
  );
}

export function MessageAttachment({ type, file, isMine, compact, onOpen }: MessageAttachmentProps) {
  const previewUrl = useFileBlobUrl(file.id, file.hasThumbnail ? 'thumbnail' : 'original');
  const loadingStyle = { color: isMine ? 'var(--bg-deep)' : 'var(--text-dim)', opacity: 0.7 };

  if (type === 'image') {
    if (!previewUrl) {
      return <p className="text-xs italic mb-1" style={loadingStyle}>Loading {file.fileName}...</p>;
    }
    if (compact) {
      return (
        <button type="button" className="block w-full hover:opacity-90 transition-opacity" onClick={() => onOpen?.(file, type)}>
          <img src={previewUrl} alt={file.fileName} className="block w-full max-h-[320px] object-cover" />
        </button>
      );
    }
    return (
      <button
        type="button"
        className="block mb-1 rounded-xl overflow-hidden hover:opacity-90 transition-opacity"
        onClick={() => onOpen?.(file, type)}
      >
        <img
          src={previewUrl}
          alt={file.fileName}
          className="block max-w-[220px] max-h-[220px] object-cover"
        />
      </button>
    );
  }

  if (type === 'video') {
    if (!previewUrl) {
      return <p className="text-xs italic mb-1" style={loadingStyle}>Loading {file.fileName}...</p>;
    }
    if (compact) {
      return (
        <button type="button" className="relative block w-full hover:opacity-90 transition-opacity" onClick={() => onOpen?.(file, type)}>
          <video src={previewUrl} preload="metadata" muted className="block w-full max-h-[320px] object-cover pointer-events-none" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
              <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
        </button>
      );
    }
    return (
      <button
        type="button"
        className="relative block mb-1 rounded-xl overflow-hidden hover:opacity-90 transition-opacity max-w-[260px]"
        onClick={() => onOpen?.(file, type)}
      >
        <video src={previewUrl} preload="metadata" muted className="block w-full rounded-xl pointer-events-none" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white text-sm">
            ▶
          </span>
        </span>
      </button>
    );
  }

  if (type === 'audio') {
    return <VoicePlayer url={previewUrl} isMine={!!isMine} fileName={file.fileName} durationSecs={file.durationSecs ?? null} />;
  }

  if (!previewUrl) {
    return <p className={`text-xs italic mb-1 ${isMine ? 'text-white/70' : 'text-gray-400'}`}>Loading {file.fileName}...</p>;
  }

  return (
    <a
      href={previewUrl}
      download={file.fileName}
      className="flex items-center gap-2.5 mb-1 px-3 py-2 rounded-xl bg-black/10 hover:bg-black/15 transition-colors no-underline"
    >
      <span className="text-lg flex-shrink-0">📎</span>
      <span className="flex flex-col min-w-0">
        <span className="text-sm font-semibold truncate max-w-[160px]">{file.fileName}</span>
        <span className="text-xs opacity-70">{formatFileSize(file.sizeBytes)}</span>
      </span>
    </a>
  );
}
