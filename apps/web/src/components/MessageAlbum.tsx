'use client';

import type { FileMeta, Message, MessageType } from '@messenger/shared';
import { useFileBlobUrl } from '../hooks/useFileBlobUrl';
import { previewVariant } from '../utils/previewVariant';
import { ATTACHMENT } from './MessageAttachment';
import { albumSpans } from '../utils/messageAlbums';

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
 *
 * Every picture is laid out. Folding the tail into a "+3" hides pictures that were sent to be
 * looked at, and the viewer is not much help when you cannot see what you are opening.
 */
export function MessageAlbum({ messages, onOpen }: Props) {
  const spans = albumSpans(messages.length);

  return (
    <div
      className="grid gap-[3px] overflow-hidden"
      style={{
        // Six columns: divisible by both two and three, which is what lets a row of three and a
        // row of two both fill the width exactly.
        gridTemplateColumns: 'repeat(6, 1fr)',
        // Corners and shadow belong to the bubble that wraps this, so a grouped album keeps the
        // same pointed corner as any other message rather than rounding inside it.
        maxWidth: ATTACHMENT.maxWidth,
      }}
    >
      {messages.map((message, index) => (
        <AlbumTile key={message.id} message={message} span={spans[index] ?? 2} onOpen={onOpen} />
      ))}
    </div>
  );
}

function AlbumTile({
  message,
  span,
  onOpen,
}: {
  message: Message;
  /** Columns out of six. */
  span: number;
  onOpen: (file: FileMeta, type: MessageType) => void;
}) {
  const file = message.file!;
  const url = useFileBlobUrl(file.id, previewVariant(file));
  const ready = url && url !== 'error';

  return (
    <button
      type="button"
      onClick={() => onOpen(file, message.type as MessageType)}
      className="relative block w-full overflow-hidden transition-opacity hover:opacity-90"
      style={{
        gridColumn: `span ${span}`,
        // A full-width tile is the only one that would be absurdly tall as a square.
        aspectRatio: span === 6 ? '2 / 1' : '1 / 1',
        background: 'var(--panel-alt)',
      }}
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

    </button>
  );
}
