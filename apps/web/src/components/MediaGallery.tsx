'use client';

import { useEffect, useState } from 'react';
import * as conversationsApi from '../lib/api/conversations';
import type { ConversationMediaItem, FileMeta, MessageType } from '@messenger/shared';
import { useFileBlobUrl } from '../hooks/useFileBlobUrl';

interface MediaGalleryProps {
  conversationId: string;
  onClose: () => void;
  onOpen: (file: FileMeta, type: MessageType) => void;
}

export function MediaGallery({ conversationId, onClose, onOpen }: MediaGalleryProps) {
  const [media, setMedia] = useState<ConversationMediaItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    conversationsApi.getConversationMedia(conversationId).then(({ media }) => {
      if (!cancelled) setMedia(media);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="font-semibold text-slate-900">Media</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {media === null && (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm py-12">
            Loading...
          </div>
        )}
        {media?.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm py-12">
            No media shared yet.
          </div>
        )}
        {media && media.length > 0 && (
          <div className="grid grid-cols-3 gap-1 p-1 overflow-y-auto">
            {media.map((item) => (
              <GalleryItem key={item.file.id} item={item} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GalleryItem({
  item,
  onOpen,
}: {
  item: ConversationMediaItem;
  onOpen: (file: FileMeta, type: MessageType) => void;
}) {
  const variant = item.type === 'image' && item.file.hasThumbnail ? 'thumbnail' : 'original';
  const url = useFileBlobUrl(item.file.id, variant);

  return (
    <button
      type="button"
      className="relative aspect-square bg-slate-100 rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
      onClick={() => onOpen(item.file, item.type)}
    >
      {!url && (
        <span className="absolute inset-0 flex items-center justify-center text-slate-300 text-xs">
          ...
        </span>
      )}
      {url && item.type === 'image' && (
        <img src={url} alt={item.file.fileName} className="w-full h-full object-cover" />
      )}
      {url && item.type === 'video' && (
        <>
          <video
            src={url}
            preload="metadata"
            muted
            className="w-full h-full object-cover pointer-events-none"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white text-xs">
              ▶
            </span>
          </span>
        </>
      )}
    </button>
  );
}
