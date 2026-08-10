'use client';

import type { FileMeta, Message, MessageType } from '@messenger/shared';
import { useFileBlobUrl } from '../hooks/useFileBlobUrl';
import { ATTACHMENT } from './MessageAttachment';

/** Tiles beyond this are folded into a "+N" on the last one. */
const MAX_TILES = 4;

interface Props {
  messages: Message[];
  onOpen: (file: FileMeta, type: MessageType) => void;
}

/**
 * A run of media sent together, laid out as one block.
 *
 * Sending four photos used to produce four stacked bubbles, each the width of the thread — a
 * batch of holiday pictures pushed the rest of the conversation off screen. As a grid they read
 * as one act, and take the height of a single bubble.
 */
export function MessageAlbum({ messages, onOpen }: Props) {
  const shown = messages.slice(0, MAX_TILES);
  const hidden = messages.length - shown.length;

  return (
    <div
      className="grid gap-[3px] overflow-hidden"
      style={{
        // Three tiles read better as one wide over two than as a ragged row, so the first spans
        // the full width; every other count divides evenly into two columns.
        gridTemplateColumns: 'repeat(2, 1fr)',
        // Corners and shadow belong to the bubble that wraps this, so a grouped album keeps the
        // same pointed corner as any other message rather than rounding inside it.
        maxWidth: ATTACHMENT.maxWidth,
      }}
    >
      {shown.map((message, index) => (
        <AlbumTile
          key={message.id}
          message={message}
          span={shown.length === 3 && index === 0 ? 2 : 1}
          // The last visible tile carries the count of everything not shown.
          more={index === shown.length - 1 ? hidden : 0}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function AlbumTile({
  message,
  span,
  more,
  onOpen,
}: {
  message: Message;
  span: 1 | 2;
  more: number;
  onOpen: (file: FileMeta, type: MessageType) => void;
}) {
  const file = message.file!;
  const url = useFileBlobUrl(file.id, file.hasThumbnail ? 'thumbnail' : 'original');
  const ready = url && url !== 'error';

  return (
    <button
      type="button"
      onClick={() => onOpen(file, message.type as MessageType)}
      className="relative block w-full overflow-hidden transition-opacity hover:opacity-90"
      style={{ gridColumn: span === 2 ? 'span 2' : undefined, aspectRatio: span === 2 ? '2 / 1' : '1 / 1', background: 'var(--panel-alt)' }}
      aria-label={file.fileName}
    >
      {ready && (message.type === 'video'
        ? <video src={url} preload="metadata" muted className="w-full h-full object-cover pointer-events-none" />
        : <img src={url} alt="" className="w-full h-full object-cover" />)}

      {ready && message.type === 'video' && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center">
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      )}

      {!ready && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid var(--border)', borderTopColor: 'transparent' }} />
        </span>
      )}

      {more > 0 && (
        <span
          className="absolute inset-0 flex items-center justify-center font-mono text-white pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.55)', fontSize: 20 }}
        >
          +{more}
        </span>
      )}
    </button>
  );
}
