'use client';

import type { FileMeta, MessageType } from '@messenger/shared';
import { useFileBlobUrl } from '../hooks/useFileBlobUrl';

interface LightboxProps {
  file: FileMeta;
  type: MessageType;
  onClose: () => void;
}

export function Lightbox({ file, type, onClose }: LightboxProps) {
  const url = useFileBlobUrl(file.id, 'original');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        onClick={onClose}
        aria-label="Close"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {!url && <p className="text-white/60 text-sm">Loading {file.fileName}...</p>}
        {url && type === 'image' && (
          <img
            src={url}
            alt={file.fileName}
            className="block max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
          />
        )}
        {url && type === 'video' && (
          <video src={url} controls autoPlay className="block max-w-[90vw] max-h-[90vh] rounded-lg">
            Your browser does not support video playback.
          </video>
        )}
      </div>
    </div>
  );
}
