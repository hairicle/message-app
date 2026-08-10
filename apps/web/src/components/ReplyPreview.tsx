'use client';

import type { FileMeta, MessageType } from '@messenger/shared';
import { FaMicrophone, FaPaperclip } from 'react-icons/fa6';
import { useFileBlobUrl } from '../hooks/useFileBlobUrl';
import { previewVariant } from '../utils/previewVariant';
import { decodeMessageText } from '../utils/text';
import { attachmentNoun } from '../utils/messagePreview';
import { formatFileSize } from '../utils/format';

interface ReplyPreviewProps {
  type: MessageType;
  file?: FileMeta | null;
  ciphertext: string;
  deleted?: boolean;
  /** Text colour. The two callers sit on different backgrounds — a panel and an accent bubble. */
  color: string;
  /** Icon and thumbnail-border colour, likewise caller-controlled. */
  iconColor: string;
}

/**
 * One-line summary of the message being replied to.
 *
 * Used by both the composer's reply bar and the quote block inside a bubble. Those two used to
 * carry their own copy of this logic and had drifted to the same unhelpful place — every
 * attachment, whether a photo, a voice note or a spreadsheet, rendered as the literal string
 * "📎 Attachment", so the preview told you nothing about what you were replying to.
 */
export function ReplyPreview({ type, file, ciphertext, deleted, color, iconColor }: ReplyPreviewProps) {
  const isMedia = type === 'image' || type === 'video';
  // Called unconditionally with an undefined id when there is nothing to fetch — the hook
  // short-circuits on that, and hooks cannot be called behind a branch.
  const thumbUrl = useFileBlobUrl(
    isMedia && file ? file.id : undefined,
    previewVariant(file),
  );

  if (deleted) {
    return <p className="text-xs italic truncate" style={{ color }}>This message was deleted</p>;
  }

  // An attachment message whose file row is missing — forwards made before the attachment was
  // carried across left rows like this behind. Say so rather than render an empty line.
  if (type !== 'text' && !file) {
    return <p className="text-xs italic truncate" style={{ color }}>{attachmentNoun(type)} unavailable</p>;
  }

  if (isMedia && file) {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span
          className="flex-shrink-0 overflow-hidden"
          style={{ width: 28, height: 28, borderRadius: 6, background: `${iconColor}22` }}
        >
          {thumbUrl && thumbUrl !== 'error' && (
            type === 'image'
              ? <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
              : <video src={thumbUrl} muted preload="metadata" className="w-full h-full object-cover" />
          )}
        </span>
        <span className="text-xs truncate" style={{ color }}>{attachmentNoun(type)}</span>
      </span>
    );
  }

  if (type === 'audio') {
    const secs = file?.durationSecs;
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <FaMicrophone size={12} className="flex-shrink-0" style={{ color: iconColor }} />
        <span className="text-xs truncate" style={{ color }}>
          {attachmentNoun('audio')}
          {secs != null && ` · ${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`}
        </span>
      </span>
    );
  }

  if (type === 'file' && file) {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <FaPaperclip size={12} className="flex-shrink-0" style={{ color: iconColor }} />
        <span className="text-xs truncate" style={{ color }}>
          {file.fileName}
          <span className="font-mono"> · {formatFileSize(file.sizeBytes)}</span>
        </span>
      </span>
    );
  }

  return <p className="text-xs truncate" style={{ color }}>{decodeMessageText(ciphertext)}</p>;
}
