'use client';

import { useEffect, useState } from 'react';
import type { FileMeta, MessageType } from '@messenger/shared';
import { FaChevronLeft, FaChevronRight, FaXmark } from 'react-icons/fa6';
import { useFileBlobUrl } from '../hooks/useFileBlobUrl';

export interface LightboxItem {
  file: FileMeta;
  type: MessageType;
}

interface LightboxProps {
  /** Everything reachable from here, in the order it appears in the conversation. */
  items: LightboxItem[];
  startIndex: number;
  onClose: () => void;
}

/**
 * Full-size viewer for an image or video.
 *
 * It takes the whole run of media rather than a single file, because opening one picture and
 * having no way to reach the next means closing and hunting for it in the thread.
 */
export function Lightbox({ items, startIndex, onClose }: LightboxProps) {
  const [index, setIndex] = useState(startIndex);
  const current = items[index] ?? items[0];
  const many = items.length > 1;

  // Wraps, so the ends are not dead: reaching the last picture and pressing right returns to the
  // first rather than doing nothing and looking broken.
  const step = (delta: number) => setIndex((i) => (i + delta + items.length) % items.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (!many) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [many, items.length, onClose]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={current.file.fileName}
    >
      <button
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        onClick={onClose}
        aria-label="Close"
      >
        <FaXmark size={18} />
      </button>

      {many && (
        <span className="absolute top-5 left-1/2 -translate-x-1/2 text-white/70 text-[12px] font-mono tabular-nums select-none">
          {index + 1} / {items.length}
        </span>
      )}

      {many && (
        <>
          <button
            className="absolute left-3 sm:left-5 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={(e) => { e.stopPropagation(); step(-1); }}
            aria-label="Previous"
          >
            <FaChevronLeft size={18} />
          </button>
          <button
            className="absolute right-3 sm:right-5 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={(e) => { e.stopPropagation(); step(1); }}
            aria-label="Next"
          >
            <FaChevronRight size={18} />
          </button>
        </>
      )}

      {/* Keyed by file id so switching item remounts the media — without it a video would keep
          playing the previous source while the new one loaded. */}
      <LightboxMedia key={current.file.id} item={current} />
    </div>
  );
}

function LightboxMedia({ item }: { item: LightboxItem }) {
  const url = useFileBlobUrl(item.file.id, 'original');

  return (
    <div className="max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
      {!url && <p className="text-white/60 text-sm">Loading {item.file.fileName}…</p>}
      {url === 'error' && <p className="text-white/60 text-sm">{item.file.fileName} could not be loaded</p>}
      {url && url !== 'error' && item.type === 'image' && (
        <img src={url} alt={item.file.fileName} className="block max-w-[90vw] max-h-[90vh] rounded-lg object-contain" />
      )}
      {url && url !== 'error' && item.type === 'video' && (
        <video src={url} controls autoPlay className="block max-w-[90vw] max-h-[90vh] rounded-lg">
          Your browser does not support video playback.
        </video>
      )}
    </div>
  );
}
